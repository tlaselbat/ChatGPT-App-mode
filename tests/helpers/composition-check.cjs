const assert = require('node:assert/strict');
function checkComposition(result, state) {
  assert.equal(result.sourceIdMatches, true, 'Capture must belong to the fixture window');
  assert.ok(result.size.width > 0 && result.size.height > 0, 'Capture must have pixels');
  assert.equal(result.size.width, result.bounds.width, 'Unexpected capture width');
  assert.equal(result.size.height, result.bounds.height, 'Unexpected capture height');
  assert.equal(result.views.length, 2, 'Expected two composed views');
  const controls = result.views.find(view => view.role === 'controls');
  const content = result.views.find(view => view.role === 'content');
  assert.ok(controls && content, 'Expected independent controls and content views');
  assert.equal(controls.zoom, 1, 'Trusted controls must remain unzoomed');
  assert.equal(content.bounds.y, state === 'fullscreen' ? 0 : 40, 'Unexpected content origin');
  assert.equal(controls.bounds.height, state === 'fullscreen' ? 0 : state === 'loading' ? result.contentBounds.height : 40, 'Unexpected trusted cover height');
  if (state === 'fullscreen') assert.equal(result.chromeMarker, 0, 'Fullscreen must hide trusted chrome');
  else assert.ok(result.chromeMarker >= 100, 'Trusted chrome marker missing');
  if (state === 'loading') {
    assert.equal(result.magenta, 0, 'Loading cover leaked unstyled content');
    assert.equal(result.contentMarker, 0, 'Loading cover leaked remote content');
  } else assert.ok(result.contentMarker >= 100, 'Remote content marker missing');
}
module.exports = { checkComposition };
