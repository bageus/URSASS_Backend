const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app.js declares ROUTE_REGISTRY only once', () => {
  const appJsPath = path.join(__dirname, '..', 'app.js');
  const source = fs.readFileSync(appJsPath, 'utf8');

  const matches = source.match(/const\s+ROUTE_REGISTRY\s*=\s*\[/g) || [];
  assert.equal(matches.length, 1, `Expected exactly one ROUTE_REGISTRY declaration, got ${matches.length}`);
});
