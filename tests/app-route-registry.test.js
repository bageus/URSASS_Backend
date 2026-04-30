const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app.js exposes route registry via getRouteRegistry()', () => {
  const appJsPath = path.join(__dirname, '..', 'app.js');
  const source = fs.readFileSync(appJsPath, 'utf8');

  const functionMatches = source.match(/function\s+getRouteRegistry\s*\(/g) || [];
  assert.equal(functionMatches.length, 1, `Expected exactly one getRouteRegistry function, got ${functionMatches.length}`);

  assert.match(source, /mountApiRoutes\(app, '\/api'\)/);
  assert.match(source, /mountApiRoutes\(app, '\/api\/v1'\)/);
});
