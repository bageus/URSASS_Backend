/**
 * Returns the UTC day key for a given date in YYYY-MM-DD format.
 */
function getUtcDayKey(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns yesterday's UTC day key in YYYY-MM-DD format.
 */
function getYesterdayUtcDayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return getUtcDayKey(d);
}

module.exports = { getUtcDayKey, getYesterdayUtcDayKey };
