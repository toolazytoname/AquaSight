// Public support/privacy pages share the main app's local language preference.
const key = 'aquasight-language';
const current = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
const query = new URLSearchParams(location.search).get('lang');
let stored;
try { stored = localStorage.getItem(key); } catch {}
const valid = value => value === 'zh' || value === 'en';
const preferred = valid(query) ? query : valid(stored) ? stored : navigator.language?.startsWith('zh') ? 'zh' : 'en';
if (valid(query)) { try { localStorage.setItem(key, query); } catch {} }
const page = document.documentElement.dataset.publicPage;
if (page && preferred !== current) {
  const target = new URL(`./${page}${preferred === 'en' ? '-en' : ''}.html`, location.href);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
}
document.querySelectorAll('[data-language]').forEach(link => {
  link.addEventListener('click', () => {
    try { localStorage.setItem(key, link.dataset.language); } catch {}
  });
});
