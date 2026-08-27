# Operations

How the deployed game is run, updated, and recovered. For how to *use* it in a class, see
[FACILITATOR.md](FACILITATOR.md).

## What is running

One EC2 instance carries both the old game and the new one, side by side, on the same hostname.

| | Old game | New game |
| --- | --- | --- |
| Address | `http://motorcity.boeingcenter.com` | `https://motorcity.boeingcenter.com` |
| Web server | nginx on `:80` | Caddy on `:443` |
| Application | PHP under nginx | `motor-city` service on `:4000`, loopback only |
| Database | MariaDB on `:3306` | PostgreSQL on `:5432` |
| Node.js | system package, **v18** | private runtime, v22, at `/opt/motor-city/node` |

The split is deliberate. The old game keeps port 80 and its own database, so the new deployment
cannot affect it, and either can be turned off without touching the other.

**Never upgrade the system Node package.** The old game runs on v18 and will break. The new game
carries its own runtime precisely so this is not a decision anyone has to make.

Certificates are issued by Let's Encrypt over TLS-ALPN on `:443`, not the usual HTTP challenge,
because nginx owns `:80`. Caddy renews them automatically.

## Layout on the box

```text
/opt/motor-city/
  node/           private Node.js runtime
  src/            git checkout, built here
  dist/           web assets served by the app
  dist-server/    the API
  node_modules/   runtime dependencies only
  previous/       the last version, kept for rollback
  .ssh/deploy_key read-only GitHub deploy key
/etc/motor-city.env       database URL and settings, root-readable only
/etc/systemd/system/motor-city.service
/etc/caddy/Caddyfile
/usr/local/sbin/motor-city-update     root-owned deployment control
/usr/local/sbin/motor-city-rollback   root-owned rollback control
```

## Getting a shell

The instance has no permanent SSH key. Access goes through EC2 Instance Connect from AWS
CloudShell, which issues a key valid for 60 seconds — so the two commands must stay chained.

CloudShell has to be in the same region as the instance, or the availability zone will not
resolve. Rather than hard-coding it, look the instance up:

```bash
export AWS_DEFAULT_REGION=<region>
INSTANCE=<instance-id>

INFO=$(aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[0].Instances[0].[Placement.AvailabilityZone,PublicIpAddress]' \
  --output text)
AZ=$(echo "$INFO" | awk '{print $1}')
IP=$(echo "$INFO" | awk '{print $2}')

[ -f ~/.ssh/mc ] || ssh-keygen -t ed25519 -N '' -f ~/.ssh/mc
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$INSTANCE" --instance-os-user ec2-user \
  --availability-zone "$AZ" --ssh-public-key "file://$HOME/.ssh/mc.pub" >/dev/null \
&& ssh -i ~/.ssh/mc -o StrictHostKeyChecking=no "ec2-user@$IP"
```

`~` is not expanded inside `file://`, hence `$HOME`. The two commands are chained because the
pushed key expires after 60 seconds. Avoid `exit` in a pasted block — it closes the CloudShell
session rather than stopping the script.

`sudo` needs no password.

## Shipping a new version

```bash
sudo /usr/local/sbin/motor-city-update
```

That builds a complete staged runtime, including production dependencies, before stopping the
service for a same-filesystem swap. It refuses to deploy unless `MIGRATE_ON_START=true` is present.
The candidate systemd unit is validated and backed up with the runtime; successful updates also
refresh the root-owned update and rollback controls. Any swap, unit reload, restart, or
database/schema health-check failure restores the complete previous release and its service unit,
then exits non-zero. A shared process lock rejects a second update or rollback while one is active.

Pass a branch or tag to deploy something other than `main`:

```bash
sudo /usr/local/sbin/motor-city-update my-branch
```

To go back a version deliberately:

```bash
sudo /usr/local/sbin/motor-city-rollback
```

Only one previous version is kept. Running rollback twice does not step further back.

### The deploy key

`update.sh` clones over SSH with a read-only deploy key so the repository can stay private.

Create it once, on the box:

```bash
sudo -u motorcity ssh-keygen -t ed25519 -N '' -f /opt/motor-city/.ssh/deploy_key
sudo cat /opt/motor-city/.ssh/deploy_key.pub
```

Add that public key to the repository on GitHub under **Settings → Deploy keys**, leaving
*Allow write access* unticked.

## First install on a fresh box

```bash
sudo bash deploy/install.sh motorcity.boeingcenter.com you@example.com
```

Safe to re-run: every step checks before acting, and the database password is preserved. It
refuses to start if `:443` is already taken or if the disk is short on space, and it never
touches nginx, MariaDB, or the system Node package.

## Checking on it

```bash
curl -sS localhost:4000/api/health          # should print {"status":"ok"}
curl -sSI https://motorcity.boeingcenter.com | head -1
systemctl status motor-city caddy postgresql
sudo journalctl -u motor-city -f            # application log
sudo journalctl -u caddy -n 50              # TLS and proxy log
```

Caddy logs to journald, not to a file. It has no write access to `/var/log`.

## Restart

```bash
sudo systemctl restart motor-city    # the game; drops in-flight requests only
sudo systemctl reload caddy          # after editing the Caddyfile
```

Restarting the application does not lose sessions — they live in PostgreSQL, not in memory.

## Database

```bash
# Back up
sudo -u postgres pg_dump -Fc motor_city > ~/motor_city-$(date +%F).dump

# Restore into an empty database
sudo -u postgres pg_restore -d motor_city --clean --if-exists ~/motor_city-2026-08-03.dump
```

Schema changes apply themselves when the application starts, because `MIGRATE_ON_START=true` is
set in `/etc/motor-city.env` and every statement is written to be safe to re-run. There is no
separate migration step during a deploy.

Games and their player data are deleted automatically 12 hours after session creation.

## Optimal-run worker

Reference calculations use the MIT-licensed HiGHS WebAssembly solver in one worker thread. Only
one job runs at a time; at most eight wait. A 1-100-round job receives a 10-180 second solver limit
plus a short shutdown grace period. At most 64 completed or failed jobs remain in process memory,
and entries older than 12 hours are removed on the next optimizer request. They are lost harmlessly
on restart; pressing **Calculate reference run** starts or reuses one.

The systemd unit caps the application and optimizer worker together at 150% CPU and 1 GiB memory.
On the production 2-vCPU, 4-GiB host, that leaves at least half a CPU and 3 GiB outside the service
for PostgreSQL and the operating system while preserving a full core for HiGHS.

The worker artifact must exist at `/opt/motor-city/dist-server/optimizer-worker.js`, while the
HiGHS WASM runtime lives under production `node_modules`. The update script refuses to swap a
release missing the worker. A failed worker does not affect gameplay or PostgreSQL.

## When something is wrong

| Symptom | Where to look |
| --- | --- |
| Site returns 502 | `systemctl status motor-city`, then `journalctl -u motor-city -n 50`. Caddy is up but the app is not. |
| Site does not resolve or times out | Security group, then `systemctl status caddy`. |
| Certificate errors | `journalctl -u caddy -n 100`. Renewal needs `:443` reachable from the internet. |
| App will not start | Almost always PostgreSQL. Check `systemctl status postgresql` and the `DATABASE_URL` in `/etc/motor-city.env`. |
| Deploy failed | It rolled itself back. Read the output — the build error is printed above the rollback. |
| Optimal Run stays queued | Another class is calculating. Wait; only one solver job runs at once. |
| Optimal Run says unavailable | Retry once. Check `journalctl -u motor-city`; gameplay is unaffected. |
| Old game broken | Nothing here touches it. Check nginx and MariaDB. Confirm nobody upgraded system Node. |

## Known gaps

- **SSH is reachable from any address.** It only needs to accept EC2 Instance Connect, so it
  could be narrowed to that service's managed prefix list for the region.
- **One instance, no redundancy.** A class in progress would be interrupted by an instance
  failure. Acceptable for teaching use; not for anything else.
- **Backups are manual.** Take a dump before anything unusual.

Inbound access is limited to HTTP, HTTPS, SSH and ICMP; no database port is reachable from
outside the instance. Specific instance, security-group and account identifiers are
deliberately not recorded here.
