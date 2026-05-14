const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

const BASE_TEMPLATE_PATH = path.join(__dirname, '..', 'img', 'score_result1600x800.png');
const GENERATED_DIR = path.join(__dirname, '..', 'generated', 'share-images');

const SCORE_LAYOUT = {
  x: 610,
  y: 404,
  width: 510,
  height: 155,
  fontFamily: "'Arial Black', Impact, 'Anton', sans-serif",
  fontSizeDefault: 170,
  fontSizeMin: 110,
  fontSizeMax: 190,
  letterSpacing: 1.5,
  skewX: -8,
  gradientStart: '#ffffff',
  gradientEnd: '#c59bff',
  glowColor: '#7d3cff',
  strokeColor: '#f7ecff'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estimateWidth(text, fontSize) {
  return text.length * fontSize * 0.62;
}

function buildSkewTransform(cx, cy, skewX) {
  return `translate(${cx} ${cy}) skewX(${skewX}) translate(${-cx} ${-cy})`;
}

async function renderShareScoreImage({ shareId, score }) {
  if (!sharp) {
    const err = new Error('PNG rendering unavailable');
    err.code = 'share_png_unavailable';
    throw err;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(String(shareId || ''))) {
    const err = new Error('Invalid shareId');
    err.code = 'invalid_share_id';
    throw err;
  }

  const normalizedScore = Math.max(0, Math.floor(Number(score || 0)));
  const templateMeta = await sharp(BASE_TEMPLATE_PATH).metadata();
  const width = templateMeta.width || 1600;
  const height = templateMeta.height || 800;

  const scaleX = width / 1600;
  const scaleY = height / 800;
  const layout = {
    x: Math.round(SCORE_LAYOUT.x * scaleX),
    y: Math.round(SCORE_LAYOUT.y * scaleY),
    width: Math.round(SCORE_LAYOUT.width * scaleX),
    height: Math.round(SCORE_LAYOUT.height * scaleY)
  };

  const scoreText = String(normalizedScore);
  const defaultSize = SCORE_LAYOUT.fontSizeDefault * scaleY;
  const sizeFromWidth = defaultSize * (layout.width / Math.max(estimateWidth(scoreText, defaultSize), 1));
  const fontSize = clamp(sizeFromWidth, SCORE_LAYOUT.fontSizeMin * scaleY, SCORE_LAYOUT.fontSizeMax * scaleY);
  const centerX = Math.round(layout.x + (layout.width / 2));
  const centerY = Math.round(layout.y + (layout.height / 2));

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      '<defs>' +
        '<linearGradient id="scoreGradient" x1="0%" y1="0%" x2="0%" y2="100%">' +
          `<stop offset="0%" stop-color="${SCORE_LAYOUT.gradientStart}"/>` +
          `<stop offset="100%" stop-color="${SCORE_LAYOUT.gradientEnd}"/>` +
        '</linearGradient>' +
        '<filter id="scoreGlow" x="-40%" y="-40%" width="180%" height="180%">' +
          `<feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="${SCORE_LAYOUT.glowColor}" flood-opacity="0.95"/>` +
          `<feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="${SCORE_LAYOUT.glowColor}" flood-opacity="0.72"/>` +
        '</filter>' +
      '</defs>' +
      `<text x="${centerX}" y="${centerY}" font-family="${SCORE_LAYOUT.fontFamily}" font-size="${Math.round(fontSize)}" font-weight="900" letter-spacing="${SCORE_LAYOUT.letterSpacing}" fill="url(#scoreGradient)" stroke="${SCORE_LAYOUT.strokeColor}" stroke-width="2" paint-order="stroke fill" dominant-baseline="middle" text-anchor="middle" filter="url(#scoreGlow)" transform="${buildSkewTransform(centerX, centerY, SCORE_LAYOUT.skewX)}">${escapeXml(scoreText)}</text>` +
    '</svg>'
  );

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const outputPath = path.join(GENERATED_DIR, `${shareId}.png`);
  await sharp(BASE_TEMPLATE_PATH).composite([{ input: svg, blend: 'over' }]).png({ compressionLevel: 8 }).toFile(outputPath);

  return {
    outputPath,
    relativeUrl: `/generated/share-images/${encodeURIComponent(shareId)}.png`
  };
}

module.exports = {
  renderShareScoreImage
};
