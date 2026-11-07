const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

class VisualEvidenceReporter {
  constructor(options = {}) { this.outputRoot = path.resolve(options.outputRoot || 'test-results/visual-evidence'); }
  onBegin(config, suite) {
    this.directory = path.join(this.outputRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
    fs.mkdirSync(this.directory, { recursive: true });
    this.rows = [];
    this.planned = suite ? suite.allTests().filter(t => t.location.file.includes(`${path.sep}visual${path.sep}`)).map(t => t.title) : [];
    this.configuration = { workers: config?.workers, updateSnapshots: config?.updateSnapshots, maxDiffPixels: 50, goldenAnimations: 'disabled' };
    this.baseline = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() };
    this.write();
  }
  onTestEnd(test, result) {
    if (!test.location.file.includes(`${path.sep}visual${path.sep}`)) return;
    const id = test.title.replace(/[^a-z0-9-]/gi, '-');
    const dir = path.join(this.directory, id + '-retry-' + result.retry);
    fs.mkdirSync(dir, { recursive: true });
    const metadata = result.attachments.find(a => a.name === 'visual-metadata');
    const details = metadata?.body ? JSON.parse(metadata.body.toString()) : {};
    const artifacts = [];
    for (const [i, a] of result.attachments.entries()) {
      // Only explicitly attached synthetic images/traces/geometry, never directories/profiles.
      if (!a.path || !/\.(png|zip|json)$/.test(a.path) || !/^(?:synthetic-(?:actual|composition|trace|geometry)|screenshot|trace)$|-(?:expected|actual|diff)\.png$/.test(a.name || '')) continue;
      const name = i + '-' + path.basename(a.path).replace(/[^a-z0-9._-]/gi, '-');
      fs.copyFileSync(a.path, path.join(dir, name));
      artifacts.push(path.relative(this.directory, path.join(dir, name)).split(path.sep).join('/'));
    }
    const status = result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed';
    this.rows.push({ scenario: test.title, attempt: result.retry, ...details, status,
      behavioralResult: details.behavioralResult || 'unavailable', geometryResult: details.geometryResult || 'unavailable', visualResult: details.visualResult || 'unavailable', artifacts });
    this.write();
  }
  onEnd(result) { this.overall = result.status === 'passed' ? 'passed' : 'failed'; this.write(); }
  write() {
    const missing = this.planned.filter(name => !this.rows.some(r => r.scenario === name)).map(scenario => ({ scenario, status: 'unavailable', behavioralResult: 'unavailable', geometryResult: 'unavailable', visualResult: 'unavailable', reason: 'No completed test attempt', artifacts: [] }));
    const report = { schemaVersion: 1, ...this.baseline, environment: { platform: process.platform, osRelease: os.release(), node: process.version, playwright: require('@playwright/test/package.json').version }, configuration: this.configuration, overall: this.overall || 'unavailable', scenarios: [...this.rows, ...missing] };
    report.coverageResult = report.scenarios.some(r => r.status === 'failed') ? 'failed' : !report.scenarios.length || report.scenarios.some(r => r.status !== 'passed' || r.visualResult !== 'passed') ? 'unavailable' : 'passed';
    fs.writeFileSync(path.join(this.directory, 'manifest.json'), JSON.stringify(report, null, 2));
    const links = report.scenarios.map(r => `| ${r.scenario} | ${r.status} | ${r.visualResult} | ${r.artifacts.map(a => `[${path.basename(a)}](${a})`).join(' ')} |`).join('\n');
    fs.writeFileSync(path.join(this.directory, 'index.md'), `# Synthetic visual review\n\nCommit: ${this.baseline.commit}; dirty: ${this.baseline.dirty}; coverage: ${report.coverageResult}\n\n| Scenario | Test | Visual | Evidence |\n| --- | --- | --- | --- |\n${links}\n`);
  }
}
module.exports = VisualEvidenceReporter;
