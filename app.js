const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const gameRoutes = require('./routes/game');
const donationsRoutes = require('./routes/donations');
const analyticsRoutes = require('./routes/analytics');
const referralRoutes = require('./routes/referral');
const shareRoutes = require('./routes/share');
const xRoutes = require('./routes/x');
const logger = require('./utils/logger');
const Player = require('./models/Player');
const { sanitizeReferralCode, buildReferralLandingUrl, isSocialPreviewCrawler } = require('./utils/referral');
const { metricsMiddleware, markAliasRouteUsage, renderMetricsText } = require('./middleware/requestMetrics');
const { renderScoreSharePng } = require('./utils/shareCard');


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function getRouteRegistry() {
  return [
    { path: '/leaderboard', router: leaderboardRoutes },
    { path: '/store', router: storeRoutes },
    { path: '/account', router: accountRoutes },
    { path: '/game', router: gameRoutes },
    { path: '', router: donationsRoutes },
    { path: '/analytics', router: analyticsRoutes },
    { path: '/telemetry', router: analyticsRoutes },
    { path: '/referral', router: referralRoutes },
    { path: '/share', router: shareRoutes },
    { path: '/x', router: xRoutes }
  ];
}

function mountApiRoutes(app, basePrefix) {
  for (const { path, router } of getRouteRegistry()) {
    app.use(`${basePrefix}${path}`, router);
  }
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const extraAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedOrigins = [
    'https://bageus.github.io',
    'https://bageus-github-io.vercel.app',
    'https://ursass-tube.vercel.app',
    'https://ursasstube.fun',
    'https://www.ursasstube.fun',
    'https://play.ursasstube.fun',
    'https://api.ursasstube.fun',
    'http://localhost:3000',
    'http://localhost:5173',
    ...extraAllowedOrigins
  ];

  const allowedOriginSet = new Set(allowedOrigins);

  const isAllowedOrigin = (origin) => !origin || allowedOriginSet.has(origin);

  app.use((req, res, next) => {
    const requestId = req.get('x-request-id') || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  const corsOptions = {
    origin: function(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      logger.warn({ origin }, 'CORS blocked: origin mismatch');
      const corsError = new Error('Not allowed by CORS');
      corsError.statusCode = 403;
      corsError.expose = true;
      corsError.code = 'CORS_ORIGIN_MISMATCH';
      callback(corsError);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Wallet', 'X-Primary-Id', 'X-Telegram-Init-Data', 'x-telegram-init-data', 'X-Request-Id'],
    optionsSuccessStatus: 204
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/telemetry') || req.path.startsWith('/api/v1/telemetry')) {
      markAliasRouteUsage('telemetry');
    }

    if (req.path.startsWith('/api/analytics') || req.path.startsWith('/api/v1/analytics')) {
      markAliasRouteUsage('analytics');
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));


  const enableSharePreviewPublic = String(process.env.ENABLE_SHARE_PREVIEW_PUBLIC || '').toLowerCase() === 'true';
  if (enableSharePreviewPublic) {
    app.get('/api/debug/share-preview/:fileName', (req, res) => {
      const fileName = String(req.params.fileName || '').trim();
      if (!/^[a-zA-Z0-9._-]+\.png$/.test(fileName)) {
        return res.status(400).json({ error: 'invalid_file_name' });
      }

      const targetPath = path.join(process.cwd(), 'tmp', fileName);
      if (!fs.existsSync(targetPath)) {
        const match = /^share-preview-(\d+)\.png$/.exec(fileName);
        if (!match) {
          return res.status(404).json({ error: 'file_not_found' });
        }

        const score = Number(match[1]);
        renderScoreSharePng(score)
          .then((buffer) => {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, buffer);
            return res.sendFile(targetPath, {
              headers: {
                'Cache-Control': 'no-store'
              }
            });
          })
          .catch((err) => {
            if (err?.code === 'share_png_unavailable') {
              return res.status(503).json({ error: 'share_png_unavailable' });
            }
            logger.error({ err: err.message, fileName }, 'Share preview auto-generation failed');
            return res.status(500).json({ error: 'share_preview_generation_failed' });
          });
        return;
      }

      return res.sendFile(targetPath, {
        headers: {
          'Cache-Control': 'no-store'
        }
      });
    });
  }
  app.use(metricsMiddleware);

  app.get('/s/:refCode', async (req, res) => {
    try {
      const refCode = sanitizeReferralCode(req.params.refCode);
      if (!refCode) return res.status(400).send('Invalid referral code');

      const baseUrl = getPublicBaseUrl(req);
      const canonicalUrl = `${baseUrl}/s/${encodeURIComponent(refCode)}`;
      const isCrawler = isSocialPreviewCrawler(req.get('user-agent'));
      const player = await Player.findOne({ referralCode: refCode }).select('wallet bestScore referralCode');

      if (!player && !isCrawler) {
        const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || 'https://ursasstube.fun').trim().replace(/\/+$/, '');
        return res.redirect(302, `${frontendBaseUrl}/`);
      }

      const redirectUrl = buildReferralLandingUrl(refCode, req);
      if (!isCrawler) {
        return res.redirect(302, redirectUrl);
      }

      const score = Math.max(0, Number(player?.bestScore || 0));
      const title = player ? `I scored ${score} in Ursass Tube 🐻` : 'Play Ursass Tube 🐻';
      const description = player ? 'Can you beat me? Play Ursass Tube.' : 'Can you beat the high score?';
      const imageUrl = player?.wallet
        ? `${baseUrl}/api/leaderboard/share/image/${player.wallet}.png`
        : `${baseUrl}/img/score_result.png`;

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta property="og:type" content="website" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:image" content="${escapeHtml(imageUrl)}" /><meta property="og:url" content="${escapeHtml(canonicalUrl)}" /><meta property="og:site_name" content="Ursass Tube" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${escapeHtml(imageUrl)}" /><meta name="twitter:image:alt" content="Ursass Tube score card" /></head><body><p>Redirecting to Ursass Tube...</p><a href="${escapeHtml(redirectUrl)}">Play Ursass Tube</a></body></html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    } catch (error) {
      logger.error({ err: error.message, requestId: req.requestId }, 'GET /s/:refCode error');
      return res.status(500).json({ error: 'Server error', requestId: req.requestId });
    }
  });

  mountApiRoutes(app, '/api');
  mountApiRoutes(app, '/api/v1');

  // JSON 404 for any unmatched /api/* route (prevents Express default HTML response)
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.get('/health', (req, res) => {
    const mongoStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    const readyState = mongoose.connection?.readyState;
    const mongoStatus = mongoStates[readyState] || 'unknown';

    res.json({
      status: readyState === 1 ? 'OK' : 'DEGRADED',
      timestamp: new Date(),
      mongodb: mongoStatus,
      mongodbDetails: {
        readyState,
        status: mongoStatus
      }
    });
  });

  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(await renderMetricsText());
    } catch (error) {
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    const origin = req.get('origin');
    if (origin && isAllowedOrigin(origin) && !res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const statusCode = err.statusCode || err.status || 500;
    const shouldExposeMessage = Boolean(err.expose) || statusCode < 500;
    const errorCode = err.code || 'UNHANDLED_ERROR';

    logger.error({
      requestId: req.requestId,
      statusCode,
      errorCode,
      origin,
      path: req.originalUrl,
      method: req.method,
      err: err.message
    }, 'Request failed');

    res
      .status(statusCode)
      .json({
        error: shouldExposeMessage ? (err.message || 'Request failed') : 'Internal server error',
        code: errorCode,
        requestId: req.requestId
      });
  });

  return app;
}

module.exports = { createApp };
