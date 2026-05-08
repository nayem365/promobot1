// utils/i18n.js
const SUPPORTED = ['en', 'bn', 'hi', 'pk'];

function loadLanguage(lang) {
  const code = SUPPORTED.includes(lang) ? lang : 'en';
  try {
    return require(`../locales/${code}`);
  } catch {
    return require('../locales/en');
  }
}

module.exports = { loadLanguage, SUPPORTED };
