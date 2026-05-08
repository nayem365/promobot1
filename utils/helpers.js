// utils/helpers.js
const fs   = require('fs').promises;
const path = require('path');

// ── Folder helpers ─────────────────────────────────────────────────────────

async function ensureFolder(folderPath) {
  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function getFilesInFolder(folderPath) {
  try {
    const entries = await fs.readdir(folderPath);
    const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    return entries.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }
}

// ── Misc ───────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── Admin logger ───────────────────────────────────────────────────────────

async function logToAdmin(bot, adminChatIds, message) {
  for (const chatId of adminChatIds) {
    try {
      await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`logToAdmin failed for ${chatId}:`, err.message);
    }
  }
}

// ── Safe ctx.reply / ctx.editMessageText wrappers ─────────────────────────
// Prevent "message is not modified" or "message can't be edited" crashes

async function safeEdit(ctx, text, extra) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) return;
    // Fall back to reply if edit fails (e.g. no previous bot message)
    return ctx.reply(text, extra);
  }
}

module.exports = { ensureFolder, getFilesInFolder, delay, formatDate, logToAdmin, safeEdit };
