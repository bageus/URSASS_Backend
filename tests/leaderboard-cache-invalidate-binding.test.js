const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('leaderboard route uses imported invalidateTopLeaderboardCache without local redeclare', () => {
  const filePath = path.join(__dirname, '..', 'routes', 'leaderboard.js');
  const source = fs.readFileSync(filePath, 'utf8');

  const importMatches = source.match(/invalidateTopLeaderboardCache\s*,/g) || [];
  const localFnMatches = source.match(/function\s+invalidateTopLeaderboardCache\s*\(/g) || [];

  assert.equal(importMatches.length >= 1, true, 'Expected invalidateTopLeaderboardCache to be imported');
  assert.equal(localFnMatches.length, 0, `Expected no local function redeclare, got ${localFnMatches.length}`);
});
