# Security

## Immediate legacy actions

The public legacy repository contains a plaintext database host, username, and password. Assume the credential is compromised even if the file is edited or deleted.

1. Rotate the database password.
2. Review database and host access logs.
3. Remove public database access and allow only the application security group or private network.
4. Stop exposing frontend port 3000 and API port 8080 directly to the internet.
5. Terminate TLS at the public edge and redirect HTTP to HTTPS.
6. Restrict CORS to the approved HTTPS origin.
7. Purge the secret from Git history only after rotation.

These actions are intentionally not automated here because they affect the running production environment.

## New-system requirements

- No secrets, credentials, IP addresses, or environment URLs in source.
- Secrets come from a managed secret store at runtime.
- The database has no public endpoint.
- Player and facilitator commands use distinct scoped credentials.
- Request bodies are schema-validated and size-limited.
- Mutations use transactions, version checks, and persisted idempotency keys.
- Logs exclude secrets and minimize player-identifying data.
- CI checks dependencies, tests, lint, and production builds.
- Backups have retention and a tested restoration procedure.

## Implemented controls

- Browser tokens are stored only in 12-hour HttpOnly, SameSite=Strict cookies.
- Rejoin requires a high-entropy recovery code and rotates both credentials.
- Recovery codes are delivered once in non-cacheable HTTPS JSON. Production proxies, APM agents, and application logging must redact authentication response bodies.
- Explicit revocation invalidates the stored token immediately.
- Only hashes of session and recovery secrets are persisted.
- The API accepts JSON bodies up to 16 KB, validates payloads, rate-limits authenticated sessions independently, and applies IP limits to credential endpoints.
- CSP, frame denial, and related headers are emitted by the production server.
- Player and facilitator roles are checked for every mutation.
- Per-player locks, optimistic versions, and 24-hour idempotency receipts protect commands; scheduled cleanup bounds receipt storage.
- Reports use transactional snapshots, and facilitator-selected report rounds are bounded by available play.
- Managed PostgreSQL requires a trusted TLS CA; production cannot use the embedded database.

## Deployed posture

The parallel deployment is hardened for teaching use, not for handling sensitive data.

- TLS terminates at Caddy on `:443` with automatically renewed Let's Encrypt certificates.
- The application binds to loopback only and is reachable solely through Caddy.
- PostgreSQL listens on loopback and authenticates with `scram-sha-256`.
- The database URL lives in `/etc/motor-city.env`, mode `600`, owned by root, and is never in
  source control. It is not yet in a managed secret store.
- The service runs as an unprivileged user under a systemd sandbox with `NoNewPrivileges`,
  `ProtectSystem=strict`, `ProtectHome`, and a restricted address family set.
- Deploys pull over SSH with a read-only deploy key, so the repository stays private.

Outstanding before this could be considered production-grade for anything beyond a classroom:

- Inbound rules inherited from the original deployment still need tightening.
- Credential rotation for the original system remains outstanding.
- No managed secret injection, no automated backups, no alarms, and no redundancy.

Live findings, hostnames and resource identifiers are tracked privately rather than in this
repository.

AWS deployment still requires private networking, managed secret injection, backup policy, alarms, and legacy credential rotation before public cutover.