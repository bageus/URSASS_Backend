import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_SCORE = 999_999;

// Text box calibrated for img/score_result1600х800.png template.
const SCORE_BOX = {
  x: 108,
  y: 242,
  width: 812,
  height: 164,
  rotationDeg: -12
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeScore(score: number | string): string {
  const raw = String(score).trim();
  if (!/^\d{1,6}$/.test(raw)) {
    throw new Error('score must be an integer from 0 to 999999');
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SCORE) {
    throw new Error('score must be an integer from 0 to 999999');
  }

  return String(parsed);
}

function getFontSize(length: number): number {
  if (length <= 2) return 168;
  if (length <= 4) return 156;
  if (length === 5) return 146;
  return 134;
}

function buildScoreSvg(score: string, width: number, height: number): string {
  const scaleX = width / 1600;
  const scaleY = height / 800;

  const box = {
    x: SCORE_BOX.x * scaleX,
    y: SCORE_BOX.y * scaleY,
    width: SCORE_BOX.width * scaleX,
    height: SCORE_BOX.height * scaleY,
    rotationDeg: SCORE_BOX.rotationDeg
  };

  const textX = box.x + box.width / 2;
  const textY = box.y + box.height / 2;
  const fontSize = getFontSize(score.length) * Math.min(scaleX, scaleY);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <filter id="scoreGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#22d3ee" flood-opacity="0.75"/>
      <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <g transform="rotate(${box.rotationDeg} ${textX} ${textY})">
    <text
      x="${textX}"
      y="${textY}"
      fill="url(#scoreGradient)"
      font-family="Anton, Impact, Arial Black, sans-serif"
      font-size="${fontSize}"
      font-weight="900"
      text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="2"
      lengthAdjust="spacingAndGlyphs"
      textLength="${box.width * 0.9}"
      filter="url(#scoreGlow)"
    >${escapeXml(score)}</text>
  </g>
</svg>`;
}

export async function generateScoreBanner(params: {
  baseImagePath: string;
  score: number | string;
  outputPath?: string;
}): Promise<Buffer> {
  const scoreText = normalizeScore(params.score);
  const metadata = await sharp(params.baseImagePath).metadata();
  const width = metadata.width ?? 1600;
  const height = metadata.height ?? 800;

  const svg = buildScoreSvg(scoreText, width, height);
  const overlayBuffer = Buffer.from(svg);

  const resultBuffer = await sharp(params.baseImagePath)
    .composite([{ input: overlayBuffer, left: 0, top: 0 }])
    .png()
    .toBuffer();

  if (params.outputPath) {
    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, resultBuffer);
  }

  return resultBuffer;
}
