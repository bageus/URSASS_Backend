function shortenWallet(wallet) {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function resolveDisplayNameFromPreferences({ leaderboardDisplay, nickname, telegramUsername, wallet }) {
  switch (leaderboardDisplay || 'wallet') {
    case 'nickname':
      return nickname || shortenWallet(wallet) || (telegramUsername ? `@${telegramUsername}` : null) || 'Player';
    case 'telegram':
      return telegramUsername
        ? `@${telegramUsername}`
        : (nickname || shortenWallet(wallet) || 'Player');
    case 'wallet':
    default:
      return shortenWallet(wallet) || (telegramUsername ? `@${telegramUsername}` : (nickname || 'Player'));
  }
}

function resolveDisplayNameFromLink(link, primaryId) {
  if (!link) {
    if (primaryId && primaryId.startsWith('0x')) {
      return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
    }
    return primaryId || 'Unknown';
  }

  if (link.wallet) {
    return `${link.wallet.slice(0, 6)}...${link.wallet.slice(-4)}`;
  }

  if (link.telegramUsername) {
    return `@${link.telegramUsername}`;
  }

  if (link.telegramId) {
    return `TG#${link.telegramId}`;
  }

  if (primaryId && primaryId.startsWith('0x')) {
    return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
  }
  return primaryId || 'Unknown';
}

module.exports = {
  shortenWallet,
  resolveDisplayNameFromPreferences,
  resolveDisplayNameFromLink
};
