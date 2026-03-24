const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');

const { verifyDonationTransaction } = require('../utils/donationVerifier');
const DonationPayment = require('../models/DonationPayment');
const Player = require('../models/Player');
const {
  processPendingDonationPayments,
  setDonationVerifierForTests,
  resetDonationVerifier,
  stopDonationPaymentRecheckLoop
} = require('../utils/donationService');

const transferInterface = new ethers.utils.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

function buildTransferLog({ tokenContract, from, to, value }) {
  const event = transferInterface.encodeEventLog(
    transferInterface.getEvent('Transfer'),
    [from, to, value]
  );

  return {
    address: tokenContract,
    topics: event.topics,
    data: event.data
  };
}

test.afterEach(() => {
  resetDonationVerifier();
  stopDonationPaymentRecheckLoop();
});

test('verifyDonationTransaction confirms exact recipient/amount match even if earlier log mismatches', async () => {
  const tokenContract = '0x55d398326f99059ff775485246999027b3197955';
  const merchantWallet = '0x244bcc2721f1037958862825c3feb6a7be6204a7';
  const sender = '0x1111111111111111111111111111111111111111';
  const otherRecipient = '0x2222222222222222222222222222222222222222';

  const provider = {
    async getTransactionReceipt() {
      return {
        status: 1,
        blockNumber: 100,
        logs: [
          buildTransferLog({
            tokenContract,
            from: sender,
            to: otherRecipient,
            value: ethers.utils.parseUnits('2', 18)
          }),
          buildTransferLog({
            tokenContract,
            from: sender,
            to: merchantWallet,
            value: ethers.utils.parseUnits('2', 18)
          })
        ]
      };
    },
    async getBlockNumber() {
      return 101;
    }
  };

  const result = await verifyDonationTransaction({
    txHash: '0xabc',
    expectedAmount: '2',
    expectedDecimals: 18,
    tokenContract,
    merchantWallet,
    requiredConfirmations: 1
  }, provider);

  assert.equal(result.status, 'confirmed');
  assert.equal(result.reason, 'confirmed');
  assert.equal(result.actualTo, merchantWallet);
  assert.equal(result.actualAmount, ethers.utils.parseUnits('2', 18).toString());
});

test('verifyDonationTransaction returns detailed mismatch reason when no exact transfer match exists', async () => {
  const tokenContract = '0x55d398326f99059ff775485246999027b3197955';
  const merchantWallet = '0x244bcc2721f1037958862825c3feb6a7be6204a7';
  const sender = '0x1111111111111111111111111111111111111111';

  const provider = {
    async getTransactionReceipt() {
      return {
        status: 1,
        blockNumber: 100,
        logs: [
          buildTransferLog({
            tokenContract,
            from: sender,
            to: merchantWallet,
            value: ethers.utils.parseUnits('3', 18)
          })
        ]
      };
    },
    async getBlockNumber() {
      return 101;
    }
  };

  const result = await verifyDonationTransaction({
    txHash: '0xdef',
    expectedAmount: '2',
    expectedDecimals: 18,
    tokenContract,
    merchantWallet,
    requiredConfirmations: 1
  }, provider);

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'amount_mismatch');
  assert.equal(result.actualTo, merchantWallet);
  assert.equal(result.actualAmount, ethers.utils.parseUnits('3', 18).toString());
  assert.equal(result.candidateCount, 1);
});

test('processPendingDonationPayments credits submitted donation in background recheck without double credit', async () => {
  const wallet = '0x3333333333333333333333333333333333333333';
  const paymentId = 'payment-bg-1';
  const now = new Date();
  let playerSaveCalls = 0;

  const player = {
    wallet,
    totalGoldCoins: 10,
    totalSilverCoins: 20,
    async save() {
      playerSaveCalls += 1;
      return this;
    }
  };

  const paymentStore = [{
    paymentId,
    wallet,
    productKey: 'starter_pack',
    productSnapshot: {
      title: 'Starter Pack',
      grant: { gold: 400, silver: 400 },
      requiredConfirmations: 1
    },
    status: 'submitted',
    network: 'BSC',
    tokenSymbol: 'USDT',
    tokenContract: '0x55d398326f99059ff775485246999027b3197955',
    merchantWallet: '0x244bcc2721f1037958862825c3feb6a7be6204a7',
    expectedAmount: '2',
    expectedDecimals: 18,
    txHash: '0xbackgroundhash',
    confirmations: 0,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    rewardGrantedAt: null,
    confirmedAt: null,
    creditedAt: null,
    failureReason: null,
    verificationReason: null,
    providerStatus: null,
    async save() {
      const index = paymentStore.findIndex((item) => item.paymentId === this.paymentId);
      paymentStore[index] = { ...paymentStore[index], ...this, updatedAt: new Date(), save: this.save };
      return this;
    }
  }];

  const matchesQuery = (item, query = {}) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) {
        return value.$in.includes(item[key]);
      }
      if ('$ne' in value) {
        return item[key] !== value.$ne;
      }
    }
    return item[key] === value;
  });

  DonationPayment.find = (query = {}) => {
    let results = paymentStore.filter((item) => matchesQuery(item, query)).map((item) => ({ ...item }));
    const chain = {
      sort() {
        return chain;
      },
      limit(limitValue) {
        return Promise.resolve(results.slice(0, limitValue).map((item) => ({ ...item, save: paymentStore[0].save })));
      }
    };
    return chain;
  };

  DonationPayment.findOneAndUpdate = async (query = {}, update = {}, options = {}) => {
    const index = paymentStore.findIndex((item) => matchesQuery(item, query));
    if (index < 0) {
      return null;
    }
    paymentStore[index] = {
      ...paymentStore[index],
      ...(update.$set || {}),
      updatedAt: new Date()
    };
    return options.new ? { ...paymentStore[index], save: paymentStore[0].save } : null;
  };

  DonationPayment.findOne = async (query = {}) => {
    const match = paymentStore.find((item) => matchesQuery(item, query));
    return match ? { ...match, save: paymentStore[0].save } : null;
  };

  Player.findOne = ({ wallet: requestedWallet }) => ({
    then(resolve, reject) {
      return Promise.resolve(requestedWallet === wallet ? player : null).then(resolve, reject);
    }
  });

  setDonationVerifierForTests(async () => ({
    status: 'confirmed',
    reason: 'confirmed',
    confirmations: 2,
    actualFrom: '0xsender',
    actualTo: paymentStore[0].merchantWallet,
    actualAmount: ethers.utils.parseUnits('2', 18).toString(),
    providerStatus: 'ok'
  }));

  const firstRun = await processPendingDonationPayments({ limit: 10 });
  const secondRun = await processPendingDonationPayments({ limit: 10 });

  assert.equal(firstRun.processed, 1);
  assert.equal(secondRun.processed, 0);
  assert.equal(paymentStore[0].status, 'credited');
  assert.equal(player.totalGoldCoins, 410);
  assert.equal(player.totalSilverCoins, 420);
  assert.equal(playerSaveCalls, 1);
});
