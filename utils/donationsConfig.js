const DEFAULT_NETWORK = process.env.DONATIONS_NETWORK || 'Base';
const DEFAULT_TOKEN_SYMBOL = process.env.DONATIONS_TOKEN_SYMBOL || 'USDT';
function resolvePositiveInt(rawValue, fallbackValue, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallbackValue;
  const normalized = Math.floor(parsed);
  if (normalized < min || normalized > max) return fallbackValue;
  return normalized;
}

const DEFAULT_TOKEN_DECIMALS = resolvePositiveInt(process.env.DONATIONS_TOKEN_DECIMALS ?? 6, 6, { min: 0, max: 36 });
const DEFAULT_TOKEN_CONTRACT = (process.env.DONATIONS_TOKEN_CONTRACT || '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2').toLowerCase();
const DEFAULT_MERCHANT_WALLET = (process.env.DONATIONS_MERCHANT_WALLET || '0xbae8504df4e9816934e13390b4e83d408b7db5d8').toLowerCase();
const PRICE_MODE = String(process.env.DONATIONS_PRICE_MODE || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';
const TTL_MINUTES = resolvePositiveInt(process.env.DONATIONS_TTL_MINUTES ?? 30, 30, { min: 1, max: 24 * 60 });
const REQUIRED_CONFIRMATIONS = resolvePositiveInt(process.env.DONATIONS_REQUIRED_CONFIRMATIONS ?? 1, 1, { min: 1, max: 1024 });


function resolveStarsAmount(envName, fallbackValue) {
  const raw = process.env[envName];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallbackValue;
  }

  const normalized = String(raw).trim().replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return Math.round(parsed);
}

function price(testPrice, prodPrice) {
  return PRICE_MODE === 'prod' ? prodPrice : testPrice;
}


function normalizeProductKey(productKey) {
  return String(productKey || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');
}

const DONATIONS_CONFIG = {
  starter_pack: {
    key: 'starter_pack',
    title: 'Starter Pack',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('2', '200'),
    starsAmount: resolveStarsAmount('DONATION_STARTER_PACK_STARS', 100),
    purchaseLimit: 'once',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 400, silver: 400 }
  },
  basic_pack: {
    key: 'basic_pack',
    title: 'Basic Pack',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('9', '900'),
    starsAmount: resolveStarsAmount('DONATION_BASIC_PACK_STARS', 450),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 200, silver: 200 }
  },
  advanced_pack: {
    key: 'advanced_pack',
    title: 'Advanced Pack',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('17', '1700'),
    starsAmount: resolveStarsAmount('DONATION_ADVANCED_PACK_STARS', 850),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 400, silver: 400 }
  },
  super_pack: {
    key: 'super_pack',
    title: 'Super Pack',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('40', '4000'),
    starsAmount: resolveStarsAmount('DONATION_SUPER_PACK_STARS', 2000),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 1000, silver: 1000 }
  },
  gold_pack: {
    key: 'gold_pack',
    title: 'Gold',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('5', '500'),
    starsAmount: resolveStarsAmount('DONATION_GOLD_PACK_STARS', 250),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 100, silver: 0 }
  },
  silver_pack: {
    key: 'silver_pack',
    title: 'Silver',
    currency: DEFAULT_TOKEN_SYMBOL,
    network: DEFAULT_NETWORK,
    tokenContract: DEFAULT_TOKEN_CONTRACT,
    tokenDecimals: DEFAULT_TOKEN_DECIMALS,
    merchantWallet: DEFAULT_MERCHANT_WALLET,
    price: price('3', '300'),
    starsAmount: resolveStarsAmount('DONATION_SILVER_PACK_STARS', 150),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 0, silver: 100 }
  }
};

function getDonationConfig(productKey) {
  const normalizedKey = normalizeProductKey(productKey);
  if (!normalizedKey) {
    return null;
  }

  if (DONATIONS_CONFIG[normalizedKey]) {
    return DONATIONS_CONFIG[normalizedKey];
  }

  const aliasMap = {
    starter: 'starter_pack',
    starterpack: 'starter_pack',
    basic: 'basic_pack',
    basicpack: 'basic_pack',
    advanced: 'advanced_pack',
    advancedpack: 'advanced_pack',
    super: 'super_pack',
    superpack: 'super_pack',
    gold: 'gold_pack',
    goldpack: 'gold_pack',
    silver: 'silver_pack',
    silverpack: 'silver_pack'
  };

  const mappedKey = aliasMap[normalizedKey];
  return mappedKey ? DONATIONS_CONFIG[mappedKey] : null;
}

module.exports = {
  DONATIONS_CONFIG,
  DONATIONS_PRICE_MODE: PRICE_MODE,
  DONATIONS_REQUIRED_CONFIRMATIONS: REQUIRED_CONFIRMATIONS,
  getDonationConfig
};
