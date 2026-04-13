const express = require('express');
const router = express.Router();
const { readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { getGameModeConfig } = require('../utils/gameModeConfig');
const { normalizeWallet } = require('../utils/security');
const { hasAiModeAccess } = require('../utils/aiModeAccess');

router.get('/config', readLimiter, async (req, res) => {
  try {
    const requestedMode = req.query.mode || 'unauth';

    const wallet = normalizeWallet(req.query.wallet);

    if (String(requestedMode).trim().toLowerCase() === 'unauth') {
      // Public guest mode: no auth/signature/wallet checks required.
      const config = getGameModeConfig('unauth');
      config.activeEffects = {
        ...(config.activeEffects || {}),
        ai_mode_access: hasAiModeAccess(wallet)
      };
      return res.json(config);
    }

    const config = getGameModeConfig(requestedMode);

    if (!config) {
      return res.status(404).json({
        error: `Unknown game mode config: ${requestedMode}`,
        requestId: req.requestId
      });
    }

    config.activeEffects = {
      ...(config.activeEffects || {}),
      ai_mode_access: hasAiModeAccess(wallet)
    };

    res.json(config);
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /config error');
    res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

module.exports = router;
