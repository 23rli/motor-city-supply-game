/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const install = read('../deploy/install.sh')
const update = read('../deploy/update.sh')
const rollback = read('../deploy/rollback.sh')
const service = read('../deploy/motor-city.service')
const operations = read('../docs/OPERATIONS.md')

describe('deployment controls', () => {
  it('installs root-owned control scripts and enables the application service', () => {
    expect(install).toContain(
      'install -o root -g root -m 755 "$HERE/update.sh" /usr/local/sbin/motor-city-update',
    )
    expect(install).toContain(
      'install -o root -g root -m 755 "$HERE/rollback.sh" /usr/local/sbin/motor-city-rollback',
    )
    expect(install).toContain('systemctl enable motor-city')
    expect(install).toContain('systemctl disable --now caddy')
    expect(service).not.toContain('ReadWritePaths=/opt/motor-city')
    expect(operations).toContain('sudo /usr/local/sbin/motor-city-update')
    expect(operations).toContain('sudo /usr/local/sbin/motor-city-rollback')
    expect(operations).not.toContain('sudo bash /opt/motor-city/src/deploy/')
  })

  it('requires production migrations and checks both API and SPA health', () => {
    expect(update).toContain("'^MIGRATE_ON_START=true[[:space:]]*$'")
    expect(update).toContain("'^NODE_ENV=production[[:space:]]*$'")
    expect(update).toContain('curl -fsS "http://127.0.0.1:$APP_PORT/api/health"')
    expect(update).toContain("grep -q 'id=\"root\"'")
    expect(rollback).toContain('for item in dist dist-server package.json package-lock.json node_modules')
    expect(rollback).toContain('release_healthy')
    expect(rollback).toContain('rollback-next')
    expect(rollback).toContain('rollback-failed')
    expect(update).toContain('trap on_error ERR INT TERM')
  })
})
