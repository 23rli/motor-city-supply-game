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
```

## Getting a shell

The instance has no permanent SSH key. Access goes through EC2 Instance Connect from AWS
CloudShell, which issues a key valid for 60 seconds — so the two commands must stay chained.

```bash
INSTANCE=i-03556a1e691eb51d8
AZ=us-east-2a

[ -f ~/.ssh/mc ] || ssh-keygen -t ed25519 -N '' -f ~/.ssh/mc
aws ec2-instance-connect send-ssh-public-key \
  --instance-id $INSTANCE --instance-os-user ec2-user \
  --availability-zone $AZ --ssh-public-key file://$HOME/.ssh/mc.pub >/dev/null \
&& ssh -i ~/.ssh/mc -o StrictHostKeyChecking=no ec2-user@3.129.12.15
```

`~` is not expanded inside `file://`, hence `$HOME`. The two commands are chained because the
pushed key expires after 60 seconds.

`sudo` needs no password.

## Shipping a new version

```bash
sudo bash /opt/motor-city/src/deploy/update.sh
```

That builds the new version first and only swaps it in once the build succeeds, so a broken
commit cannot take the site down. If the new version does not answer `/api/health` within
20 seconds it puts the previous one back and exits non-zero.

Pass a branch or tag to deploy something other than `main`:

```bash
sudo bash /opt/motor-city/src/deploy/update.sh my-branch
```

To go back a version deliberately:

```bash
sudo bash /opt/motor-city/src/deploy/rollback.sh
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

Sessions older than 12 hours are cleared automatically.

## When something is wrong

| Symptom | Where to look |
| --- | --- |
| Site returns 502 | `systemctl status motor-city`, then `journalctl -u motor-city -n 50`. Caddy is up but the app is not. |
| Site does not resolve or times out | Security group, then `systemctl status caddy`. |
| Certificate errors | `journalctl -u caddy -n 100`. Renewal needs `:443` reachable from the internet. |
| App will not start | Almost always PostgreSQL. Check `systemctl status postgresql` and the `DATABASE_URL` in `/etc/motor-city.env`. |
| Deploy failed | It rolled itself back. Read the output — the build error is printed above the rollback. |
| Old game broken | Nothing here touches it. Check nginx and MariaDB. Confirm nobody upgraded system Node. |

## Known gaps

- **Port 3306 is open to `0.0.0.0/0`** on security group `sg-0ee12fcdc7dc5f5d4`. The old game
  reaches MariaDB over loopback, so removing that inbound rule is safe and should be done. Leave
  port 22 alone — Instance Connect needs it.
- **One instance, no redundancy.** A class in progress would be interrupted by an instance
  failure. Acceptable for teaching use; not for anything else.
- **Backups are manual.** Take a dump before anything unusual.
