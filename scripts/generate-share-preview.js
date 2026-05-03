#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { renderScoreSharePng } = require('../utils/shareCard');

async function main() {
  const score = Number(process.argv[2] || 123456);
  const outputRel = process.argv[3] || 'tmp/share-preview.png';
  const outputPath = path.join(process.cwd(), outputRel);

  const buffer = await renderScoreSharePng(score);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
