require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'https://ursassbackend-production.up.railway.app';
const BOT_SECRET = process.env.TELEGRAM_BOT_SECRET;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set!');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bear Tube Link Bot started!');

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `🐻 *Bear Tube Runner — Link Bot*\n\n` +
    `This bot links your Telegram account to your game wallet.\n\n` +
    `*How to use:*\n` +
    `1️⃣ In the game, click "🔗 Link Telegram"\n` +
    `2️⃣ Copy the code (e.g. \`BEAR-A3F9K2\`)\n` +
    `3️⃣ Send the code here\n\n` +
    `That's it! Your accounts will be linked. 🎮`,
    { parse_mode: 'Markdown' }
  );
});

// /help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📖 *Commands:*\n\n` +
    `/start — Welcome message\n` +
    `/help — This help\n` +
    `/status — Check your link status\n\n` +
    `Just send your \`BEAR-XXXXXX\` code to link your account!`,
    { parse_mode: 'Markdown' }
  );
});

// /status command
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);

  try {
    const response = await fetch(`${BACKEND_URL}/api/account/info/${telegramId}`);

    if (response.ok) {
      const data = await response.json();

      let statusText = `📊 *Your Account Status*\n\n`;
      statusText += `📱 Telegram: TG#${data.telegramId}\n`;

      if (data.wallet) {
        statusText += `🔗 Wallet: \`${data.wallet.slice(0, 6)}...${data.wallet.slice(-4)}\`\n`;
        statusText += `✅ Accounts linked!\n`;
      } else {
        statusText += `❌ No wallet linked\n`;
      }

      statusText += `\n🏆 Best Score: ${data.bestScore}\n`;
      statusText += `🎮 Games Played: ${data.gamesPlayed}`;

      bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId,
        `❌ Account not found.\n\nPlay the game first to create an account!`
      );
    }
  } catch (error) {
    console.error('Status error:', error);
    bot.sendMessage(chatId, `⚠️ Error checking status. Try again later.`);
  }
});

// Handle verification codes (BEAR-XXXXXX)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim().toUpperCase();

  // Skip commands
  if (text.startsWith('/')) return;

  // Check if it looks like a link code
  const codeMatch = text.match(/^BEAR-[A-Z0-9]{6}$/);
  if (!codeMatch) {
    // Not a code — ignore or show hint
    if (text.length > 0 && text.length < 20) {
      bot.sendMessage(chatId,
        `🤔 That doesn't look like a valid code.\n\n` +
        `Valid codes look like: \`BEAR-A3F9K2\`\n` +
        `Get one from the game by clicking "🔗 Link Telegram"`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  const code = codeMatch[0];
  const telegramId = String(msg.from.id);
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';

  bot.sendMessage(chatId, `⏳ Verifying code \`${code}\`...`, { parse_mode: 'Markdown' });

  try {
    const response = await fetch(`${BACKEND_URL}/api/account/link/verify-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId,
        code,
        botSecret: BOT_SECRET
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      let successMsg = `✅ *Account linked successfully!*\n\n`;
      successMsg += `📱 Telegram: ${firstName || username || 'TG#' + telegramId}\n`;

      if (data.wallet) {
        successMsg += `🔗 Wallet: \`${data.wallet.slice(0, 6)}...${data.wallet.slice(-4)}\`\n`;
      }

      if (data.merged) {
        successMsg += `\n🔀 Accounts merged!\n`;
        successMsg += `Master score: ${data.masterScore}\n`;
        if (data.slaveScoreWas > 0) {
          successMsg += `⚠️ Old score (${data.slaveScoreWas}) was reset.`;
        }
      }

      successMsg += `\n🎮 Return to the game — your data is synced!`;

      bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
    } else {
      let errorMsg = `❌ *Linking failed*\n\n`;

      if (data.error === 'Code not found or already used') {
        errorMsg += `This code was not found or already used.\nRequest a new one in the game.`;
      } else if (data.error === 'Code expired. Please request a new one.') {
        errorMsg += `This code has expired (10 min limit).\nRequest a new one in the game.`;
      } else {
        errorMsg += `Error: ${data.error}`;
      }

      bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Verify error:', error);
    bot.sendMessage(chatId, `⚠️ Network error. Please try again.`);
  }
});

bot.on('polling_error', (error) => {
  console.error('🤖 Polling error:', error.code);
});
