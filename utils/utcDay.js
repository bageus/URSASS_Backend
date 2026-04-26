/**
 * Get UTC day key in YYYY-MM-DD format.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function getUtcDayKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's UTC day key in YYYY-MM-DD format.
 * @returns {string}
 */
function getYesterdayUtcDayKey() {
  return getUtcDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

module.exports = { getUtcDayKey, getYesterdayUtcDayKey };
