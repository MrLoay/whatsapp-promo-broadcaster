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

/** Thin status bar under the nav: license owner, accounts used/allowed, and time left. */
function renderLicenseBanner(nav, lic) {
  let bar = document.getElementById('license-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'license-banner';
    nav.insertAdjacentElement('afterend', bar);
  }

  let text, level = '';
  if (!lic.licensed) {
    text = t('license.none');
    level = 'bad';
  } else if (!lic.active) {
    text = t('license.expired', { date: lic.expires_at });
    level = 'bad';
  } else {
    text = t('license.banner', {
      customer: lic.customer_name, used: lic.used_accounts, max: lic.max_accounts,
      date: lic.expires_at, days: lic.days_left,
    });
    const full = lic.used_accounts >= lic.max_accounts;
    if (full) text += ' · ' + t('license.full');
    const soon = lic.days_left <= 14;
    if (soon) text += ' · ' + t('license.expiringSoon');
    if (full || soon) level = 'warn';
  }
  bar.textContent = text;
  bar.className = level;
}

const LANGUAGES = [
  ['en', 'EN'],
  ['ms', 'Bahasa Melayu'],
  ['zh', '中文'],
];

async function renderNav(activePage) {
  let pages = [
    ['home', 'nav.home', 'Home'],
    ['contacts', 'nav.contacts', 'Contacts'],
    ['whatsapp', 'nav.whatsapp', 'WhatsApp'],
    ['admin', 'nav.admin', 'Admin Panel'],
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
      `<a href="javascript:void(0)" class="nav-tab ${id === currentTab ? 'active' : ''}" data-view="${id}" data-i18n="${key}" style="${id === 'whatsapp' || id === 'admin' ? 'display:none;' : ''}">${t(key) || defaultText}</a>`
    ).join('') +
    `<span class="spacer"></span>` +
    `<span id="creditBalance" style="margin-right:15px; font-weight:bold; color:var(--success); display:none;"><span data-i18n="nav.credits">${t('nav.credits')}</span> <span id="creditCount"></span></span>` +
    `<button id="themeToggleBtn" style="margin-right:10px; background:var(--card); border:1px solid var(--border); color:var(--text); cursor:pointer;" data-i18n="nav.theme">${t('nav.theme')}</button>` +
    `<select id="langSelect" style="margin-right:10px;">${langOptions}</select>` +
    `<span class="user" id="navUser"></span><button class="logout" id="logoutBtn" data-i18n="nav.logout" style="display:none;">${t('nav.logout')}</button>`;

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
      const isCurrentlyDark = document.documentElement.getAttribute('data-theme') !== 'light';
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
      
      // Update role-based visibility
      if (me.role === 'admin') {
        nav.querySelectorAll('.nav-tab[data-view="whatsapp"], .nav-tab[data-view="admin"]').forEach(el => el.style.display = 'inline-block');
      }
      
      // License mode (SaaS): no per-message credits -- show the license status instead
      window.licenseInfo = me.license || null;
      if (me.license) renderLicenseBanner(nav, me.license);

      const creditBalance = document.getElementById('creditBalance');
      const creditCount = document.getElementById('creditCount');
      if (creditBalance && creditCount) {
        creditCount.textContent = (me.credits !== undefined && me.credits !== null) ? Number(me.credits).toFixed(2) : '0.00';
        if (me.license) {
          creditBalance.style.display = 'none';
        } else if (me.role !== 'admin') {
          creditBalance.style.display = 'inline-block';
        } else {
          creditBalance.style.display = 'none';
        }
      }
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
        // Live mode is the normal state; no warning bar.
        banner.textContent = '';
        banner.className = 'mode-banner';
      }
    }
  } catch {
    /* health check is best-effort */
  }
}
