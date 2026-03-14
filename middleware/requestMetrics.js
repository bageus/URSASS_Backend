const state = {
  requestCount: 0,
  byRoute: {},
  suspiciousEvents: {},
  durationBuckets: {
    le_50: 0,
    le_100: 0,
    le_250: 0,
    le_500: 0,
    le_1000: 0,
    gt_1000: 0
  },
  startTs: Date.now()
};

function normalizePath(path = '') {
  return String(path)
    .replace(/0x[a-fA-F0-9]{40}/g, ':wallet')
    .replace(/[a-fA-F0-9]{24}/g, ':id')
    .replace(/\b\d+\b/g, ':num');
}

function getRouteLabel(req) {
  if (req.baseUrl && req.route?.path) {
    return `${req.baseUrl}${req.route.path}`;
  }

  if (req.route?.path) {
    return req.route.path;
  }

  return normalizePath(req.path || 'unknown');
}

function bucketizeDuration(ms) {
  if (ms <= 50) return 'le_50';
  if (ms <= 100) return 'le_100';
  if (ms <= 250) return 'le_250';
  if (ms <= 500) return 'le_500';
  if (ms <= 1000) return 'le_1000';
  return 'gt_1000';
}

function metricsMiddleware(req, res, next) {
  const started = Date.now();

  res.on('finish', () => {
    state.requestCount += 1;

    const route = getRouteLabel(req);
    const key = `${req.method}:${route}:${res.statusCode}`;

    if (!state.byRoute[key]) {
      state.byRoute[key] = { count: 0, totalMs: 0, maxMs: 0 };
    }

    const tookMs = Date.now() - started;
    state.byRoute[key].count += 1;
    state.byRoute[key].totalMs += tookMs;
    state.byRoute[key].maxMs = Math.max(state.byRoute[key].maxMs, tookMs);

    const durationBucket = bucketizeDuration(tookMs);
    state.durationBuckets[durationBucket] += 1;
  });

  next();
}

function markSuspicious(type = 'generic') {
  state.suspiciousEvents[type] = (state.suspiciousEvents[type] || 0) + 1;
}

async function renderMetricsText() {
  const lines = [];
  lines.push('# TYPE app_requests_total counter');
  lines.push(`app_requests_total ${state.requestCount}`);

  lines.push('# TYPE app_uptime_seconds gauge');
  lines.push(`app_uptime_seconds ${Math.floor((Date.now() - state.startTs) / 1000)}`);

  lines.push('# TYPE app_route_latency_ms_summary gauge');
  for (const [key, value] of Object.entries(state.byRoute)) {
    const avg = value.count > 0 ? (value.totalMs / value.count).toFixed(2) : '0';
    const safeKey = key.replace(/"/g, '\\"');
    lines.push(`app_route_latency_ms_summary{route="${safeKey}",type="avg"} ${avg}`);
    lines.push(`app_route_latency_ms_summary{route="${safeKey}",type="max"} ${value.maxMs}`);
  }

  lines.push('# TYPE app_request_duration_buckets_total counter');
  for (const [bucket, count] of Object.entries(state.durationBuckets)) {
    lines.push(`app_request_duration_buckets_total{bucket="${bucket}"} ${count}`);
  }

  lines.push('# TYPE app_suspicious_events_total counter');
  for (const [type, count] of Object.entries(state.suspiciousEvents)) {
    const safeType = type.replace(/"/g, '\\"');
    lines.push(`app_suspicious_events_total{type="${safeType}"} ${count}`);
  }

  return lines.join('\n') + '\n';
}

module.exports = {
  metricsMiddleware,
  markSuspicious,
  renderMetricsText
};
