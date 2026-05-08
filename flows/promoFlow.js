// flows/promoFlow.js
const { Markup }   = require('telegraf');
const { loadLanguage } = require('../utils/i18n');
const { getUserData, saveSubmission } = require('../utils/db');
const { ensureFolder, getFilesInFolder, delay, formatDate, logToAdmin } = require('../utils/helpers');
const fs   = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

// ── 1. Entry: show manager vs promo-banner choice ──────────────────────────

async function promoFlow(ctx, bot, adminChatIds, getSession, clearSession) {
  const userId   = ctx.from.id;
  const userData = await getUserData(userId);
  const texts    = loadLanguage(userData?.language || 'en');
  const session  = getSession(userId);

  session.state = 'affiliate_start';
  session.data  = { type: 'affiliate', language: userData?.language || 'en' };

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`👨‍💼 ${texts.manager}`,      'affiliate_manager'),
      Markup.button.callback(`🎨 ${texts.promo_banner}`, 'affiliate_promo_banner')
    ],
    [Markup.button.callback(texts.back, 'back_to_main')]
  ]);

  const text = `🤝 <b>${texts.affiliate_options}</b>\n\n${texts.choose_your_option}:`;

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// ── 2. Manager: country selection ─────────────────────────────────────────

async function showManagerCountries(ctx, session) {
  const userData = await getUserData(ctx.from.id);
  const texts    = loadLanguage(userData?.language || 'en');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`🇧🇩 ${texts.bangladesh}`, 'manager_country_bangladesh'),
      Markup.button.callback(`🇮🇳 ${texts.india}`,      'manager_country_india')
    ],
    [
      Markup.button.callback(`🇵🇰 ${texts.pakistan}`, 'manager_country_pakistan'),
      Markup.button.callback(`🇪🇬 ${texts.egypt}`,    'manager_country_egypt')
    ],
    [Markup.button.callback(texts.back, 'back_to_main')]
  ]);

  await ctx.reply(
    `👨‍💼 <b>${texts.choose_your_country}</b>\n\n${texts.select_country_for_manager}:`,
    { parse_mode: 'HTML', ...keyboard }
  );
}

// ── 3. Manager: show contact ───────────────────────────────────────────────

async function showManagerContact(ctx, country) {
  const userData = await getUserData(ctx.from.id);
  const texts    = loadLanguage(userData?.language || 'en');

  const managerUsername = 'Contact_7starswinpartners'; // without @

  const countryNames = {
    bangladesh: texts.bangladesh,
    india:      texts.india,
    pakistan:   texts.pakistan,
    egypt:      texts.egypt
  };
  const countryName = countryNames[country] || country;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(`📞 ${texts.contact} ${countryName} ${texts.manager}`, `https://t.me/${managerUsername}`)],
    [Markup.button.callback(texts.main_menu, 'back_to_main')]
  ]);

  await ctx.reply(
    `✅ <b>${texts.manager_contact_for} ${countryName}</b>\n\n` +
    `${texts.manager}: @${managerUsername}\n\n` +
    `${texts.click_button_to_contact}`,
    { parse_mode: 'HTML', ...keyboard }
  );
}

// ── 4. Promo banner: pick language ────────────────────────────────────────

async function askPromoLanguage(ctx, session) {
  const userData = await getUserData(ctx.from.id);
  const texts    = loadLanguage(userData?.language || 'en');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`🇺🇸 ${texts.english}`,   'promo_banner_lang_en'),
      Markup.button.callback(`🇧🇩 ${texts.bangla}`,    'promo_banner_lang_bn')
    ],
    [
      Markup.button.callback(`🇮🇳 ${texts.hindi}`,     'promo_banner_lang_hi'),
      Markup.button.callback(`🇵🇰 ${texts.pakistani}`, 'promo_banner_lang_pk')
    ],
    [Markup.button.callback(texts.back, 'back_to_main')]
  ]);

  await ctx.reply(
    `🎨 <b>${texts.select_banner_language}</b>\n\n${texts.choose_banner_set}:`,
    { parse_mode: 'HTML', ...keyboard }
  );
}

// ── 5. Promo banner: request promo code text ──────────────────────────────

async function askPromoCode(ctx, session) {
  const userData = await getUserData(ctx.from.id);
  const texts    = loadLanguage(userData?.language || 'en');

  session.state = 'waiting_promo_code';

  await ctx.reply(
    `✏️ <b>${texts.type_your_promo}</b>\n\n${texts.enter_promo_code_message}`,
    { parse_mode: 'HTML' }
  );
}

// ── 6. Image processing: overlay promo code ───────────────────────────────

async function addTextToImage(inputPath, outputPath, promoCode) {
  try {
    const image              = sharp(inputPath);
    const { width, height }  = await image.metadata();
    const fontSize           = Math.max(54, Math.min(Math.floor(width * 0.091), 115));

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text
          x="50%"
          y="94.5%"
          text-anchor="middle"
          font-family="Impact, Arial Black, Arial, sans-serif"
          font-size="${fontSize}"
          font-weight="900"
          fill="white"
          letter-spacing="2"
        >${promoCode.toUpperCase()}</text>
      </svg>`;

    await image
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toFile(outputPath);

    return true;
  } catch (err) {
    console.error('addTextToImage error:', err.message);
    return false;
  }
}

// ── 7. Deliver processed banners to user ──────────────────────────────────

async function deliverPromoMaterials(ctx, bot, adminChatIds, session, userId) {
  const { bannerLanguage, promoCode } = session.data;
  const userData = await getUserData(userId);
  const texts    = loadLanguage(userData?.language || 'en');

  try {
    // Validate promo code
    if (!promoCode || promoCode.trim().length === 0 || promoCode.trim().length > 10) {
      await ctx.reply(`⚠️ ${texts.invalid_promo_code}`);
      return;
    }

    // Validate language
    const VALID_LANGS = ['en', 'bn', 'hi', 'pk'];
    if (!VALID_LANGS.includes(bannerLanguage)) {
      await ctx.reply(`⚠️ ${texts.language_not_available}`);
      return;
    }

    const code       = promoCode.trim();
    const folderPath = path.join('./assets', bannerLanguage, 'banners');
    const tempFolder = path.join('./temp', userId.toString());

    await ensureFolder(folderPath);
    await ensureFolder(tempFolder);

    const imageFiles = await getFilesInFolder(folderPath);

    if (imageFiles.length === 0) {
      await ctx.reply(`⚠️ ${texts.no_banners_available.replace('{language}', bannerLanguage.toUpperCase())}`);
      return;
    }

    await ctx.reply(
      texts.processing_banners
        .replace('{count}', imageFiles.length)
        .replace('{promo}', code)
        .replace('{language}', bannerLanguage.toUpperCase()),
      { parse_mode: 'HTML' }
    );

    // ── Process all images ──────────────────────────────────────────────
    let sentCount  = 0;
    let failedCount = 0;
    const processedImages = [];

    for (const fileName of imageFiles) {
      const inputPath  = path.join(folderPath, fileName);
      const outputPath = path.join(tempFolder, `${code}_${fileName}`);
      try {
        await fs.access(inputPath);
        const ok = await addTextToImage(inputPath, outputPath, code);
        if (ok) {
          processedImages.push(outputPath);
        } else {
          failedCount++;
        }
      } catch (err) {
        console.error(`Processing ${fileName} failed:`, err.message);
        failedCount++;
      }
    }

    // ── Send in groups of 10 (Telegram media-group limit) ──────────────
    const GROUP_SIZE = 10;
    for (let i = 0; i < processedImages.length; i += GROUP_SIZE) {
      const group = processedImages.slice(i, i + GROUP_SIZE);
      try {
        const mediaGroup = group.map(p => ({ type: 'photo', media: { source: p } }));
        await ctx.replyWithMediaGroup(mediaGroup);
        sentCount += group.length;
        if (i + GROUP_SIZE < processedImages.length) await delay(1200);
      } catch (err) {
        console.error('Media group send error:', err.message);
        failedCount += group.length;
      }
    }

    // ── Cleanup temp files ──────────────────────────────────────────────
    await cleanupTemp(tempFolder, processedImages);

    // ── Persist & notify ───────────────────────────────────────────────
    await saveSubmission({
      userId,
      type: 'affiliate_promo_banner',
      data: { promoCode: code, bannerLanguage, filesDelivered: sentCount, totalFiles: imageFiles.length, failedFiles: failedCount }
    });

    const adminMsg =
      `🎨 <b>Promo Banner Request</b>\n\n` +
      `Name: ${userData?.name || 'Unknown'}\n` +
      `User ID: ${userId}\n` +
      `Language: ${bannerLanguage.toUpperCase()}\n` +
      `Promo Code: ${code}\n` +
      `Files Sent: ${sentCount}/${imageFiles.length}\n` +
      `Failed: ${failedCount}\n` +
      `Date: ${formatDate()}`;

    await logToAdmin(bot, adminChatIds, adminMsg);

    // ── Success message ────────────────────────────────────────────────
    const successKey = failedCount > 0 ? 'banners_delivered_with_failures' : 'banners_delivered_success';
    const successMsg = texts[successKey]
      .replace('{count}',    sentCount)
      .replace('{promo}',    code)
      .replace('{language}', bannerLanguage.toUpperCase())
      .replace('{failed}',   failedCount);

    await ctx.reply(`✅ <b>${texts.complete}!</b>\n\n${successMsg}`, { parse_mode: 'HTML' });

    // ── Final promotional message with APK button ──────────────────────
    const promoMsg = texts.final_promo_message.replace(/{promo}/g, code);
    const appKeyboard = Markup.inlineKeyboard([
      [Markup.button.url(`📲 ${texts.download_app}`, 'https://7starswin.com/downloads/androidclient/releases_android/7StarsWin/site/7StarsWin.apk')],
      [Markup.button.callback(texts.main_menu, 'back_to_main')]
    ]);

    await ctx.reply(promoMsg, { parse_mode: 'HTML', ...appKeyboard });

  } catch (err) {
    console.error('deliverPromoMaterials error:', err);
    await ctx.reply(`⚠️ ${texts.error_processing_banners}`);
  }
}

// ── Internal: temp folder cleanup ─────────────────────────────────────────

async function cleanupTemp(tempFolder, processedImages) {
  for (const p of processedImages) {
    try { await fs.unlink(p); } catch {}
  }
  try {
    const remaining = await fs.readdir(tempFolder);
    for (const f of remaining) {
      try { await fs.unlink(path.join(tempFolder, f)); } catch {}
    }
    await fs.rmdir(tempFolder);
  } catch {}
}

module.exports = {
  promoFlow,
  askPromoLanguage,
  askPromoCode,
  showManagerCountries,
  showManagerContact,
  deliverPromoMaterials
};
