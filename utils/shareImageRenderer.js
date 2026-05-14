const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { spawnSync } = require('child_process');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

const BASE_TEMPLATE_PATH = path.join(__dirname, '..', 'img', 'score_result1600x800.png');
const GENERATED_DIR = path.join(__dirname, '..', 'generated', 'share-images');

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 800;
const RENDER_VERSION = 'score-v4-fontfix';

const SCORE_BOX = {
  x: 600,
  y: 285,
  width: 520,
  height: 190
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getScoreFontSize(scoreText) {
  const len = scoreText.length;
  if (len <= 5) return 168;
  if (len === 6) return 150;
  if (len === 7) return 132;
  return 116;
}

function buildOverlaySvg({ scoreText, fontSize, debugBox }) {
  const centerX = SCORE_BOX.x + (SCORE_BOX.width / 2);
  const centerY = SCORE_BOX.y + (SCORE_BOX.height / 2);

  return Buffer.from(
    `<svg width="1600" height="800" viewBox="0 0 1600 800" xmlns="http://www.w3.org/2000/svg">` +
      '<defs>' +
        '<linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="#ffffff"/>' +
          '<stop offset="35%" stop-color="#d8c7ff"/>' +
          '<stop offset="70%" stop-color="#a855f7"/>' +
          '<stop offset="100%" stop-color="#22d3ee"/>' +
        '</linearGradient>' +
        '<filter id="scoreGlow" x="-30%" y="-30%" width="160%" height="160%">' +
          '<feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#8b5cf6" flood-opacity="0.65"/>' +
          '<feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#22d3ee" flood-opacity="0.35"/>' +
        '</filter>' +
      '</defs>' +
      (debugBox
        ? `<rect x="${SCORE_BOX.x}" y="${SCORE_BOX.y}" width="${SCORE_BOX.width}" height="${SCORE_BOX.height}" fill="none" stroke="red" stroke-width="4"/>`
        : '') +
      `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="900" font-family="DejaVu Sans Condensed, DejaVu Sans, Liberation Sans, Arial, sans-serif" letter-spacing="2" fill="url(#scoreGradient)" stroke="rgba(10, 6, 30, 0.75)" stroke-width="5" paint-order="stroke fill" filter="url(#scoreGlow)">${escapeXml(scoreText)}</text>` +
    '</svg>'
  );
}


let fontDiagnosticsLogged = false;

function runFontCommand(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.error) {
    logger.warn({ cmd, args, error: res.error.message }, 'Font diagnostics command unavailable');
    return { ok: false, unavailable: true };
  }
  if (res.status !== 0) {
    logger.warn({ cmd, args, status: res.status, stderr: res.stderr?.trim() }, 'Font diagnostics command failed');
    return { ok: false, unavailable: false };
  }
  logger.info({ cmd, args, output: (res.stdout || '').trim() }, 'Font diagnostics command output');
  return { ok: true, unavailable: false };
}

function logFontDiagnostics() {
  if (fontDiagnosticsLogged) return;
  fontDiagnosticsLogged = true;

  logger.info({
    fontconfigPath: process.env.FONTCONFIG_PATH,
    fontconfigFile: process.env.FONTCONFIG_FILE,
    sharpVersions: sharp?.versions,
    baseTemplatePath: BASE_TEMPLATE_PATH,
    baseTemplateExists: fs.existsSync(BASE_TEMPLATE_PATH)
  }, 'Share image font runtime diagnostics');

  const debugFonts = String(process.env.DEBUG_SHARE_IMAGE_FONTS || '').toLowerCase() === 'true';
  if (!debugFonts) return;

  const dejavu = runFontCommand('fc-match', ['DejaVu Sans Condensed']);
  const liberation = runFontCommand('fc-match', ['Liberation Sans']);
  runFontCommand('sh', ['-c', 'fc-list | head']);

  if (!dejavu.ok || !liberation.ok) {
    logger.warn('fontconfig unavailable, SVG text may render incorrectly');
  }
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

  logFontDiagnostics();

  const scoreText = String(Math.max(0, Math.floor(Number(score) || 0)));
  const fontSize = getScoreFontSize(scoreText);
  const debugBox = String(process.env.DEBUG_SHARE_IMAGE_BOX || '').toLowerCase() === 'true';

  const baseMeta = await sharp(BASE_TEMPLATE_PATH).metadata();
  const overlaySvg = buildOverlaySvg({ scoreText, fontSize, debugBox });

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const outputPath = path.join(GENERATED_DIR, `${shareId}-${RENDER_VERSION}.png`);

  await sharp(BASE_TEMPLATE_PATH)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
    .composite([{ input: overlaySvg, blend: 'over', top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toFile(outputPath);

  const outputMeta = await sharp(outputPath).metadata();
  if (outputMeta.width !== OUTPUT_WIDTH || outputMeta.height !== OUTPUT_HEIGHT) {
    const err = new Error('Unexpected output image dimensions');
    err.code = 'invalid_output_size';
    throw err;
  }

  logger.info({
    shareId,
    scoreText,
    scoreBox: SCORE_BOX,
    fontSize,
    outputPath,
    templateWidth: baseMeta.width,
    templateHeight: baseMeta.height,
    outputWidth: outputMeta.width,
    outputHeight: outputMeta.height
  }, 'Share score image rendered');

  return {
    outputPath,
    relativeUrl: `/generated/share-images/${encodeURIComponent(shareId)}-${RENDER_VERSION}.png`
  };
}

module.exports = {
  renderShareScoreImage,
  getScoreFontSize
};
