#!/usr/bin/env node

const telemetry = Number(process.env.SIGNAL_ALIAS_TELEMETRY_COUNT || 0);
const analytics = Number(process.env.SIGNAL_ALIAS_ANALYTICS_COUNT || 0);
const threshold = Number(process.env.GATE_ALIAS_TELEMETRY_MAX || 0);

if (!Number.isFinite(telemetry) || !Number.isFinite(analytics) || !Number.isFinite(threshold)) {
  console.error('Alias usage gate: invalid numeric inputs');
  process.exit(1);
}

if (telemetry > threshold) {
  console.error(`Alias usage gate failed: telemetry_count=${telemetry} > ${threshold}`);
  process.exit(1);
}

console.log(`Alias usage gate passed: telemetry_count=${telemetry}, analytics_count=${analytics}, threshold=${threshold}`);
