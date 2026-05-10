const { AnalyticsEvent } = require('../models/AnalyticsEvent');

async function trackOnboardingEvent(eventType, payload = {}) {
  try {
    const now = Date.now();
    await AnalyticsEvent.create({
      eventType,
      timestamp: now,
      sentAt: now,
      payload
    });
  } catch (_) {
    // non-blocking analytics
  }
}

module.exports = { trackOnboardingEvent };
