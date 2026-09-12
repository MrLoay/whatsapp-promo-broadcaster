async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
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
    ['home', 'nav.home', 'Home'],
    ['contacts', 'nav.contacts', 'Contacts'],
    ['whatsapp', 'nav.whatsapp', 'WhatsApp'],
  ];
  const nav = document.getElementById('nav');
  if (!nav) return;

  const langOptions = LANGUAGES.map(
    ([code, label]) => `<option value="${code}" ${code === getLang() ? 'selected' : ''}>${label}</option>`
  ).join('');

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  const currentTab = (activePage === 'index.html' || activePage === 'home') ? 'home'
    : (activePage === 'contacts.html' || activePage === 'contacts') ? 'contacts'
    : 'whatsapp';

  // Render navigation tabs immediately so they are ALWAYS visible
  nav.innerHTML =
    pages.map(([id, key, defaultText]) => 
      `<a href="javascript:void(0)" class="nav-tab ${id === currentTab ? 'active' : ''}" data-view="${id}" data-i18n="${key}">${defaultText}</a>`
    ).join('') +
    `<span class="spacer"></span>` +
    `<button id="themeToggleBtn" style="margin-right:10px; background:var(--card); border:1px solid var(--border); color:var(--text); cursor:pointer;">🌓 Theme</button>` +
    `<select id="langSelect" style="margin-right:10px;">${langOptions}</select>` +
    `<span class="user" id="navUser"></span><button class="logout" id="logoutBtn" data-i18n="nav.logout" style="display:none;"></button>`;

  nav.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = tab.dataset.view;
      if (typeof window.switchMainView === 'function') {
        window.switchMainView(targetView);
      } else {
        window.location.href = `/?tab=${targetView}`;
      }
    });
  });

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const isCurrentlyDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const nextTheme = isCurrentlyDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('theme', nextTheme);
    };
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      window.location.href = '/login.html';
    };
  }

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.onchange = (e) => {
      setLang(e.target.value);
      window.location.reload();
    };
  }

  applyTranslations();

  // Populate user info asynchronously without blocking the tabs
  try {
    const me = await api('/auth/me');
    if (me && me.username) {
      const userSpan = document.getElementById('navUser');
      if (userSpan) userSpan.textContent = me.username;
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
    }
  } catch (err) {
    console.warn('Auth check in nav:', err);
  }

  // Load mode banner
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
