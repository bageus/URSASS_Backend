const crypto = require('crypto');
const { ethers } = require('ethers');

const Player = require('../models/Player');
const DonationPayment = require('../models/DonationPayment');
const { DONATIONS_CONFIG, DONATIONS_PRICE_MODE, getDonationConfig } = require('./donationsConfig');
const { normalizeWallet } = require('./security');
const { verifyDonationTransaction } = require('./donationVerifier');
const logger = require('./logger');

let verifierImpl = verifyDonationTransaction;
const erc20TransferInterface = new ethers.utils.Interface([
  'function transfer(address to, uint256 value)'
]);
const SUBMIT_TIMEOUT_MS = 30 * 60 * 1000;
const INTERNAL_STATUS_AWAITING_TX = 'awaiting_tx';
const RESPONSELESS_STATUSES = new Set([INTERNAL_STATUS_AWAITING_TX]);
const FINAL_STATUSES = new Set(['credited', 'failed', 'expired']);
const DEFAULT_BSC_PUBLIC_RPC_URL = 'https://bsc-dataseed.binance.org/';
const DONATION_RECHECK_INTERVAL_MS = Math.max(15 * 1000, Number(process.env.DONATIONS_RECHECK_INTERVAL_MS || 60 * 1000));
const DONATION_RECHECK_BATCH_SIZE = Math.max(1, Number(process.env.DONATIONS_RECHECK_BATCH_SIZE || 25));
let donationRecheckTimer = null;

function setDonationVerifierForTests(verifier) {
  verifierImpl = verifier || verifyDonationTransaction;
}

function resetDonationVerifier() {
  verifierImpl = verifyDonationTransaction;
}

function getProvider() {
  const configuredRpcUrl = process.env.BSC_RPC_URL || process.env.DONATIONS_RPC_URL;
  const rpcUrl = configuredRpcUrl || DEFAULT_BSC_PUBLIC_RPC_URL;

  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    return {
      provider,
      status: configuredRpcUrl ? 'configured' : 'fallback_public_rpc',
      rpcUrl,
      configuredRpcUrl: configuredRpcUrl || null
    };
  } catch (error) {
    logger.error({ err: error, rpcUrl }, 'Failed to initialize donation RPC provider');
    return {
      provider: null,
      status: configuredRpcUrl ? 'configured_error' : 'fallback_public_rpc_error',
      rpcUrl,
      configuredRpcUrl: configuredRpcUrl || null,
      errorMessage: error.message
    };
  }
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

function getVerificationDeadline(payment) {
  if (!payment?.submittedAt) {
    return null;
  }

  return new Date(new Date(payment.submittedAt).getTime() + SUBMIT_TIMEOUT_MS);
}

function hasVerificationTimedOut(payment, now = new Date()) {
  const deadline = getVerificationDeadline(payment);
  return !!deadline && deadline <= now;
}

function getPublicStatus(status) {
  return RESPONSELESS_STATUSES.has(status) ? null : status;
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

async function listDonationPayments(wallet, options = {}) {
  const normalizedWallet = normalizeWallet(wallet);

  if (!normalizedWallet) {
    const err = new Error('Invalid wallet address');
    err.statusCode = 400;
    throw err;
  }

  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const payments = await DonationPayment.find({ wallet: normalizedWallet })
    .sort({ createdAt: -1 })
    .limit(limit);

  const refreshedPayments = [];
  for (const payment of payments) {
    refreshedPayments.push(await getDonationPayment(payment.paymentId, { wallet: normalizedWallet }));
  }

  return {
    wallet: normalizedWallet,
    payments: refreshedPayments.map((payment) => serializeDonationPayment(payment, { includeTxRequest: false }))
  };
}

async function createDonationPayment(wallet, productKey) {
  const normalizedWallet = normalizeWallet(wallet);
  const config = getDonationConfig(productKey);

  if (!normalizedWallet || !config) {
    const err = new Error(!normalizedWallet ? 'Invalid wallet address' : 'Unknown donation product');
    err.statusCode = 400;
    throw err;
  }

  if (config.purchaseLimit === 'once' && await hasSuccessfulDonation(normalizedWallet, config.key)) {
    const err = new Error(`${config.title} already purchased`);
    err.statusCode = 409;
    throw err;
  }

  const payment = new DonationPayment({
    paymentId: crypto.randomUUID(),
    wallet: normalizedWallet,
    productKey: config.key,
    productSnapshot: {
      key: config.key,
      title: config.title,
      grant: config.grant,
      price: config.price,
      currency: config.currency,
      network: config.network,
      requiredConfirmations: config.requiredConfirmations,
      purchaseLimit: config.purchaseLimit
    },
    status: INTERNAL_STATUS_AWAITING_TX,
    network: config.network,
    tokenSymbol: config.currency,
    tokenContract: config.tokenContract,
    merchantWallet: config.merchantWallet,
    expectedAmount: config.price,
    expectedDecimals: config.tokenDecimals,
    expiresAt: null
  });

  await payment.save();
  return payment;
}

async function creditDonationPayment(payment) {
  if (!payment) {
    return null;
  }

  if (payment.status === 'credited' || payment.rewardGrantedAt) {
    return payment;
  }

  const player = await Player.findOne({ wallet: payment.wallet });
  if (!player) {
    payment.status = 'failed';
    payment.failureReason = 'player_not_found';
    await payment.save();
    return payment;
  }

  const rewardGrantedAt = new Date();
  const rewardUpdate = await DonationPayment.findOneAndUpdate(
    {
      paymentId: payment.paymentId,
      rewardGrantedAt: null,
      status: { $in: ['confirmed', 'credited'] }
    },
    {
      $set: {
        status: 'credited',
        rewardGrantedAt,
        creditedAt: rewardGrantedAt,
        confirmedAt: payment.confirmedAt || rewardGrantedAt,
        failureReason: null
      }
    },
    { new: true }
  );

  if (!rewardUpdate) {
    return DonationPayment.findOne({ paymentId: payment.paymentId });
  }

  const { gold = 0, silver = 0 } = payment.productSnapshot?.grant || {};
  player.totalGoldCoins += gold;
  player.totalSilverCoins += silver;
  player.updatedAt = rewardGrantedAt;
  await player.save();

  payment.status = rewardUpdate.status;
  payment.rewardGrantedAt = rewardUpdate.rewardGrantedAt;
  payment.creditedAt = rewardUpdate.creditedAt;
  payment.confirmedAt = rewardUpdate.confirmedAt;
  payment.failureReason = rewardUpdate.failureReason;

  return rewardUpdate;
}

async function finalizeExpiredPayment(payment) {
  if (!payment || FINAL_STATUSES.has(payment.status) || !hasVerificationTimedOut(payment)) {
    return payment;
  }

  payment.status = 'failed';
  payment.failureReason = payment.failureReason || 'merchant_confirmation_timeout';
  payment.expiresAt = getVerificationDeadline(payment);
  await payment.save();
  return payment;
}

async function recheckDonationPayment(payment) {
  if (!payment) {
    return null;
  }

  if (FINAL_STATUSES.has(payment.status)) {
    return payment;
  }

  if (!payment.txHash) {
    return payment;
  }

  if (hasVerificationTimedOut(payment)) {
    return finalizeExpiredPayment(payment);
  }

  const providerState = getProvider();
  const verificationStartedAt = new Date();
  const verification = await verifierImpl({
    txHash: payment.txHash,
    expectedAmount: payment.expectedAmount,
    expectedDecimals: payment.expectedDecimals,
    tokenContract: payment.tokenContract,
    merchantWallet: payment.merchantWallet,
    requiredConfirmations: payment.productSnapshot?.requiredConfirmations || 1
  }, providerState?.provider || null);

  payment.confirmations = verification.confirmations || 0;
  payment.txFrom = verification.actualFrom || payment.txFrom;
  payment.txTo = verification.actualTo || payment.txTo;
  payment.txAmount = verification.actualAmount || payment.txAmount;
  payment.providerStatus = verification.providerStatus || providerState?.status || 'unknown';
  payment.verificationReason = verification.reason || null;
  payment.lastVerificationAt = verificationStartedAt;

  logger.info({
    paymentId: payment.paymentId,
    wallet: payment.wallet,
    txHash: payment.txHash,
    tokenContract: payment.tokenContract,
    merchantWallet: payment.merchantWallet,
    expectedAmount: payment.expectedAmount,
    expectedDecimals: payment.expectedDecimals,
    verificationStatus: verification.status,
    verificationReason: verification.reason,
    actualFrom: verification.actualFrom || null,
    actualTo: verification.actualTo || null,
    actualAmount: verification.actualAmount || null,
    confirmations: verification.confirmations || 0,
    providerAvailability: Boolean(providerState?.provider),
    providerStatus: verification.providerStatus || providerState?.status || 'unknown',
    providerRpcUrl: providerState?.rpcUrl || null,
    providerConfiguredRpcUrl: providerState?.configuredRpcUrl || null,
    providerErrorMessage: verification.errorMessage || providerState?.errorMessage || null
  }, 'Donation payment verification result');

  if (verification.status === 'failed') {
    payment.status = 'failed';
    payment.failureReason = verification.reason || 'verification_failed';
    payment.expiresAt = getVerificationDeadline(payment);
    await payment.save();
    return payment;
  }

  if (verification.status === 'pending') {
    payment.status = 'submitted';
    payment.failureReason = null;
    payment.expiresAt = getVerificationDeadline(payment);
    await payment.save();
    return payment;
  }

  payment.status = 'confirmed';
  payment.failureReason = null;
  payment.confirmedAt = payment.confirmedAt || new Date();
  payment.expiresAt = getVerificationDeadline(payment);
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

  if (FINAL_STATUSES.has(payment.status)) {
    if (payment.txHash && payment.txHash !== normalizedHash) {
      const err = new Error('Payment already finalized with another transaction hash');
      err.statusCode = 409;
      throw err;
    }
    return payment;
  }

  const existingHash = await DonationPayment.findOne({ txHash: normalizedHash, paymentId: { $ne: paymentId } });
  if (existingHash) {
    const err = new Error('Transaction hash already used');
    err.statusCode = 409;
    throw err;
  }

  if (payment.txHash && payment.txHash !== normalizedHash) {
    const err = new Error('Payment already linked to a different transaction hash');
    err.statusCode = 409;
    throw err;
  }

  if (!payment.txHash) {
    payment.txHash = normalizedHash;
  }
  payment.submittedAt = payment.submittedAt || new Date();
  payment.status = 'submitted';
  payment.failureReason = null;
  payment.expiresAt = getVerificationDeadline(payment);
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

  if (normalizedHash && !payment.txHash) {
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
    payment.expiresAt = getVerificationDeadline(payment);
    await payment.save();
  }

  if (payment.txHash && !FINAL_STATUSES.has(payment.status)) {
    return recheckDonationPayment(payment);
  }

  return finalizeExpiredPayment(payment);
}

function serializeDonationPayment(payment, options = {}) {
  if (!payment) {
    return null;
  }
  const includeTxRequest = options.includeTxRequest !== false;

  return {
    paymentId: payment.paymentId,
    wallet: payment.wallet,
    status: getPublicStatus(payment.status),
    productKey: payment.productKey,
    productTitle: payment.productSnapshot?.title || null,
    title: payment.productSnapshot?.title || null,
    amount: payment.expectedAmount,
    currency: payment.tokenSymbol,
    network: payment.network,
    tokenContract: payment.tokenContract,
    merchantWallet: payment.merchantWallet,
    expiresAt: payment.expiresAt || getVerificationDeadline(payment),
    txHash: payment.txHash,
    confirmations: payment.confirmations,
    reward: payment.productSnapshot?.grant || { gold: 0, silver: 0 },
    failureReason: payment.failureReason,
    verificationReason: payment.verificationReason || payment.failureReason || null,
    lastVerificationAt: payment.lastVerificationAt || null,
    providerStatus: payment.providerStatus || null,
    txFrom: payment.txFrom || null,
    txTo: payment.txTo || null,
    txAmount: payment.txAmount || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    submittedAt: payment.submittedAt || null,
    confirmedAt: payment.confirmedAt || null,
    creditedAt: payment.creditedAt || null,
    txRequest: includeTxRequest ? buildDonationTxRequest(payment) : null
  };
}

async function processPendingDonationPayments(options = {}) {
  const limit = Math.max(1, Number(options.limit) || DONATION_RECHECK_BATCH_SIZE);
  const candidates = await DonationPayment.find({
    status: { $in: ['submitted', 'confirmed'] },
    txHash: { $ne: null }
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  let processed = 0;
  for (const payment of candidates) {
    if (!payment?.txHash || FINAL_STATUSES.has(payment.status)) {
      continue;
    }
    await recheckDonationPayment(payment);
    processed += 1;
  }

  if (processed > 0) {
    logger.info({ processed }, 'Processed pending donation payment recheck batch');
  }

  return { processed };
}

function startDonationPaymentRecheckLoop() {
  if (donationRecheckTimer) {
    return donationRecheckTimer;
  }

  donationRecheckTimer = setInterval(() => {
    processPendingDonationPayments().catch((error) => {
      logger.error({ err: error }, 'Donation payment background recheck failed');
    });
  }, DONATION_RECHECK_INTERVAL_MS);

  if (typeof donationRecheckTimer.unref === 'function') {
    donationRecheckTimer.unref();
  }

  logger.info({
    intervalMs: DONATION_RECHECK_INTERVAL_MS,
    batchSize: DONATION_RECHECK_BATCH_SIZE
  }, 'Donation payment background recheck loop started');

  return donationRecheckTimer;
}

function stopDonationPaymentRecheckLoop() {
  if (!donationRecheckTimer) {
    return;
  }

  clearInterval(donationRecheckTimer);
  donationRecheckTimer = null;
}

module.exports = {
  listDonationProducts,
  listDonationPayments,
  createDonationPayment,
  submitDonationTransaction,
  getDonationPayment,
  serializeDonationPayment,
  processPendingDonationPayments,
  startDonationPaymentRecheckLoop,
  stopDonationPaymentRecheckLoop,
  setDonationVerifierForTests,
  resetDonationVerifier
};
