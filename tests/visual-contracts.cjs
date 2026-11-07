const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkComposition } = require('./helpers/composition-check.cjs');
const Reporter = require('./helpers/visual-evidence-reporter.cjs');

test('composition guards reject missing views, leaked loading content, blank captures and incorrect ownership', () => {
  const good = { sourceIdMatches: true, size: { width: 680, height: 700 }, bounds: { width: 680, height: 700 }, contentBounds: { height: 700 }, views: [{ role: 'content', bounds: { y: 40 } }, { role: 'controls', bounds: { height: 40 }, zoom: 1 }], chromeMarker: 400, contentMarker: 576, magenta: 0 };
  checkComposition(good, 'desktop');
  checkComposition({ ...good, chromeMarker: 0, views: [{ role: 'content', bounds: { y: 0 } }, { role: 'controls', bounds: { height: 0 }, zoom: 1 }] }, 'fullscreen');
  const loading = { ...good, contentMarker: 0, views: [{ role: 'content', bounds: { y: 40 } }, { role: 'controls', bounds: { height: 700 }, zoom: 1 }] };
  checkComposition(loading, 'loading');
  for (const broken of [{ chromeMarker: 0 }, { contentMarker: 0 }, { sourceIdMatches: false }, { views: [{}] }, { size: { width: 1, height: 1 } }, { size: { width: 0, height: 0 } }]) {
    assert.throws(() => checkComposition({ ...good, ...broken }, 'desktop'));
  }
  assert.throws(() => checkComposition({ ...loading, contentMarker: 576 }, 'loading'));
  assert.throws(() => checkComposition({ ...loading, magenta: 1 }, 'loading'));
});

test('failure manifests preserve unavailable checks and copy only allowlisted synthetic attachments', () => {
  const runs = path.resolve('test-results/runs'); fs.mkdirSync(runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(runs, 'evidence-contract-'));
  const reporter = new Reporter({ outputRoot: path.join(scratch, 'report') });
  reporter.onBegin({}, { allTests: () => [{ title: 'never executed', location: { file: path.resolve('tests/visual/contract.spec.js') } }] });
  const png = path.join(scratch, 'synthetic.png'); fs.writeFileSync(png, 'synthetic-contract');
  const profile = path.join(scratch, 'profile.sqlite'); fs.writeFileSync(profile, 'synthetic-contract');
  const profileJson = path.join(scratch, 'profile.json'); fs.writeFileSync(profileJson, '{}');
  const geometry = path.join(scratch, 'frames.json'); fs.writeFileSync(geometry, '{"x":60}');
  reporter.onTestEnd({ title: 'contract interrupted synthetic scenario', location: { file: path.resolve('tests/visual/contract.spec.js') } },
    { status: 'interrupted', retry: 0, attachments: [{ name: 'synthetic-actual', path: png }, { name: 'synthetic-geometry', path: geometry }, { name: 'profile', path: profile }, { name: 'profile', path: profileJson }] });
  reporter.onEnd({ status: 'failed' });
  const manifest = JSON.parse(fs.readFileSync(path.join(reporter.directory, 'manifest.json')));
  assert.equal(manifest.schemaVersion, 1);
  const row = manifest.scenarios[0];
  assert.equal(row.status, 'failed');
  for (const key of ['behavioralResult', 'geometryResult', 'visualResult']) assert.equal(row[key], 'unavailable');
  assert.equal(row.artifacts.length, 2);
  assert.ok(row.artifacts[0].endsWith('.png'));
  assert.ok(row.artifacts[1].endsWith('.json'));
  assert.ok(!JSON.stringify(manifest).includes(scratch));
  assert.ok(fs.readFileSync(path.join(reporter.directory, 'index.md'), 'utf8').includes('unavailable'));
  assert.equal(manifest.scenarios[1].scenario, 'never executed');
  assert.equal(manifest.scenarios[1].status, 'unavailable');
  assert.equal(manifest.coverageResult, 'failed');
});

test('CI rejects explicit snapshot regeneration before tests launch', () => {
  const child = spawnSync(process.execPath, ['-e', "require('./playwright.config.js')", '--', '--update-snapshots'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, CI: '1' }, encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /baseline updates are local review operations/);
  const compare = spawnSync(process.execPath, ['-e', "require('./playwright.config.js')", '--', '--update-snapshots=none'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, CI: '1' }, encoding: 'utf8' });
  assert.equal(compare.status, 0, compare.stderr);
});

test('CI upload is restricted to synthetic evidence with seven-day retention', () => {
  const workflow = fs.readFileSync(path.resolve('.github/workflows/quality.yml'), 'utf8');
  const upload = workflow.slice(workflow.indexOf('- name: Retain synthetic visual failure evidence'));
  assert.match(upload, /if: failure\(\)/);
  assert.match(upload, /path: test-results\/visual-evidence\//);
  assert.match(upload, /retention-days: 7/);
  assert.doesNotMatch(upload, /path: test-results\/\s*(?:\r?\n)/);
});
