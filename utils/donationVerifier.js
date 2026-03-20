const { ethers } = require('ethers');

const ERC20_TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const ERC20_TRANSFER_IFACE = new ethers.utils.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function buildCandidate(decoded) {
  return {
    actualTo: normalizeAddress(decoded.args.to),
    actualFrom: normalizeAddress(decoded.args.from),
    actualAmount: decoded.args.value.toString()
  };
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
    return {
      status: 'pending',
      reason: 'provider_unavailable',
      providerStatus: 'unavailable'
    };
  }

  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (error) {
    return {
      status: 'pending',
      reason: 'provider_error',
      providerStatus: 'error',
      errorMessage: error.message
    };
  }

  if (!receipt) {
    return { status: 'pending', reason: 'receipt_not_found', providerStatus: 'ok' };
  }

  if (receipt.status !== 1) {
    return { status: 'failed', reason: 'transaction_failed', providerStatus: 'ok' };
  }

  let currentBlock;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (error) {
    return {
      status: 'pending',
      reason: 'provider_error',
      providerStatus: 'error',
      errorMessage: error.message
    };
  }

  const confirmations = typeof receipt.confirmations === 'number'
    ? receipt.confirmations
    : Math.max(0, currentBlock - receipt.blockNumber + 1);

  const targetContract = normalizeAddress(tokenContract);
  const targetWallet = normalizeAddress(merchantWallet);
  const expectedAmountRaw = ethers.utils.parseUnits(String(expectedAmount), expectedDecimals).toString();

  const transferLogs = receipt.logs.filter((log) =>
    normalizeAddress(log.address) === targetContract &&
    Array.isArray(log.topics) &&
    log.topics[0] === ERC20_TRANSFER_TOPIC
  );

  if (!transferLogs.length) {
    return {
      status: 'failed',
      reason: 'transfer_log_not_found',
      confirmations,
      providerStatus: 'ok'
    };
  }

  const decodedCandidates = transferLogs.map((log) => {
    const decoded = ERC20_TRANSFER_IFACE.parseLog(log);
    return buildCandidate(decoded);
  });
  const exactMatch = decodedCandidates.find((candidate) =>
    candidate.actualTo === targetWallet &&
    candidate.actualAmount === expectedAmountRaw
  );

  if (!exactMatch) {
    const recipientMatch = decodedCandidates.find((candidate) => candidate.actualTo === targetWallet);
    const amountMatch = decodedCandidates.find((candidate) => candidate.actualAmount === expectedAmountRaw);
    const mismatchCandidate = recipientMatch || amountMatch || decodedCandidates[0];

    return {
      status: 'failed',
      reason: recipientMatch ? 'amount_mismatch' : amountMatch ? 'recipient_mismatch' : 'transfer_match_not_found',
      confirmations,
      providerStatus: 'ok',
      actualTo: mismatchCandidate?.actualTo || null,
      actualFrom: mismatchCandidate?.actualFrom || null,
      actualAmount: mismatchCandidate?.actualAmount || null,
      expectedAmount: expectedAmountRaw,
      candidateCount: decodedCandidates.length
    };
  }

  if (confirmations < requiredConfirmations) {
    return {
      status: 'pending',
      reason: 'awaiting_confirmations',
      confirmations,
      providerStatus: 'ok',
      actualTo: exactMatch.actualTo,
      actualFrom: exactMatch.actualFrom,
      actualAmount: exactMatch.actualAmount
    };
  }

  return {
    status: 'confirmed',
    reason: 'confirmed',
    confirmations,
    providerStatus: 'ok',
    actualTo: exactMatch.actualTo,
    actualFrom: exactMatch.actualFrom,
    actualAmount: exactMatch.actualAmount
  };
}

module.exports = {
  verifyDonationTransaction
};
