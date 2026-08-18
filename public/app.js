async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LANGUAGES = [
  ['en', 'EN'],
  ['ms', 'Bahasa Melayu'],
  ['zh', '中文'],
];

async function renderNav(activePage) {
  const pages = [
    ['index.html', 'nav.home'],
    ['contacts.html', 'nav.contacts'],
    ['whatsapp.html', 'nav.whatsapp'],
  ];
  const nav = document.getElementById('nav');
  let me = null;
  try {
    me = await api('/auth/me');
  } catch {
    return;
  }
  const langOptions = LANGUAGES.map(
    ([code, label]) => `<option value="${code}" ${code === getLang() ? 'selected' : ''}>${label}</option>`
  ).join('');

  const currentTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);

  nav.innerHTML =
    pages.map(([href, key]) => `<a href="${href}" class="${href === activePage ? 'active' : ''}" data-i18n="${key}"></a>`).join('') +
    `<span class="spacer"></span>` +
    `<button id="themeToggleBtn" style="margin-right:10px; background:var(--card); border:1px solid var(--border); color:var(--text); cursor:pointer;">${currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}</button>` +
    `<select id="langSelect" style="margin-right:10px;">${langOptions}</select>` +
    `<span class="user">${escapeHtml(me.username)}</span><button class="logout" id="logoutBtn" data-i18n="nav.logout"></button>`;

  document.getElementById('themeToggleBtn').onclick = () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.getElementById('themeToggleBtn').textContent = nextTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
  };

  document.getElementById('logoutBtn').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  };
  document.getElementById('langSelect').onchange = (e) => {
    setLang(e.target.value);
    window.location.reload();
  };

  applyTranslations();

  try {
    const health = await fetch('/health').then((r) => r.json());
    const banner = document.getElementById('mode-banner');
    if (banner) {
      if (health.dryRun) {
        banner.textContent = t('banner.dryrun');
        banner.className = 'mode-banner dryrun';
      } else {
        banner.textContent = t('banner.live');
        banner.className = 'mode-banner live-webjs';
      }
    }
  } catch {
    /* health check is best-effort */
  }
}
