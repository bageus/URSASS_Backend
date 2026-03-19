const { ethers } = require('ethers');

const ERC20_TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const ERC20_TRANSFER_IFACE = new ethers.utils.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

async function verifyDonationTransaction({
  txHash,
  expectedAmount,
  expectedDecimals,
  tokenContract,
  merchantWallet,
  requiredConfirmations = 1
}, provider) {
  if (!provider) {
    return { status: 'failed', reason: 'provider_unavailable' };
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { status: 'pending', reason: 'receipt_not_found' };
  }

  if (receipt.status !== 1) {
    return { status: 'failed', reason: 'transaction_failed' };
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = typeof receipt.confirmations === 'number'
    ? receipt.confirmations
    : Math.max(0, currentBlock - receipt.blockNumber + 1);

  const targetContract = normalizeAddress(tokenContract);
  const targetWallet = normalizeAddress(merchantWallet);

  const transferLog = receipt.logs.find((log) =>
    normalizeAddress(log.address) === targetContract &&
    Array.isArray(log.topics) &&
    log.topics[0] === ERC20_TRANSFER_TOPIC
  );

  if (!transferLog) {
    return { status: 'failed', reason: 'transfer_log_not_found', confirmations };
  }

  const decoded = ERC20_TRANSFER_IFACE.parseLog(transferLog);
  const actualTo = normalizeAddress(decoded.args.to);
  const actualFrom = normalizeAddress(decoded.args.from);
  const actualAmountRaw = decoded.args.value.toString();
  const expectedAmountRaw = ethers.utils.parseUnits(String(expectedAmount), expectedDecimals).toString();

  if (actualTo !== targetWallet) {
    return {
      status: 'failed',
      reason: 'recipient_mismatch',
      confirmations,
      actualTo,
      actualFrom,
      actualAmount: actualAmountRaw
    };
  }

  if (actualAmountRaw !== expectedAmountRaw) {
    return {
      status: 'failed',
      reason: 'amount_mismatch',
      confirmations,
      actualTo,
      actualFrom,
      actualAmount: actualAmountRaw
    };
  }

  if (confirmations < requiredConfirmations) {
    return {
      status: 'pending',
      reason: 'awaiting_confirmations',
      confirmations,
      actualTo,
      actualFrom,
      actualAmount: actualAmountRaw
    };
  }

  return {
    status: 'confirmed',
    reason: 'confirmed',
    confirmations,
    actualTo,
    actualFrom,
    actualAmount: actualAmountRaw
  };
}

module.exports = {
  verifyDonationTransaction
};
