const CACHE_CLASS = {
  PUBLIC_DETERMINISTIC: 'public_deterministic',
  PUBLIC_VOLATILE: 'public_volatile',
  PERSONALIZED: 'personalized',
  TRANSACTIONAL: 'transactional'
};

function getCachePolicy(path = '') {
  if (/^\/api(\/v1)?\/leaderboard\/top/.test(path)) return CACHE_CLASS.PUBLIC_VOLATILE;
  if (/^\/api(\/v1)?\/game\/config/.test(path)) return CACHE_CLASS.PUBLIC_DETERMINISTIC;
  if (/^\/api(\/v1)?\/account\/me\//.test(path)) return CACHE_CLASS.PERSONALIZED;
  if (/^\/api(\/v1)?\/(leaderboard\/save|game\/save-result|store\/buy|donations)/.test(path)) return CACHE_CLASS.TRANSACTIONAL;
  return CACHE_CLASS.PERSONALIZED;
}

module.exports = { CACHE_CLASS, getCachePolicy };
