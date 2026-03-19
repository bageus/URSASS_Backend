const DEFAULT_NETWORK = process.env.DONATIONS_NETWORK || 'BSC';
const DEFAULT_TOKEN_SYMBOL = process.env.DONATIONS_TOKEN_SYMBOL || 'USDT';
const DEFAULT_TOKEN_DECIMALS = Number(process.env.DONATIONS_TOKEN_DECIMALS || 18);
const DEFAULT_TOKEN_CONTRACT = (process.env.DONATIONS_TOKEN_CONTRACT || '0x55d398326f99059ff775485246999027b3197955').toLowerCase();
const DEFAULT_MERCHANT_WALLET = (process.env.DONATIONS_MERCHANT_WALLET || '0x244bcc2721f1037958862825c3feb6a7be6204a7').toLowerCase();
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
    price: price('0.02', '2'),
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
    price: price('0.09', '9'),
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
    price: price('0.17', '17'),
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
    price: price('0.40', '40'),
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
    price: price('0.05', '5'),
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
    price: price('0.03', '3'),
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
