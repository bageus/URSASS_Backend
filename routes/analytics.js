const express = require('express');

const { AnalyticsEvent, ANALYTICS_EVENT_TYPES } = require('../models/AnalyticsEvent');
const { readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { markAnalyticsIngest } = require('../middleware/requestMetrics');

const router = express.Router();

const MAX_BATCH_SIZE = 100;

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || typeof value === 'function') {
      continue;
    }
    normalized[key] = value;
  }

  return normalized;
}

function parseNonNegativeNumber(value) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }
  return normalized;
}

function validateAndNormalizeEvent(inputEvent) {
  if (!inputEvent || typeof inputEvent !== 'object' || Array.isArray(inputEvent)) {
    return { error: 'Each event must be an object' };
  }

  const eventType = String(inputEvent.name || '').trim();
  if (!ANALYTICS_EVENT_TYPES.includes(eventType)) {
    return { error: `Unsupported analytics event type: ${eventType || 'empty'}` };
  }

  const timestamp = parseNonNegativeNumber(inputEvent.timestamp);
  if (timestamp === null) {
    return { error: `Invalid event timestamp for ${eventType}` };
  }

  const payload = normalizePayload(inputEvent.payload);

  return {
    eventType,
    timestamp,
    payload
  };
}

router.post('/events', readLimiter, async (req, res, next) => {
  try {
    const sentAt = parseNonNegativeNumber(req.body?.sentAt);
    const events = req.body?.events;

    if (sentAt === null) {
      const err = new Error('sentAt is required and must be a non-negative number');
      err.statusCode = 400;
      err.code = 'ANALYTICS_INVALID_SENT_AT';
      err.expose = true;
      throw err;
    }

    if (!Array.isArray(events) || events.length === 0) {
      const err = new Error('events must be a non-empty array');
      err.statusCode = 400;
      err.code = 'ANALYTICS_INVALID_EVENTS_BATCH';
      err.expose = true;
      throw err;
    }

    if (events.length > MAX_BATCH_SIZE) {
      const err = new Error(`events batch is too large (max ${MAX_BATCH_SIZE})`);
      err.statusCode = 413;
      err.code = 'ANALYTICS_BATCH_TOO_LARGE';
      err.expose = true;
      throw err;
    }

    const normalizedEvents = [];
    for (let index = 0; index < events.length; index += 1) {
      const normalized = validateAndNormalizeEvent(events[index]);
      if (normalized.error) {
        markAnalyticsIngest({ invalid: 1 });
        const err = new Error(`Invalid event at index ${index}: ${normalized.error}`);
        err.statusCode = 400;
        err.code = 'ANALYTICS_INVALID_EVENT';
        err.expose = true;
        throw err;
      }

      normalizedEvents.push({
        ...normalized,
        sentAt
      });
    }

    markAnalyticsIngest({ accepted: normalizedEvents.length });

    await AnalyticsEvent.insertMany(normalizedEvents, { ordered: false });
    markAnalyticsIngest({ stored: normalizedEvents.length });

    res.status(202).json({
      ok: true,
      accepted: normalizedEvents.length,
      dropped: 0
    });
  } catch (error) {
    if (error.code !== 'ANALYTICS_INVALID_EVENT' && error.code !== 'ANALYTICS_INVALID_SENT_AT' && error.code !== 'ANALYTICS_INVALID_EVENTS_BATCH' && error.code !== 'ANALYTICS_BATCH_TOO_LARGE') {
      markAnalyticsIngest({ failed: 1 });
      logger.error({ err: error.message, route: '/api/analytics/events' }, 'Failed to persist analytics events');
    }

    next(error);
  }
});

module.exports = router;
