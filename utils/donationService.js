const crypto = require('crypto');
const { ethers } = require('ethers');

const Player = require('../models/Player');
const DonationPayment = require('../models/DonationPayment');
const { DONATIONS_CONFIG, DONATIONS_PRICE_MODE, getDonationConfig } = require('./donationsConfig');
const { normalizeWallet } = require('./security');
const { verifyDonationTransaction } = require('./donationVerifier');

let verifierImpl = verifyDonationTransaction;
const erc20TransferInterface = new ethers.utils.Interface([
  'function transfer(address to, uint256 value)'
]);

function setDonationVerifierForTests(verifier) {
  verifierImpl = verifier || verifyDonationTransaction;
}

function resetDonationVerifier() {
  verifierImpl = verifyDonationTransaction;
}

function getProvider() {
  const rpcUrl = process.env.BSC_RPC_URL || process.env.DONATIONS_RPC_URL;
  if (!rpcUrl) {
    return null;
  }

  return new ethers.providers.JsonRpcProvider(rpcUrl);
}

function buildProductView(config, alreadyPurchased) {
  return {
    key: config.key,
    title: config.title,
    price: config.price,
    currency: config.currency,
    network: config.network,
    grant: config.grant,
    purchaseLimit: config.purchaseLimit,
    alreadyPurchased,
    canPurchase: config.purchaseLimit === 'once' ? !alreadyPurchased : true
  };
}

function buildDonationTxRequest(payment) {
  const amountRaw = ethers.utils.parseUnits(
    String(payment.expectedAmount),
    payment.expectedDecimals
  ).toHexString();

  const transaction = {
    to: payment.tokenContract,
    value: '0x0',
    data: erc20TransferInterface.encodeFunctionData('transfer', [
      payment.merchantWallet,
      ethers.BigNumber.from(amountRaw)
    ])
  };

  return {
    ...transaction,
    chainLabel: payment.network,
    tokenSymbol: payment.tokenSymbol,
    tokenDecimals: payment.expectedDecimals,
    transferTo: payment.merchantWallet,
    transferAmount: payment.expectedAmount,
    transferAmountRaw: amountRaw,
    walletPayload: {
      method: 'eth_sendTransaction',
      params: [transaction]
    }
  };
}

async function hasSuccessfulDonation(wallet, productKey) {
  const existing = await DonationPayment.findOne({
    wallet,
    productKey,
    status: { $in: ['confirmed', 'credited'] }
  });

  return !!existing;
}

async function listDonationProducts(wallet) {
  const normalizedWallet = normalizeWallet(wallet);
  const products = [];

  for (const config of Object.values(DONATIONS_CONFIG)) {
    const alreadyPurchased = normalizedWallet && config.purchaseLimit === 'once'
      ? await hasSuccessfulDonation(normalizedWallet, config.key)
      : false;

    products.push(buildProductView(config, alreadyPurchased));
  }

  const sampleConfig = Object.values(DONATIONS_CONFIG)[0];

  return {
    wallet: normalizedWallet,
    network: sampleConfig?.network || 'BSC',
    token: sampleConfig ? {
      symbol: sampleConfig.currency,
      contract: sampleConfig.tokenContract,
      merchantWallet: sampleConfig.merchantWallet
    } : null,
    priceMode: DONATIONS_PRICE_MODE,
    products
  };
}

async function createDonationPayment(wallet, productKey) {
  const normalizedWallet = normalizeWallet(wallet);
  const config = getDonationConfig(productKey);

  if (!normalizedWallet) {
    const err = new Error('Invalid wallet address');
    err.statusCode = 400;
    throw err;
  }

  if (!config) {
    const err = new Error(`Unknown donation product: ${productKey}`);
    err.statusCode = 400;
    throw err;
  }

  const player = await Player.findOne({ wallet: normalizedWallet });
  if (!player) {
    const err = new Error('Player not found. Play at least one game first.');
    err.statusCode = 404;
    throw err;
  }

  if (config.purchaseLimit === 'once') {
    const alreadyPurchased = await hasSuccessfulDonation(normalizedWallet, config.key);
    if (alreadyPurchased) {
      const err = new Error('This donation product is already purchased');
      err.statusCode = 409;
      throw err;
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (config.ttlMinutes * 60 * 1000));
  const payment = new DonationPayment({
    paymentId: `pay_${crypto.randomBytes(12).toString('hex')}`,
    wallet: normalizedWallet,
    productKey: config.key,
    productSnapshot: {
      key: config.key,
      title: config.title,
      price: config.price,
      currency: config.currency,
      grant: config.grant,
      purchaseLimit: config.purchaseLimit,
      requiredConfirmations: config.requiredConfirmations
    },
    status: 'created',
    network: config.network,
    tokenSymbol: config.currency,
    tokenContract: config.tokenContract,
    merchantWallet: config.merchantWallet,
    expectedAmount: config.price,
    expectedDecimals: config.tokenDecimals,
    expiresAt
  });

  await payment.save();

  return payment;
}

async function creditDonationPayment(payment) {
  if (payment.status === 'credited') {
    return payment;
  }

  const player = await Player.findOne({ wallet: payment.wallet });
  if (!player) {
    payment.status = 'failed';
    payment.failureReason = 'player_not_found';
    await payment.save();
    return payment;
  }

  const { gold = 0, silver = 0 } = payment.productSnapshot?.grant || {};
  player.totalGoldCoins += gold;
  player.totalSilverCoins += silver;
  player.updatedAt = new Date();

  await player.save();

  payment.status = 'credited';
  payment.creditedAt = new Date();
  if (!payment.confirmedAt) {
    payment.confirmedAt = new Date();
  }
  await payment.save();

  return payment;
}

async function recheckDonationPayment(payment) {
  if (!payment) {
    return null;
  }

  if (payment.status === 'credited' || payment.status === 'failed' || payment.status === 'expired') {
    return payment;
  }

  if (!payment.txHash) {
    return payment;
  }

  if (payment.expiresAt <= new Date()) {
    payment.status = 'expired';
    payment.failureReason = 'payment_expired';
    await payment.save();
    return payment;
  }

  const verification = await verifierImpl({
    txHash: payment.txHash,
    expectedAmount: payment.expectedAmount,
    expectedDecimals: payment.expectedDecimals,
    tokenContract: payment.tokenContract,
    merchantWallet: payment.merchantWallet,
    requiredConfirmations: payment.productSnapshot?.requiredConfirmations || 1
  }, getProvider());

  payment.confirmations = verification.confirmations || 0;
  payment.txFrom = verification.actualFrom || payment.txFrom;
  payment.txTo = verification.actualTo || payment.txTo;
  payment.txAmount = verification.actualAmount || payment.txAmount;

  if (verification.status === 'pending') {
    payment.status = 'pending';
    payment.failureReason = verification.reason || null;
    await payment.save();
    return payment;
  }

  if (verification.status === 'failed') {
    payment.status = 'failed';
    payment.failureReason = verification.reason || 'verification_failed';
    await payment.save();
    return payment;
  }

  payment.status = 'confirmed';
  payment.failureReason = null;
  payment.confirmedAt = payment.confirmedAt || new Date();
  await payment.save();

  return creditDonationPayment(payment);
}

async function submitDonationTransaction({ wallet, paymentId, txHash }) {
  const normalizedWallet = normalizeWallet(wallet);
  const normalizedHash = typeof txHash === 'string' ? txHash.trim() : '';

  if (!normalizedWallet || !paymentId || !normalizedHash) {
    const err = new Error('Missing wallet, paymentId or txHash');
    err.statusCode = 400;
    throw err;
  }

  const payment = await DonationPayment.findOne({ paymentId });
  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  if (payment.wallet !== normalizedWallet) {
    const err = new Error('Payment does not belong to this wallet');
    err.statusCode = 403;
    throw err;
  }

  if (payment.expiresAt <= new Date()) {
    payment.status = 'expired';
    payment.failureReason = 'payment_expired';
    await payment.save();
    return payment;
  }

  const existingHash = await DonationPayment.findOne({ txHash: normalizedHash, paymentId: { $ne: paymentId } });
  if (existingHash) {
    const err = new Error('Transaction hash already used');
    err.statusCode = 409;
    throw err;
  }

  payment.txHash = normalizedHash;
  payment.submittedAt = new Date();
  payment.status = 'submitted';
  payment.failureReason = null;
  await payment.save();

  return recheckDonationPayment(payment);
}

async function getDonationPayment(paymentId, options = {}) {
  const payment = await DonationPayment.findOne({ paymentId });
  if (!payment) {
    return null;
  }

  const normalizedWallet = options.wallet ? normalizeWallet(options.wallet) : null;
  const normalizedHash = typeof options.txHash === 'string' ? options.txHash.trim() : '';

  if (normalizedWallet && payment.wallet !== normalizedWallet) {
    const err = new Error('Payment does not belong to this wallet');
    err.statusCode = 403;
    throw err;
  }

  if (normalizedHash && !payment.txHash && payment.status === 'created') {
    const existingHash = await DonationPayment.findOne({ txHash: normalizedHash, paymentId: { $ne: paymentId } });
    if (existingHash) {
      const err = new Error('Transaction hash already used');
      err.statusCode = 409;
      throw err;
    }

    payment.txHash = normalizedHash;
    payment.submittedAt = payment.submittedAt || new Date();
    payment.status = 'submitted';
    payment.failureReason = null;
    await payment.save();
  }

  if (payment.status === 'submitted' || payment.status === 'pending') {
    return recheckDonationPayment(payment);
  }

  if (payment.status === 'created' && payment.expiresAt <= new Date()) {
    payment.status = 'expired';
    payment.failureReason = 'payment_expired';
    await payment.save();
  }

  return payment;
}

function serializeDonationPayment(payment) {
  if (!payment) {
    return null;
  }

  return {
    paymentId: payment.paymentId,
    wallet: payment.wallet,
    status: payment.status,
    productKey: payment.productKey,
    title: payment.productSnapshot?.title || null,
    amount: payment.expectedAmount,
    currency: payment.tokenSymbol,
    network: payment.network,
    tokenContract: payment.tokenContract,
    merchantWallet: payment.merchantWallet,
    expiresAt: payment.expiresAt,
    txHash: payment.txHash,
    confirmations: payment.confirmations,
    reward: payment.productSnapshot?.grant || { gold: 0, silver: 0 },
    failureReason: payment.failureReason,
    txRequest: buildDonationTxRequest(payment)
  };
}

module.exports = {
  listDonationProducts,
  createDonationPayment,
  submitDonationTransaction,
  getDonationPayment,
  serializeDonationPayment,
  setDonationVerifierForTests,
  resetDonationVerifier
};
