// index.js  ─  7StarsWin Affiliate Telegram Bot
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const http                 = require('http');
const { connectDB, getUserData, saveUserData } = require('./utils/db');
const { loadLanguage }     = require('./utils/i18n');
const { getSession, clearSession } = require('./utils/session');
const { logToAdmin }       = require('./utils/helpers');
const {
  promoFlow,
  askPromoLanguage,
  askPromoCode,
  showManagerCountries,
  showManagerContact,
  deliverPromoMaterials
} = require('./flows/promoFlow');

// ── Env validation ─────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.BOT_TOKEN;
const MONGODB_URI   = process.env.MONGODB_URI;
const WEBHOOK_URL   = process.env.WEBHOOK_URL;
const PORT          = parseInt(process.env.PORT || '3000', 10);
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number);

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN is not set. Add it to your .env file.');
  process.exit(1);
}

// ── Bot instance ───────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTexts(userId) {
  const userData = await getUserData(userId);
  return loadLanguage(userData?.language || 'en');
}

async function mainMenuKeyboard(userId) {
  const texts = await getTexts(userId);
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🤝 ${texts.affiliate_options}`, 'open_affiliate')]
  ]);
}

async function sendMainMenu(ctx) {
  const userId = ctx.from.id;
  const texts  = await getTexts(userId);
  const kb     = await mainMenuKeyboard(userId);
  const msg    = `🏠 <b>${texts.welcome}</b>\n\n${texts.choose_your_option}:`;
  try {
    await ctx.editMessageText(msg, { parse_mode: 'HTML', ...kb });
  } catch {
    await ctx.reply(msg, { parse_mode: 'HTML', ...kb });
  }
}

// ── /start ─────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const { id, first_name, last_name, username } = ctx.from;
  const name = [first_name, last_name].filter(Boolean).join(' ');

  await saveUserData(id, { userId: id, name, username });
  clearSession(id);

  const texts = await getTexts(id);
  const kb    = await mainMenuKeyboard(id);

  await ctx.reply(
    `👋 <b>${texts.welcome}</b>\n\n${texts.choose_your_option}:`,
    { parse_mode: 'HTML', ...kb }
  );
});

// ── /help ──────────────────────────────────────────────────────────────────

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 <b>Help</b>\n\n' +
    '/start — Restart the bot\n' +
    '/help  — Show this message',
    { parse_mode: 'HTML' }
  );
});

// ── Callback: back to main ─────────────────────────────────────────────────

bot.action('back_to_main', async (ctx) => {
  await ctx.answerCbQuery();
  clearSession(ctx.from.id);
  await sendMainMenu(ctx);
});

// ── Callback: open affiliate menu ─────────────────────────────────────────

bot.action('open_affiliate', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  await promoFlow(ctx, bot, ADMIN_CHAT_IDS, getSession, clearSession);
});

// ── Callback: affiliate — manager branch ──────────────────────────────────

bot.action('affiliate_manager', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  session.state = 'choosing_manager_country';
  await showManagerCountries(ctx, session);
});

const COUNTRIES = ['bangladesh', 'india', 'pakistan', 'egypt'];

COUNTRIES.forEach(country => {
  bot.action(`manager_country_${country}`, async (ctx) => {
    await ctx.answerCbQuery();
    await showManagerContact(ctx, country);
  });
});

// ── Callback: affiliate — promo banner branch ─────────────────────────────

bot.action('affiliate_promo_banner', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  session.state = 'choosing_banner_language';
  await askPromoLanguage(ctx, session);
});

const BANNER_LANGS = ['en', 'bn', 'hi', 'pk'];

BANNER_LANGS.forEach(lang => {
  bot.action(`promo_banner_lang_${lang}`, async (ctx) => {
    await ctx.answerCbQuery();
    const session       = getSession(ctx.from.id);
    session.data.bannerLanguage = lang;
    session.state       = 'waiting_promo_code';
    await askPromoCode(ctx, session);
  });
});

// ── Text message: receive promo code ─────────────────────────────────────

bot.on('text', async (ctx) => {
  const userId  = ctx.from.id;
  const session = getSession(userId);

  if (session.state !== 'waiting_promo_code') {
    // Unknown state — show main menu
    const texts = await getTexts(userId);
    const kb    = await mainMenuKeyboard(userId);
    await ctx.reply(
      `${texts.choose_your_option}:`,
      { parse_mode: 'HTML', ...kb }
    );
    return;
  }

  const promoCode = ctx.message.text.trim();

  // Basic length guard before full validation in deliverPromoMaterials
  if (promoCode.length === 0 || promoCode.length > 10) {
    const texts = await getTexts(userId);
    await ctx.reply(`⚠️ ${texts.invalid_promo_code}`);
    return;
  }

  session.data.promoCode = promoCode;
  session.state          = 'delivering';

  await deliverPromoMaterials(ctx, bot, ADMIN_CHAT_IDS, session, userId);
  clearSession(userId);
});

// ── Error handler ──────────────────────────────────────────────────────────

bot.catch(async (err, ctx) => {
  console.error('Bot error:', err.message, err.stack);
  try {
    await ctx.reply('⚠️ Something went wrong. Please try /start again.');
  } catch {}
});

// ── Launch: webhook on Heroku, polling locally ─────────────────────────────

async function launch() {
  await connectDB();

  if (WEBHOOK_URL) {
    // ── Heroku webhook mode ──────────────────────────────────────────────
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    const webhookFull = `${WEBHOOK_URL}${webhookPath}`;

    await bot.telegram.setWebhook(webhookFull);
    console.log(`🔗 Webhook set: ${webhookFull}`);

    // Create a minimal HTTP server that handles Telegram updates + Heroku health check
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        // Heroku health check
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('7StarsWin Bot is running.');
        return;
      }

      if (req.method === 'POST' && req.url === webhookPath) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const update = JSON.parse(body);
            await bot.handleUpdate(update);
          } catch (e) {
            console.error('Webhook update error:', e.message);
          }
          res.writeHead(200);
          res.end('OK');
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(PORT, () => {
      console.log(`🚀 Bot running in webhook mode on port ${PORT}`);
    });

  } else {
    // ── Local long-polling mode ──────────────────────────────────────────
    await bot.telegram.deleteWebhook();
    await bot.launch();
    console.log('🚀 Bot running in polling mode');
  }

  // Graceful shutdown
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

launch().catch(err => {
  console.error('Fatal launch error:', err);
  process.exit(1);
});
