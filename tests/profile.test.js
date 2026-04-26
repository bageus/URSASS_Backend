const test = require('node:test');
const assert = require('node:assert/strict');

const { getUtcDayKey, getYesterdayUtcDayKey } = require('../utils/utcDay');
const { buildReferralUrl } = require('../utils/referral');

// ── Profile response construction (unit level, no DB) ───────────────────────

function buildProfileResponse({ player, link, rank, totalRankedPlayers, req = null }) {
  const today = getUtcDayKey();
  const yesterday = getYesterdayUtcDayKey();

  const canShareToday = player.lastShareDay !== today;

  let displayStreak = player.shareStreak || 0;
  if (player.lastShareDay && player.lastShareDay < yesterday) {
    displayStreak = 0;
  }

  const referralCode = player.referralCode || null;
  const referralUrl = referralCode ? buildReferralUrl(referralCode, req) : null;

  return {
    primaryId: link.primaryId,
    rank: rank || null,
    totalRankedPlayers: totalRankedPlayers || 0,
    bestScore: player.bestScore || 0,
    gold: player.gold || 0,
    referralCode,
    referralUrl,
    telegram: {
      connected: !!link.telegramId,
      username: link.telegramUsername || null,
      id: link.telegramId || null
    },
    wallet: {
      connected: !!link.wallet,
      address: link.wallet || null
    },
    x: {
      connected: !!player.xUserId,
      username: player.xUsername || null
    },
    shareStreak: displayStreak,
    canShareToday,
    goldRewardToday: 20,
    lastShareDay: player.lastShareDay || null
  };
}

const mockLink = {
  primaryId: 'tg_123',
  telegramId: '123',
  telegramUsername: 'vasya',
  wallet: '0xabc123'
};

test('profile: returns correct rank and referral URL', () => {
  process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';

  const player = {
    wallet: 'tg_123',
    bestScore: 8350,
    gold: 1240,
    referralCode: 'K7M3X9PA',
    shareStreak: 3,
    lastShareDay: getYesterdayUtcDayKey(),
    xUserId: null,
    xUsername: null
  };

  const profile = buildProfileResponse({
    player,
    link: mockLink,
    rank: 42,
    totalRankedPlayers: 12500
  });

  assert.equal(profile.rank, 42);
  assert.equal(profile.totalRankedPlayers, 12500);
  assert.equal(profile.bestScore, 8350);
  assert.equal(profile.gold, 1240);
  assert.equal(profile.referralCode, 'K7M3X9PA');
  assert.equal(profile.referralUrl, 'https://ursasstube.fun/?ref=K7M3X9PA');
  assert.equal(profile.primaryId, 'tg_123');

  delete process.env.FRONTEND_BASE_URL;
});

test('profile: canShareToday is true when lastShareDay is not today', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: 'AAAAAAAA',
    shareStreak: 0,
    lastShareDay: getYesterdayUtcDayKey(),
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.canShareToday, true);
});

test('profile: canShareToday is false when lastShareDay is today', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: 'AAAAAAAA',
    shareStreak: 1,
    lastShareDay: getUtcDayKey(),
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.canShareToday, false);
});

test('profile: shareStreak shows 0 when lastShareDay is 2+ days ago', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: 'AAAAAAAA',
    shareStreak: 7,
    lastShareDay: '2020-01-01',
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.shareStreak, 0, 'should show 0 streak because day is old');
});

test('profile: shareStreak preserved when lastShareDay is yesterday', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: 'AAAAAAAA',
    shareStreak: 5,
    lastShareDay: getYesterdayUtcDayKey(),
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.shareStreak, 5);
});

test('profile: telegram section populated correctly', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: null,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.telegram.connected, true);
  assert.equal(profile.telegram.username, 'vasya');
  assert.equal(profile.telegram.id, '123');
});

test('profile: wallet section populated correctly', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: null,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.wallet.connected, true);
  assert.equal(profile.wallet.address, '0xabc123');
});

test('profile: x section shows not connected when no xUserId', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: null,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.x.connected, false);
  assert.equal(profile.x.username, null);
});

test('profile: referralUrl is null when no referralCode', () => {
  const player = {
    wallet: 'tg_123',
    bestScore: 0,
    gold: 0,
    referralCode: null,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null
  };
  const profile = buildProfileResponse({ player, link: mockLink, rank: null, totalRankedPlayers: 0 });
  assert.equal(profile.referralCode, null);
  assert.equal(profile.referralUrl, null);
});
