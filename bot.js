const TelegramBot = require('node-telegram-bot-api');

let bot = null;
let restartTimer = null;

async function processSuccessfulPaymentMessage(message) {
  const paymentMessage = message?.successful_payment ? message : message?.message;
  if (!paymentMessage?.successful_payment) {
    return;
  }

  try {
    const { handleTelegramSuccessfulPayment } = require('./utils/donationService');
    await handleTelegramSuccessfulPayment({ message: paymentMessage });
  } catch (error) {
    console.error('❌ Bot successful_payment handling failed:', error.message || error);
  }
}

function registerHandlers(currentBot) {
   currentBot.on('pre_checkout_query', async (query) => {
    try {
      const { handleTelegramPreCheckoutQuery } = require('./utils/donationService');
      await handleTelegramPreCheckoutQuery({ pre_checkout_query: query });
    } catch (error) {
      console.error('❌ Bot pre_checkout_query handling failed:', error.message || error);
    }
  });

  currentBot.on('successful_payment', processSuccessfulPaymentMessage);

  // /start
  currentBot.onText(/\/start/, (msg) => {
    currentBot.sendMessage(msg.chat.id,
      `🐻 *Ursass Tube*\n\n` +
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
  currentBot.onText(/\/help/, (msg) => {
    currentBot.sendMessage(msg.chat.id,
      `📖 *Commands:*\n\n` +
      `/start — Open game\n` +
      `/help — This help\n` +
      `/status — Your link status\n\n` +
      `Send your 6-character code to link your wallet!`,
      { parse_mode: 'Markdown' }
    );
  });

  // /status
  currentBot.onText(/\/status/, async (msg) => {
    const telegramId = String(msg.from.id);

    try {
      const AccountLink = require('./models/AccountLink');
      const Player = require('./models/Player');

      const link = await AccountLink.findOne({ telegramId });

      if (!link) {
        currentBbot.sendMessage(msg.chat.id,
          `❌ No account found.\n\nOpen the game first to create an account!`
        );
        return;
      }

      const player = await Player.findOne({ wallet: link.primaryId });

      let text = `📊 *Your Account*\n\n`;
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

      currentBot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Status error:', e);
      currentBot.sendMessage(msg.chat.id, `⚠️ Error. Try again later.`);
    }
  });

  // Handle 6-char verification codes
  currentBot.on('message', async (msg) => {
    if (msg.successful_payment) {
      await processSuccessfulPaymentMessage(msg);
      return;
    }

    const text = (msg.text || '').trim().toUpperCase();

    if (text.startsWith('/')) return;

    const codeMatch = text.match(/^[A-Z0-9]{6}$/);

    if (!codeMatch) {
      if (text.length >= 4 && text.length <= 8) {
        currentBot.sendMessage(msg.chat.id,
          `🤔 Invalid code format.\n\nValid codes are 6 characters, e.g. \`A3F9K2\``,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    const code = codeMatch[0];
    const telegramId = String(msg.from.id);
    const username = msg.from.username || null;

    currentBot.sendMessage(msg.chat.id, `⏳ Verifying \`${code}\`...`, { parse_mode: 'Markdown' });

    try {
      const LinkCode = require('./models/LinkCode');
      const { linkAccounts } = require('./utils/accountManager');

      const linkCode = await LinkCode.findOne({ code, used: false });

      if (!linkCode) {
        currentBot.sendMessage(msg.chat.id,
          `❌ Code not found or already used.\n\nRequest a new one in the game.`
        );
        return;
      }

      if (new Date() > linkCode.expiresAt) {
        await LinkCode.deleteOne({ _id: linkCode._id });
        currentBot.sendMessage(msg.chat.id,
          `⏰ Code expired (10 min limit).\n\nRequest a new one in the game.`
        );
        return;
      }

      linkCode.used = true;
      await linkCode.save();

      if (username) {
        const AccountLink = require('./models/AccountLink');
        await AccountLink.findOneAndUpdate(
          { primaryId: linkCode.primaryId },
          { telegramUsername: username }
        );
      }

      const result = await linkAccounts(linkCode.primaryId, 'telegram', telegramId);

      if (result.success) {
        if (username) {
          const AccountLink = require('./models/AccountLink');
          await AccountLink.findOneAndUpdate(
            { primaryId: result.primaryId || linkCode.primaryId },
            { telegramUsername: username }
          );
        }

        const displayName = username ? `@${username}` : `TG#${telegramId}`;

        let message = `✅ *Account linked!*\n\n`;
        message += `📱 Telegram: ${displayName}\n`;

        if (result.wallet) {
          message += `🔗 Wallet: \`${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}\`\n`;
        }

        if (result.merged) {
          message += `\n🔀 Accounts merged!\n`;
          message += `Master score: ${result.masterScore}`;
          if (result.slaveScoreWas > 0) {
            message += `\n⚠️ Old score (${result.slaveScoreWas}) was reset.`;
          }
        }
        message += `\n\n🎮 Return to the game — everything is synced!`;

        currentBot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });

        console.log(`✅ Bot linked: ${displayName} → ${linkCode.primaryId}`);
      } else {
        currentBot.sendMessage(msg.chat.id, `❌ Linking failed: ${result.error}`);
      }

    } catch (e) {
      console.error('❌ Bot verify error:', e);
      currentBot.sendMessage(msg.chat.id, `⚠️ Server error. Try again later.`);
    }
  });
}

function scheduleBotRestart(delayMs = 5000) {
  if (restartTimer) return;

  console.warn(`🤖 Scheduling bot restart in ${delayMs}ms`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    initBot();
  }, delayMs);
}
  function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — bot disabled');
    return null;
  }

  try {
    if (bot) {
      bot.removeAllListeners();
      bot.stopPolling().catch(() => {});
    }

      bot = new TelegramBot(token, { polling: true });
    registerHandlers(bot);

    bot.on('polling_error', (error) => {
      console.error('🤖 Bot polling error:', error.code || error.message);
      scheduleBotRestart();
    });

    bot.on('error', (error) => {
      console.error('🤖 Bot runtime error:', error.message || error);
      scheduleBotRestart();
    });

    console.log('🤖 Telegram bot started: @' + (process.env.TELEGRAM_BOT_USERNAME || 'unknown'));
    return bot;
  } catch (error) {
    console.error('❌ Bot init failed:', error.message || error);
    scheduleBotRestart(10000);
    return null;
  }
}

module.exports = { initBot, registerHandlers };
