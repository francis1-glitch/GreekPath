// ─── Token management ────────────────────────────────────────────────────────
const TOKEN_KEY = 'cw_token';
const USER_KEY  = 'cw_user';

function getToken()  { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function getUser()   { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setUser(u)  { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

function requireAuth() {
  if (!getToken()) { window.location.href = '/login.html'; return false; }
  return true;
}

function logout() {
  clearAuth();
  window.location.href = '/login.html';
}

// ─── API helper ──────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { logout(); return; }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function initToasts() {
  if (!document.getElementById('toast-container')) {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
}

function toast(msg, type = 'success') {
  initToasts();
  const icons = { success: '✓', error: '✕', warning: '⚠' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => { t.classList.add('show'); }); });
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  document.querySelectorAll('.modal-backdrop.open').forEach(el => el.classList.remove('open'));
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) closeAllModals();
});

// ─── Sidebar / Nav rendering ──────────────────────────────────────────────────
function renderSidebar(activePage) {
  const user = getUser();
  if (!user) return;

  const navItems = [
    { page: 'dashboard', href: '/dashboard.html', icon: '⊞', label: 'Dashboard' },
    { page: 'incidents', href: '/incidents.html', icon: '⚠', label: 'Incidents' },
    { page: 'events',    href: '/events.html',    icon: '📅', label: 'Events' },
  ];

  const initials = user.name.split(' ').map(n => n[0]).slice(0,2).join('');
  const roleLabel = user.role.replace(/_/g, ' ');

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-icon">⚖</div>
      <div>
        <div class="brand-text">GreekPath</div>
        <div class="brand-sub">Penn State</div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-label">Navigation</div>
      ${navItems.map(item => `
        <a href="${item.href}" class="sidebar-nav-item ${activePage === item.page ? 'active' : ''}">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
        </a>
      `).join('')}
    </div>

    <div class="sidebar-footer">
      <div class="sidebar-user" onclick="logout()">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${user.name}</div>
          <div class="user-role">${roleLabel}</div>
        </div>
        <span style="margin-left:auto;font-size:.75rem;color:var(--text-muted-inv);opacity:.6">→</span>
      </div>
    </div>
  `;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function badge(value, prefix = '') {
  const cls = prefix ? `badge-${prefix}-${value}` : `badge-${value}`;
  return `<span class="badge ${cls}">${value}</span>`;
}

function statusBadge(value) {
  return `<span class="badge badge-${value}">${value}</span>`;
}

function compliancePct(compliant, total) {
  if (!total) return 0;
  return Math.round((compliant / total) * 100);
}

function barColor(pct) {
  if (pct >= 80) return 'bar-green';
  if (pct >= 50) return 'bar-yellow';
  return 'bar-red';
}

function barTextColor(pct) {
  if (pct >= 80) return '#16a34a';
  if (pct >= 50) return '#d97706';
  return '#dc2626';
}

function councilBadge(council) {
  return `<span class="badge badge-${council}">${council}</span>`;
}

function orgStatusBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function severityBadge(sev) {
  return `<span class="badge badge-${sev}">${sev}</span>`;
}

function approvalBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function categoryBadge(cat) {
  return `<span class="badge badge-${cat}">${cat}</span>`;
}

function renderPageLoader(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div class="page-loader">
      <div class="spinner"></div>
      Loading…
    </div>`;
}
