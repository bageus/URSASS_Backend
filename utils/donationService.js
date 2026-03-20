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
const SUBMIT_TIMEOUT_MS = 30 * 60 * 1000;
const INTERNAL_STATUS_AWAITING_TX = 'awaiting_tx';
const RESPONSELESS_STATUSES = new Set([INTERNAL_STATUS_AWAITING_TX]);
const FINAL_STATUSES = new Set(['credited', 'failed', 'expired']);

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
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    submittedAt: payment.submittedAt || null,
    confirmedAt: payment.confirmedAt || null,
    creditedAt: payment.creditedAt || null,
    txRequest: includeTxRequest ? buildDonationTxRequest(payment) : null
  };
}

module.exports = {
  listDonationProducts,
  listDonationPayments,
  createDonationPayment,
  submitDonationTransaction,
  getDonationPayment,
  serializeDonationPayment,
  setDonationVerifierForTests,
  resetDonationVerifier
};
