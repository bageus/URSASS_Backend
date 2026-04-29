const express = require('express');
const crypto = require('crypto');

const { AnalyticsEvent, ANALYTICS_EVENT_TYPES } = require('../models/AnalyticsEvent');
const { readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { markAnalyticsIngest } = require('../middleware/requestMetrics');

const router = express.Router();

const MAX_BATCH_SIZE = 100;
const SUPPORTED_SUMMARY_EVENTS = new Set([
  'app_opened',
  'run_started',
  'run_finished',
  'second_run_started',
  'wallet_connect_success',
  'donation_success'
]);

function safeDivide(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function parseRangeValue(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) {
    const ts = Number(raw);
    if (Number.isFinite(ts) && ts >= 0) {
      return ts;
    }
  }

  const parsed = Date.parse(String(raw));
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return null;
}

function resolveIdentity(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  };

  const directId = pick('userId', 'user_id', 'uid');
  if (directId) return `user:${directId}`;
  const anonymousId = pick('anonymousId', 'anonymous_id', 'anonId', 'distinctId', 'distinct_id');
  if (anonymousId) return `anon:${anonymousId}`;
  const sessionId = pick('sessionId', 'session_id');
  if (sessionId) return `session:${sessionId}`;
  const ipHash = pick('ipHash', 'ip_hash');
  if (ipHash) return `ip:${ipHash}`;
  const rawIp = pick('ip', 'clientIp', 'client_ip');
  if (rawIp) {
    const hashedIp = crypto.createHash('sha256').update(rawIp).digest('hex');
    return `ip:${hashedIp}`;
  }
  return null;
}

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

function buildEventsBatch(body, isSingleEventRoute = false) {
  const sentAt = parseNonNegativeNumber(body?.sentAt);
  if (sentAt === null) {
    const err = new Error('sentAt is required and must be a non-negative number');
    err.statusCode = 400;
    err.code = 'ANALYTICS_INVALID_SENT_AT';
    err.expose = true;
    throw err;
  }

  if (isSingleEventRoute) {
    const singleEvent = body?.event && typeof body.event === 'object' && !Array.isArray(body.event) ? body.event : body;
    return { sentAt, events: [singleEvent] };
  }

  return { sentAt, events: body?.events };
}

async function ingestEvents(req, res, next, isSingleEventRoute = false) {
  try {
    const { sentAt, events } = buildEventsBatch(req.body, isSingleEventRoute);

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
}

router.post('/events', readLimiter, async (req, res, next) => {
  await ingestEvents(req, res, next, false);
});

router.post('/event', readLimiter, async (req, res, next) => {
  await ingestEvents(req, res, next, true);
});

router.get('/summary', readLimiter, async (req, res, next) => {
  try {
    const from = parseRangeValue(req.query.from);
    const to = parseRangeValue(req.query.to);

    if (from === null || to === null || from > to) {
      const err = new Error('from and to query params are required and must define a valid range');
      err.statusCode = 400;
      err.code = 'ANALYTICS_INVALID_RANGE';
      err.expose = true;
      throw err;
    }

    const match = {
      timestamp: { $gte: from, $lte: to },
      eventType: { $in: Array.from(SUPPORTED_SUMMARY_EVENTS) }
    };

    if (typeof req.query.source === 'string' && req.query.source.trim()) {
      match['payload.source'] = req.query.source.trim();
    }
    if (typeof req.query.env === 'string' && req.query.env.trim()) {
      match['payload.env'] = req.query.env.trim();
    }

    const events = await AnalyticsEvent.find(match).select({ eventType: 1, payload: 1 }).lean();

    const unique = {
      app_opened_users: new Set(),
      run_started_users: new Set(),
      run_finished_users: new Set(),
      second_run_started_users: new Set(),
      wallet_connect_success_users: new Set(),
      donation_success_users: new Set()
    };
    let total_runs_started = 0;
    let total_runs_finished = 0;
    let donation_success_count = 0;
    let donation_revenue_usd = 0;
    let totalScore = 0;
    let scoreCount = 0;
    let totalDurationSec = 0;
    let durationCount = 0;

    for (const event of events) {
      const identity = resolveIdentity(event);
      const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};

      if (event.eventType === 'app_opened') {
        if (identity) unique.app_opened_users.add(identity);
      }
      if (event.eventType === 'run_started') {
        total_runs_started += 1;
        if (identity) unique.run_started_users.add(identity);
      }
      if (event.eventType === 'run_finished') {
        total_runs_finished += 1;
        if (identity) unique.run_finished_users.add(identity);
        const score = Number(payload.score);
        if (Number.isFinite(score)) {
          totalScore += score;
          scoreCount += 1;
        }
        const duration = Number(payload.duration_sec ?? payload.durationSec);
        if (Number.isFinite(duration)) {
          totalDurationSec += duration;
          durationCount += 1;
        }
      }
      if (event.eventType === 'second_run_started') {
        if (identity) unique.second_run_started_users.add(identity);
      }
      if (event.eventType === 'wallet_connect_success') {
        if (identity) unique.wallet_connect_success_users.add(identity);
      }
      if (event.eventType === 'donation_success') {
        donation_success_count += 1;
        if (identity) unique.donation_success_users.add(identity);
        const amountUsd = Number(payload.amount_usd ?? payload.amountUsd);
        if (Number.isFinite(amountUsd)) {
          donation_revenue_usd += amountUsd;
        }
      }
    }

    const metrics = {
      app_opened_users: unique.app_opened_users.size,
      run_started_users: unique.run_started_users.size,
      run_finished_users: unique.run_finished_users.size,
      total_runs_started,
      total_runs_finished,
      second_run_started_users: unique.second_run_started_users.size,
      wallet_connect_success_users: unique.wallet_connect_success_users.size,
      donation_success_users: unique.donation_success_users.size,
      donation_success_count,
      donation_revenue_usd,
      average_score: safeDivide(totalScore, scoreCount),
      average_duration_sec: safeDivide(totalDurationSec, durationCount),
      activation_rate: safeDivide(unique.run_started_users.size, unique.app_opened_users.size),
      completion_rate: safeDivide(total_runs_finished, total_runs_started),
      second_run_rate: safeDivide(unique.second_run_started_users.size, unique.run_finished_users.size),
      wallet_conversion_rate: safeDivide(unique.wallet_connect_success_users.size, unique.app_opened_users.size),
      donation_conversion_rate: safeDivide(unique.donation_success_users.size, unique.wallet_connect_success_users.size)
    };

    res.json({ ok: true, range: { from, to }, metrics });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
