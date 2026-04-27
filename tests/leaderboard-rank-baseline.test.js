const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const mongoose = require('mongoose');

const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const AccountLink = require('../models/AccountLink');
const PlayerRun = require('../models/PlayerRun');
const SecurityEvent = require('../models/SecurityEvent');
const { createApp } = require('../app');

function queryResult(result) {
  return {
    session() { return this; },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    }
  };
}

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let originalStartSession;

test.before(() => {
  originalStartSession = mongoose.startSession;
  // Force non-transactional path (no replica set in tests)
  mongoose.startSession = async () => {
    const err = new Error('Transactions unsupported in tests');
    err.code = 20;
    throw err;
  };
  SecurityEvent.create = async () => ({ _id: 'sec' });
  SecurityEvent.countDocuments = async () => 0;
});

test.after(() => {
  mongoose.startSession = originalStartSession;
});

test('POST /api/leaderboard/save updates lastSeenRank to fresh rank after game', async () => {
  const wallet = Wallet.createRandom();
  const walletLower = wallet.address.toLowerCase();
  const timestamp = Date.now();
  const score = 9500;
  const distance = 200;
  const message = `Save game result\nWallet: ${wallet.address}\nScore: ${score}\nDistance: ${distance}\nTimestamp: ${timestamp}`;
  const signature = await wallet.signMessage(message);

  const seenSignatures = new Set();
  GameResult.findOne = ({ signature: sig }) => queryResult(seenSignatures.has(sig) ? { signature: sig } : null);
  GameResult.create = async (docs) => {
    seenSignatures.add(docs[0].signature);
    return docs;
  };

  let lastSeenRankAfterSave = undefined;
  const player = {
    wallet: walletLower,
    bestScore: 8000,
    bestDistance: 0,
    totalGoldCoins: 0,
    totalSilverCoins: 0,
    gamesPlayed: 0,
    gameHistory: [],
    averageScore: 0,
    scoreToAverageRatio: null,
    suspiciousScorePattern: false,
    referralRewardGranted: false,
    referredBy: null,
    lastSeenRank: null,
    updatedAt: null,
    save: async function () {
      lastSeenRankAfterSave = this.lastSeenRank;
      return this;
    }
  };

  // Return player for all findOne calls (game save, referral, rank update)
  Player.findOne = () => queryResult(player);

  // Mock Player.find for buildGameOverLeaderboardSlice
  Player.find = () => ({
    sort() {
      return {
        skip() {
          return {
            limit() {
              return { select: async () => [] };
            }
          };
        }
      };
    }
  });

  // 41 players with better score → rank 42
  Player.countDocuments = async (q) => {
    if (q?.bestScore?.$gt > 0) return 41;
    return 100;
  };

  PlayerRun.create = async (docs) => docs;
  PlayerRun.findOne = () => ({ sort: async () => null });
  PlayerRun.countDocuments = async () => 0;

  AccountLink.findOne = async () => null;

  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/leaderboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: wallet.address, score, distance, signature, timestamp })
    });

    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    assert.equal(lastSeenRankAfterSave, 42, 'lastSeenRank should be updated to fresh rank (42) after saving game result');
  } finally {
    server.close();
  }
});
