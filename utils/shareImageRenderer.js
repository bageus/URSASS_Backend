const fs = require('fs');
const path = require('path');
const logger = require('./logger');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

const BASE_TEMPLATE_PATH = path.join(__dirname, '..', 'img', 'score_result1600x800.png');
const GENERATED_DIR = path.join(__dirname, '..', 'generated', 'share-images');

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 800;
const RENDER_VERSION = 'score-v6-polished';

const SCORE_BOX = {
  x: 515,
  y: 292,
  width: 560,
  height: 165
};

const DIGIT_WIDTH = 78;
const DIGIT_HEIGHT = 128;
const SEGMENT_THICKNESS = 18;
const SLANT = 8;
const DIGIT_GAP = 12;

const DIGIT_SEGMENTS = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g']
};

function polygon(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function createHorizontalSegment(y, xStart = 0, xEnd = DIGIT_WIDTH) {
  const t = SEGMENT_THICKNESS;
  const inset = Math.max(4, Math.round(t * 0.45));
  const skew = SLANT;
  return polygon([
    [xStart + inset + skew, y],
    [xEnd - inset + skew, y],
    [xEnd + skew, y + t / 2],
    [xEnd - inset + skew, y + t],
    [xStart + inset + skew, y + t],
    [xStart + skew, y + t / 2]
  ]);
}

function createVerticalSegment(x, yStart, yEnd) {
  const t = SEGMENT_THICKNESS;
  const inset = Math.max(4, Math.round(t * 0.42));
  const skew = SLANT;
  return polygon([
    [x + skew, yStart + inset],
    [x + t + skew, yStart],
    [x + t + skew, yEnd - inset],
    [x + t / 2 + skew, yEnd],
    [x + skew, yEnd - inset],
    [x + skew - t / 2, yStart + inset]
  ]);
}

function getSegmentPolygon(segmentId) {
  const t = SEGMENT_THICKNESS;
  const middleY = Math.round((DIGIT_HEIGHT - t) / 2);

  const segmentMap = {
    a: createHorizontalSegment(0),
    g: createHorizontalSegment(middleY),
    d: createHorizontalSegment(DIGIT_HEIGHT - t),
    f: createVerticalSegment(0, t / 2 + 2, middleY + t / 2 - 2),
    b: createVerticalSegment(DIGIT_WIDTH - t, t / 2 + 2, middleY + t / 2 - 2),
    e: createVerticalSegment(0, middleY + t / 2 + 2, DIGIT_HEIGHT - t / 2 - 2),
    c: createVerticalSegment(DIGIT_WIDTH - t, middleY + t / 2 + 2, DIGIT_HEIGHT - t / 2 - 2)
  };

  return segmentMap[segmentId] || '';
}

function buildVectorDigits(scoreText) {
  let xOffset = 0;
  let svg = '';

  for (const digit of scoreText) {
    const activeSegments = DIGIT_SEGMENTS[digit] || [];
    svg += `<g transform="translate(${xOffset} 0)">`;
    for (const segmentId of activeSegments) {
      const points = getSegmentPolygon(segmentId);
      svg += `<polygon points="${points}" fill="url(#scoreGradient)" stroke="#10051f" stroke-width="2.5" stroke-linejoin="round"/>`;
    }
    svg += '</g>';
    xOffset += DIGIT_WIDTH + DIGIT_GAP;
  }

  return svg;
}

function buildOverlaySvg({ scoreText, debugBox, startX, startY, scale, totalWidth }) {
  const digitsBoundsWidth = totalWidth * scale;
  const digitsBoundsHeight = DIGIT_HEIGHT * scale;

  return Buffer.from(
    `<svg width="1600" height="800" viewBox="0 0 1600 800" xmlns="http://www.w3.org/2000/svg">` +
      '<defs>' +
        '<linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="#ffffff"/>' +
          '<stop offset="30%" stop-color="#e7d7ff"/>' +
          '<stop offset="60%" stop-color="#b779ff"/>' +
          '<stop offset="100%" stop-color="#38e8ff"/>' +
        '</linearGradient>' +
        '<filter id="scoreGlow" x="-40%" y="-40%" width="180%" height="180%">' +
          '<feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#8b5cf6" flood-opacity="0.65"/>' +
          '<feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#22d3ee" flood-opacity="0.35"/>' +
        '</filter>' +
      '</defs>' +
      (debugBox
        ? `<rect x="${SCORE_BOX.x}" y="${SCORE_BOX.y}" width="${SCORE_BOX.width}" height="${SCORE_BOX.height}" fill="none" stroke="red" stroke-width="4"/>` +
          `<rect x="${startX}" y="${startY}" width="${digitsBoundsWidth}" height="${digitsBoundsHeight}" fill="none" stroke="lime" stroke-width="2.5"/>`
        : '') +
      `<g transform="translate(${startX} ${startY}) scale(${scale})" filter="url(#scoreGlow)">` +
        buildVectorDigits(scoreText) +
      '</g>' +
    '</svg>'
  );
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

  let scoreText = String(Math.floor(Number(score)));
  if (!/^\d+$/.test(scoreText)) {
    scoreText = '0';
  }

  const debugBox = String(process.env.DEBUG_SHARE_IMAGE_BOX || '').toLowerCase() === 'true';

  const digitCount = scoreText.length;
  const totalWidth = (digitCount * DIGIT_WIDTH) + ((digitCount - 1) * DIGIT_GAP);
  const scale = Math.min(
    SCORE_BOX.width / totalWidth,
    SCORE_BOX.height / DIGIT_HEIGHT,
    1.0
  );

  const startX = SCORE_BOX.x + ((SCORE_BOX.width - (totalWidth * scale)) / 2);
  const startY = SCORE_BOX.y + ((SCORE_BOX.height - (DIGIT_HEIGHT * scale)) / 2);

  const baseMeta = await sharp(BASE_TEMPLATE_PATH).metadata();
  const overlaySvg = buildOverlaySvg({ scoreText, debugBox, startX, startY, scale, totalWidth });

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const outputPath = path.join(GENERATED_DIR, `${shareId}-${RENDER_VERSION}.png`);

  await sharp(BASE_TEMPLATE_PATH)
    .resize(1600, 800, { fit: 'fill' })
    .composite([{ input: overlaySvg, blend: 'over', top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toFile(outputPath);

  const outputMeta = await sharp(outputPath).metadata();
  if (outputMeta.width !== OUTPUT_WIDTH || outputMeta.height !== OUTPUT_HEIGHT) {
    const err = new Error('Unexpected output image dimensions');
    err.code = 'invalid_output_size';
    throw err;
  }

  const relativeUrl = `/generated/share-images/${encodeURIComponent(shareId)}-${RENDER_VERSION}.png`;

  logger.info({
    shareId,
    scoreText,
    renderMode: 'vector-digits',
    renderVersion: RENDER_VERSION,
    scoreBox: SCORE_BOX,
    digitWidth: DIGIT_WIDTH,
    digitHeight: DIGIT_HEIGHT,
    gap: DIGIT_GAP,
    totalWidth,
    scale,
    startX,
    startY,
    outputPath,
    relativeUrl,
    templateWidth: baseMeta.width,
    templateHeight: baseMeta.height,
    outputWidth: outputMeta.width,
    outputHeight: outputMeta.height
  }, 'Share vector score image rendered');

  return {
    outputPath,
    relativeUrl
  };
}

module.exports = {
  renderShareScoreImage
};
