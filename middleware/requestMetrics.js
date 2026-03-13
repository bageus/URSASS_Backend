const state = {
  requestCount: 0,
  byRoute: {},
  suspiciousEvents: {},
  startTs: Date.now()
};

function metricsMiddleware(req, res, next) {
  const started = Date.now();

  res.on('finish', () => {
    state.requestCount += 1;
    const route = req.route?.path || req.path || 'unknown';
    const key = `${req.method}:${route}:${res.statusCode}`;

    if (!state.byRoute[key]) {
      state.byRoute[key] = { count: 0, totalMs: 0, maxMs: 0 };
    }

    const tookMs = Date.now() - started;
    state.byRoute[key].count += 1;
    state.byRoute[key].totalMs += tookMs;
    state.byRoute[key].maxMs = Math.max(state.byRoute[key].maxMs, tookMs);
  });

  next();
}

function markSuspicious(type = 'generic') {
  state.suspiciousEvents[type] = (state.suspiciousEvents[type] || 0) + 1;
}

function renderMetricsText() {
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
