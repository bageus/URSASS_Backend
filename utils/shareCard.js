const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SCORE_TEMPLATE_PATH = path.join(__dirname, '..', 'img', 'score_result.png');

const SCORE_LAYOUT = {
  canvas: { width: 2048, height: 2048 },
  box: { x: 80, y: 610, width: 1050, height: 390 },
  fontFamily: 'Anton, Impact, Arial Black, sans-serif',
  fontWeight: 900,
  fontSizeDefault: 330,
  fontSizeMin: 200,
  fontSizeMax: 390,
  skewX: -6,
  fill: '#FFFFFF',
  strokeColor: '#E7E2FF',
  strokeWidth: 2,
  shadowColor: '#6A4CFF',
  shadowBlur: 28,
  shadowOffsetX: 0,
  shadowOffsetY: 8,
  maxWidth: 1030
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateTextWidth(text, fontSize) {
  // Visual approximation for condensed heavy fonts (Anton/Impact)
  return text.length * fontSize * 0.62;
}

async function renderScoreSharePng(score) {
  if (!sharp) {
    const err = new Error('PNG rendering unavailable');
    err.code = 'share_png_unavailable';
    throw err;
  }

  const normalized = Math.max(0, Math.floor(Number(score || 0)));
  const templateMeta = await sharp(SCORE_TEMPLATE_PATH).metadata();
  const w = templateMeta.width || 1254;
  const h = templateMeta.height || 1254;

  const scaleX = w / SCORE_LAYOUT.canvas.width;
  const scaleY = h / SCORE_LAYOUT.canvas.height;
  const scoreText = String(normalized);

  const box = {
    x: Math.round(SCORE_LAYOUT.box.x * scaleX),
    y: Math.round(SCORE_LAYOUT.box.y * scaleY),
    width: Math.round(SCORE_LAYOUT.box.width * scaleX),
    height: Math.round(SCORE_LAYOUT.box.height * scaleY)
  };

  const maxWidth = Math.round(SCORE_LAYOUT.maxWidth * scaleX);
  const defaultSize = SCORE_LAYOUT.fontSizeDefault * scaleY;
  const minSize = SCORE_LAYOUT.fontSizeMin * scaleY;
  const maxSize = SCORE_LAYOUT.fontSizeMax * scaleY;
  const estimatedAtDefault = estimateTextWidth(scoreText, defaultSize);
  const sizeAdjusted = estimatedAtDefault > 0
    ? defaultSize * (maxWidth / estimatedAtDefault)
    : defaultSize;
  const fontSize = clamp(sizeAdjusted, minSize, maxSize);

  const textX = box.x;
  const textY = box.y + (box.height / 2);
  const strokeWidth = Math.max(1, Math.round(SCORE_LAYOUT.strokeWidth * ((scaleX + scaleY) / 2)));
  const shadowBlur = Math.max(2, Math.round(SCORE_LAYOUT.shadowBlur * ((scaleX + scaleY) / 2)));
  const shadowOffsetX = Math.round(SCORE_LAYOUT.shadowOffsetX * scaleX);
  const shadowOffsetY = Math.round(SCORE_LAYOUT.shadowOffsetY * scaleY);

  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>` +
    `<filter id="scoreGlow" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="${shadowOffsetX}" dy="${shadowOffsetY}" stdDeviation="${shadowBlur / 2}" flood-color="${SCORE_LAYOUT.shadowColor}" flood-opacity="0.95"/>` +
    `</filter>` +
    `</defs>` +
    `<text x="${textX}" y="${Math.round(textY)}"` +
    ` font-family="${SCORE_LAYOUT.fontFamily}"` +
    ` font-size="${Math.round(fontSize)}"` +
    ` font-weight="${SCORE_LAYOUT.fontWeight}"` +
    ` fill="${SCORE_LAYOUT.fill}"` +
    ` stroke="${SCORE_LAYOUT.strokeColor}"` +
    ` stroke-width="${strokeWidth}"` +
    ` paint-order="stroke fill"` +
    ` filter="url(#scoreGlow)"` +
    ` dominant-baseline="middle"` +
    ` text-anchor="start"` +
    ` transform="skewX(${SCORE_LAYOUT.skewX})"` +
    ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs">` +
    `${escapeXml(scoreText)}</text>` +
    `</svg>`
  );

  return sharp(SCORE_TEMPLATE_PATH)
    .composite([{ input: svgOverlay, blend: 'over' }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

module.exports = {
  renderScoreSharePng
};
