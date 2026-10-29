const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('source package archives committed files and refuses overwrite or invalid revisions', () => {
  const runs = path.join(root, 'test-results', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(runs, 'release-'));
  const output = path.join(scratch, 'source.zip');
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(root, 'Build-Release.ps1'), '-OutputPath', output, ...args], { windowsHide: true, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const bytes = fs.readFileSync(output);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  let offset = bytes.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < bytes.readUInt16LE(end + 10); ++i) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const length = bytes.readUInt16LE(offset + 28);
    names.push(bytes.toString('utf8', offset + 46, offset + 46 + length));
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  assert.ok(names.includes('WindowHost/main.cjs'));
  assert.ok(names.includes('config.example.json'));
  for (const name of names) assert.doesNotMatch(name, /^(Browser|node_modules|logs|archive|test-results)\/|^config\.json$|\.(exe|zip|lnk)$/i);
  assert.notEqual(run().status, 0);
  assert.deepEqual(fs.readFileSync(output), bytes);
  const invalid = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(root, 'Build-Release.ps1'), '-Revision', 'missing-synthetic-revision', '-OutputPath', path.join(scratch, 'invalid.zip')], { windowsHide: true, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.equal(fs.existsSync(path.join(scratch, 'invalid.zip')), false);
  const unsafeRepo = path.join(scratch, 'unsafe-source');
  fs.mkdirSync(unsafeRepo);
  fs.copyFileSync(path.join(root, 'Build-Release.ps1'), path.join(unsafeRepo, 'Build-Release.ps1'));
  fs.writeFileSync(path.join(unsafeRepo, 'config.json'), '{"synthetic":true}');
  const git = (...args) => {
    const result = spawnSync('git', ['-C', unsafeRepo, ...args], { windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  git('add', 'config.json');
  git('-c', 'user.name=Synthetic test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic prohibited path');
  const refused = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(unsafeRepo, 'Build-Release.ps1'), '-OutputPath', path.join(scratch, 'unsafe.zip')], { windowsHide: true, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.equal(fs.existsSync(path.join(scratch, 'unsafe.zip')), false);
});
