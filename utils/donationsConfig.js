const DEFAULT_NETWORK = process.env.DONATIONS_NETWORK || 'Base';
const DEFAULT_TOKEN_SYMBOL = process.env.DONATIONS_TOKEN_SYMBOL || 'USDT';
const DEFAULT_TOKEN_DECIMALS = Number(process.env.DONATIONS_TOKEN_DECIMALS || 18);
const DEFAULT_TOKEN_CONTRACT = (process.env.DONATIONS_TOKEN_CONTRACT || '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2').toLowerCase();
const DEFAULT_MERCHANT_WALLET = (process.env.DONATIONS_MERCHANT_WALLET || '0xbae8504df4e9816934e13390b4e83d408b7db5d8').toLowerCase();
const PRICE_MODE = String(process.env.DONATIONS_PRICE_MODE || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';
const TTL_MINUTES = Number(process.env.DONATIONS_TTL_MINUTES || 30);
const REQUIRED_CONFIRMATIONS = Number(process.env.DONATIONS_REQUIRED_CONFIRMATIONS || 1);

function price(testPrice, prodPrice) {
  return PRICE_MODE === 'prod' ? prodPrice : testPrice;
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
    starsAmount: Number(process.env.DONATION_STARTER_PACK_STARS || 100),
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
    starsAmount: Number(process.env.DONATION_BASIC_PACK_STARS || 450),
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
    starsAmount: Number(process.env.DONATION_ADVANCED_PACK_STARS || 850),
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
    starsAmount: Number(process.env.DONATION_SUPER_PACK_STARS || 2000),
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
    starsAmount: Number(process.env.DONATION_GOLD_PACK_STARS || 250),
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
    starsAmount: Number(process.env.DONATION_SILVER_PACK_STARS || 150),
    purchaseLimit: 'unlimited',
    ttlMinutes: TTL_MINUTES,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    grant: { gold: 0, silver: 100 }
  }
};

function getDonationConfig(productKey) {
  return DONATIONS_CONFIG[String(productKey || '').trim()];
}

module.exports = {
  DONATIONS_CONFIG,
  DONATIONS_PRICE_MODE: PRICE_MODE,
  DONATIONS_REQUIRED_CONFIRMATIONS: REQUIRED_CONFIRMATIONS,
  getDonationConfig
};
