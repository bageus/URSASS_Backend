const TelegramBot = require('node-telegram-bot-api');

let bot = null;

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — bot disabled');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot started: @' + (process.env.TELEGRAM_BOT_USERNAME || 'unknown'));

  // /start
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `🐻 *Bear Tube Runner*\n\n` +
      `🎮 Play the game via the button below!\n\n` +
      `🔗 To link your wallet — click "Link Telegram" in the game, then send the code here.\n\n` +
      `Code format: 6 characters, e.g. \`A3F9K2\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎮 Play Game', web_app: { url: 'https://ursass-tube.vercel.app' } }
          ]]
        }
      }
    );
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `📖 *Commands:*\n\n` +
      `/start — Open game\n` +
      `/help — This help\n` +
      `/status — Your link status\n\n` +
      `Send your 6-character code to link your wallet!`,
      { parse_mode: 'Markdown' }
    );
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    const telegramId = String(msg.from.id);

    try {
      const AccountLink = require('./models/AccountLink');
      const Player = require('./models/Player');

      const link = await AccountLink.findOne({ telegramId });

      if (!link) {
        bot.sendMessage(msg.chat.id,
          `❌ No account found.\n\nOpen the game first to create an account!`
        );
        return;
      }

      const player = await Player.findOne({ wallet: link.primaryId });

      let text = `📊 *Your Account*\n\n`;

      // Show username if available
      const displayName = msg.from.username
        ? `@${msg.from.username}`
        : `TG#${telegramId}`;
      text += `📱 Telegram: ${displayName}\n`;

      if (link.wallet) {
        text += `🔗 Wallet: \`${link.wallet.slice(0, 6)}...${link.wallet.slice(-4)}\`\n`;
        text += `✅ Linked!\n`;
      } else {
        text += `❌ No wallet linked\n`;
      }

      if (player) {
        text += `\n🏆 Best Score: ${player.bestScore}`;
        text += `\n🎮 Games: ${player.gamesPlayed}`;
        text += `\n🪙 Gold: ${player.totalGoldCoins}`;
        text += `\n🥈 Silver: ${player.totalSilverCoins}`;
      }

      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Status error:', e);
      bot.sendMessage(msg.chat.id, `⚠️ Error. Try again later.`);
    }
  });

  // Handle 6-char verification codes
  bot.on('message', async (msg) => {
    const text = (msg.text || '').trim().toUpperCase();

    // Skip commands
    if (text.startsWith('/')) return;

    // Match 6-char code (letters + digits, no spaces)
    const codeMatch = text.match(/^[A-Z0-9]{6}$/);

    if (!codeMatch) {
      if (text.length >= 4 && text.length <= 8) {
        bot.sendMessage(msg.chat.id,
          `🤔 Invalid code format.\n\nValid codes are 6 characters, e.g. \`A3F9K2\``,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    const code = codeMatch[0];
    const telegramId = String(msg.from.id);
    const username = msg.from.username || null;

    bot.sendMessage(msg.chat.id, `⏳ Verifying \`${code}\`...`, { parse_mode: 'Markdown' });

    try {
      const LinkCode = require('./models/LinkCode');
      const { linkAccounts } = require('./utils/accountManager');

      const linkCode = await LinkCode.findOne({ code, used: false });

      if (!linkCode) {
        bot.sendMessage(msg.chat.id,
          `❌ Code not found or already used.\n\nRequest a new one in the game.`
        );
        return;
      }

      if (new Date() > linkCode.expiresAt) {
        await LinkCode.deleteOne({ _id: linkCode._id });
        bot.sendMessage(msg.chat.id,
          `⏰ Code expired (10 min limit).\n\nRequest a new one in the game.`
        );
        return;
      }

      linkCode.used = true;
      await linkCode.save();

      // Save username to AccountLink if available
      if (username) {
        const AccountLink = require('./models/AccountLink');
        await AccountLink.findOneAndUpdate(
          { primaryId: linkCode.primaryId },
          { telegramUsername: username }
        );
      }

      const result = await linkAccounts(linkCode.primaryId, 'telegram', telegramId);

      if (result.success) {
        // Save username after link too
        if (username) {
          const AccountLink = require('./models/AccountLink');
          await AccountLink.findOneAndUpdate(
            { primaryId: result.primaryId || linkCode.primaryId },
            { telegramUsername: username }
          );
        }

        const displayName = username ? `@${username}` : `TG#${telegramId}`;

        let text = `✅ *Account linked!*\n\n`;
        text += `📱 Telegram: ${displayName}\n`;

        if (result.wallet) {
          text += `🔗 Wallet: \`${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}\`\n`;
        }

        if (result.merged) {
          text += `\n🔀 Accounts merged!\n`;
          text += `Master score: ${result.masterScore}`;
          if (result.slaveScoreWas > 0) {
            text += `\n⚠️ Old score (${result.slaveScoreWas}) was reset.`;
          }
        }

        text += `\n\n🎮 Return to the game — everything is synced!`;

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });

        console.log(`✅ Bot linked: ${displayName} → ${linkCode.primaryId}`);
      } else {
        bot.sendMessage(msg.chat.id, `❌ Linking failed: ${result.error}`);
      }

    } catch (e) {
      console.error('❌ Bot verify error:', e);
      bot.sendMessage(msg.chat.id, `⚠️ Server error. Try again later.`);
    }
  });

  bot.on('polling_error', (error) => {
    if (error.code !== 'ETELEGRAM') {
      console.error('🤖 Bot polling error:', error.code);
    }
  });

  return bot;
}

module.exports = { initBot };
