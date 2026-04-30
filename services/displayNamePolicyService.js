function shortenWallet(wallet) {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return null;
  }
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function resolveLeaderboardDisplayName({ leaderboardDisplay, nickname, telegramUsername, wallet }) {
  switch (leaderboardDisplay || 'wallet') {
    case 'nickname':
      return nickname || (telegramUsername ? `@${telegramUsername}` : null) || shortenWallet(wallet) || 'Player';
    case 'telegram':
      return telegramUsername ? `@${telegramUsername}` : (nickname || shortenWallet(wallet) || 'Player');
    case 'wallet':
    default:
      return shortenWallet(wallet) || (nickname || (telegramUsername ? `@${telegramUsername}` : 'Player'));
  }
}

function resolveShareDisplayName({ nickname, telegramUsername, wallet, telegramId }) {
  return nickname || (telegramUsername ? `@${telegramUsername}` : null) || shortenWallet(wallet) || (telegramId ? `TG#${telegramId}` : 'Player');
}

function resolveProfileDisplayName({ nickname, telegramUsername, wallet, telegramId }) {
  return nickname || (telegramUsername ? `@${telegramUsername}` : null) || shortenWallet(wallet) || (telegramId ? `TG#${telegramId}` : null) || null;
}

module.exports = {
  shortenWallet,
  resolveLeaderboardDisplayName,
  resolveShareDisplayName,
  resolveProfileDisplayName
};
