#!/usr/bin/env node
const path = require('path');
const { execFileSync } = require('child_process');

const base = path.join(process.cwd(), 'img', 'score_result.png');
const outDir = path.join(process.cwd(), 'tmp', 'score-examples');
const scores = [1, 9999, 223232, 999999];

for (const score of scores) {
  const out = path.join(outDir, `score-${score}.png`);
  execFileSync('node', ['scripts/generate-score.js', '--base', base, '--score', String(score), '--out', out], { stdio: 'inherit' });
}
