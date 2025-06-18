window.i18n = {
  language: 'en',
  translations: {},
};

function t(key) {
  return window.i18n.translations[key] || key;
}

async function loadLanguage(lang) {
  try {
    const res = await fetch('lang/' + lang + '.json');
    if (!res.ok) throw new Error('Failed to load');
    window.i18n.translations = await res.json();
    window.i18n.language = lang;
    localStorage.setItem('lang', lang);
  } catch (err) {
    console.error('i18n load error', err);
  }
}

window.t = t;
window.loadLanguage = loadLanguage;
