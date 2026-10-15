import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('release: ofertas por produto, disponibilidade, relatos e pendências', () => {
  const result = spawnSync(process.execPath, ['scripts/check-release.mjs', '--self-test'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.stdout.match(/Fixture OK:/g)?.length, 21)
})
