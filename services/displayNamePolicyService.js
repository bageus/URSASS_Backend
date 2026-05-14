function shortenWallet(wallet) {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function normalizeTelegramUsername(username) {
  return String(username || '').trim().replace(/^@/, '');
}

function resolveLeaderboardDisplayName({ nickname, wallet, telegramUsername }) {
  const cleanNickname = String(nickname || '').trim();
  if (cleanNickname) return cleanNickname;

  const shortWallet = shortenWallet(wallet);
  if (shortWallet) return shortWallet;

  const cleanTelegram = normalizeTelegramUsername(telegramUsername);
  if (cleanTelegram) return `@${cleanTelegram}`;

  return 'Player';
}

function resolveDisplayNameFromPreferences({ leaderboardDisplay, nickname, telegramUsername, wallet }) {
  const cleanNickname = String(nickname || '').trim();
  const shortWallet = shortenWallet(wallet);
  const cleanTelegram = normalizeTelegramUsername(telegramUsername);

  switch (leaderboardDisplay) {
    case 'nickname':
      if (cleanNickname) return cleanNickname;
      break;
    case 'wallet':
      if (shortWallet) return shortWallet;
      break;
    case 'telegram':
      if (cleanTelegram) return `@${cleanTelegram}`;
      break;
    default:
      break;
  }

  return resolveLeaderboardDisplayName({
    nickname: cleanNickname,
    wallet,
    telegramUsername: cleanTelegram
  });
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
  normalizeTelegramUsername,
  resolveLeaderboardDisplayName,
  resolveDisplayNameFromPreferences,
  resolveDisplayNameFromLink
};
