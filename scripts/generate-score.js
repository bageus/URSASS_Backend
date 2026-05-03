#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function validateScore(score) {
  const raw = String(score || '').trim();
  if (!/^\d+$/.test(raw)) throw new Error('score must be an integer between 0 and 999999');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 999999) throw new Error('score must be an integer between 0 and 999999');
  return String(value);
}

function buildScoreSvg(score, width = 1024, height = 1024) {
  const block = {
    x: width * (70 / 1024),
    y: height * (310 / 1024),
    width: width * (520 / 1024),
    height: height * (210 / 1024),
    radius: Math.min(width, height) * (24 / 1024)
  };
  const scale = Math.min(width, height) / 1024;
  const fontSize = score.length <= 4 ? 128 * scale : 108 * scale;
  const textX = block.x + block.width / 2;
  const textY = block.y + block.height / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="scoreTextGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient><linearGradient id="boxFill" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#111327"/><stop offset="100%" stop-color="#1f233d"/></linearGradient><filter id="boxGlow" x="-40%" y="-60%" width="180%" height="220%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#05060f" flood-opacity="0.8"/><feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#22d3ee" flood-opacity="0.5"/></filter><filter id="textGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#22d3ee" flood-opacity="0.7"/></filter></defs><g transform="rotate(-12 ${textX} ${textY})"><rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" rx="${block.radius}" fill="url(#boxFill)" stroke="#67e8f9" stroke-width="5" filter="url(#boxGlow)"/><text x="${textX}" y="${textY}" fill="url(#scoreTextGradient)" font-family="Anton, Impact, Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="middle" dominant-baseline="middle" letter-spacing="2" lengthAdjust="spacingAndGlyphs" textLength="${block.width * 0.84}" filter="url(#textGlow)">${score}</text></g></svg>`;
}

async function generate(baseImagePath, score, outputPath) {
  const metadata = await sharp(baseImagePath).metadata();
  const svgBuffer = Buffer.from(buildScoreSvg(score, metadata.width || 1024, metadata.height || 1024));
  const out = await sharp(baseImagePath).composite([{ input: svgBuffer, left: 0, top: 0 }]).png().toBuffer();
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, out);
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base || './img/score_result.png';
  const score = validateScore(args.score);
  const out = args.out;
  await generate(base, score, out);
  process.stdout.write(`${out || '[buffer only]'}\n`);
})();
