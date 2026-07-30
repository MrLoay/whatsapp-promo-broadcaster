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

async function renderNav(activePage) {
  const pages = [
    ['index.html', 'Home'],
    ['contacts.html', 'Contacts'],
    ['whatsapp.html', 'WhatsApp'],
  ];
  const nav = document.getElementById('nav');
  let me = null;
  try {
    me = await api('/auth/me');
  } catch {
    return;
  }
  nav.innerHTML =
    pages.map(([href, label]) => `<a href="${href}" class="${href === activePage ? 'active' : ''}">${label}</a>`).join('') +
    `<span class="spacer"></span><span class="user">${escapeHtml(me.username)}</span><button class="logout" id="logoutBtn">Log out</button>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  };

  try {
    const health = await fetch('/health').then((r) => r.json());
    const banner = document.getElementById('mode-banner');
    if (banner) {
      if (health.dryRun) {
        banner.textContent = 'DRY RUN MODE -- no real messages are being sent.';
        banner.className = 'mode-banner dryrun';
      } else {
        banner.textContent = 'LIVE -- sending via the unofficial web_js bridge. Real messages, real ban risk.';
        banner.className = 'mode-banner live-webjs';
      }
    }
  } catch {
    /* health check is best-effort */
  }
}
