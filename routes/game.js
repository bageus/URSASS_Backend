const express = require('express');
const router = express.Router();
const { readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { getGameModeConfig } = require('../utils/gameModeConfig');

router.get('/config', readLimiter, async (req, res) => {
  try {
    const requestedMode = req.query.mode || 'unauth';
    const config = getGameModeConfig(requestedMode);

    if (!config) {
      return res.status(404).json({
        error: `Unknown game mode config: ${requestedMode}`
      });
    }

    res.json(config);
  } catch (error) {
    logger.error({ err: error }, 'GET /config error');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
