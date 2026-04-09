if (!requireAuth()) throw new Error('Not authenticated');
renderSidebar('events');

const user = getUser();
const canReview = user.role === 'admin' || user.role === 'council_officer';

let allEvents = [];
let allOrgs = [];

async function loadOrgs() {
  allOrgs = await api('GET', '/organizations');
  const html = allOrgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');
  document.getElementById('orgFilter').insertAdjacentHTML('beforeend', html);
  document.getElementById('registerOrgSel').insertAdjacentHTML('beforeend', html);
}

async function loadEvents() {
  try {
    allEvents = await api('GET', '/events');
    updateStats();
    renderPendingCards();
    renderTable(allEvents);
  } catch (e) {
    document.getElementById('eventsTbody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--danger)">${e.message}</td></tr>`;
  }
}

function updateStats() {
  document.getElementById('es-pending').textContent  = allEvents.filter(e => e.approval_status === 'pending').length;
  document.getElementById('es-approved').textContent = allEvents.filter(e => e.approval_status === 'approved').length;
  document.getElementById('es-denied').textContent   = allEvents.filter(e => e.approval_status === 'denied').length;
  document.getElementById('es-alcohol').textContent  = allEvents.filter(e => e.alcohol_present).length;
}

function renderPendingCards() {
  const pending = allEvents.filter(e => e.approval_status === 'pending');
  const section = document.getElementById('pendingSection');

  if (!canReview || !pending.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  document.getElementById('pendingCards').innerHTML = pending.map(e => `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:700;font-size:.95rem">${e.name}</span>
            ${e.alcohol_present ? '<span class="badge badge-warning" style="background:rgba(245,158,11,.12);color:#d97706">Alcohol</span>' : ''}
          </div>
          <div style="font-size:.78rem;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
            <span>🏛 <a href="/chapter.html?id=${e.org_id}" class="td-link">${e.chapter_letters} — ${e.org_name}</a></span>
            <span>📅 ${fmtDate(e.date)}</span>
            ${e.venue ? `<span>📍 ${e.venue}</span>` : ''}
            ${e.expected_attendance ? `<span>👥 ${e.expected_attendance} expected</span>` : ''}
          </div>
          ${e.security_plan ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:6px;font-style:italic">Security: ${e.security_plan}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn btn-success btn-sm" onclick="quickReview(${e.id},'approved')">✓ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="quickReview(${e.id},'denied')">✕ Deny</button>
          <button class="btn btn-ghost btn-sm" onclick="openReviewModal(${e.id})">Review…</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTable(events) {
  const tbody = document.getElementById('eventsTbody');
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No events found</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map(e => `
    <tr>
      <td style="white-space:nowrap">${fmtDate(e.date)}</td>
      <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.name}</td>
      <td>
        <a href="/chapter.html?id=${e.org_id}" class="td-link">${e.chapter_letters}</a>
        <div style="font-size:.72rem;color:var(--text-muted)">${e.council}</div>
      </td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.venue || '—'}</td>
      <td>${e.expected_attendance || '—'}</td>
      <td>${e.alcohol_present ? '<span style="color:var(--warning);font-weight:600">Yes</span>' : 'No'}</td>
      <td>${approvalBadge(e.approval_status)}</td>
      <td>${e.reviewer_name || '—'}</td>
      <td>
        <div style="display:flex;gap:6px">
          ${canReview && e.approval_status === 'pending'
            ? `<button class="btn btn-ghost btn-sm" onclick="openReviewModal(${e.id})">Review</button>`
            : canReview
            ? `<button class="btn btn-ghost btn-sm" onclick="openReviewModal(${e.id})">Update</button>`
            : ''}
          <a href="/chapter.html?id=${e.org_id}" class="btn btn-ghost btn-sm">Chapter</a>
        </div>
      </td>
    </tr>
  `).join('');
}

function applyFilters() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const orgId   = document.getElementById('orgFilter').value;
  const status  = document.getElementById('statusFilter').value;
  const alcohol = document.getElementById('alcoholFilter').value;

  renderTable(allEvents.filter(e => {
    return (!search  || e.name.toLowerCase().includes(search) || e.org_name.toLowerCase().includes(search))
        && (!orgId   || e.org_id == orgId)
        && (!status  || e.approval_status === status)
        && (alcohol === '' || e.alcohol_present == alcohol);
  }));
}

['searchInput','orgFilter','statusFilter','alcoholFilter'].forEach(id => {
  document.getElementById(id).addEventListener('input', applyFilters);
  document.getElementById(id).addEventListener('change', applyFilters);
});

// ─── Register Event ───────────────────────────────────────────────────────────
document.getElementById('registerEventBtn').addEventListener('click', () => {
  document.getElementById('registerForm').reset();
  openModal('registerModal');
});

document.getElementById('saveRegisterBtn').addEventListener('click', async () => {
  const form = document.getElementById('registerForm');
  const data = Object.fromEntries(new FormData(form));
  data.org_id = parseInt(data.org_id);
  data.alcohol_present = form.elements['alcohol_present'].checked ? 1 : 0;
  if (data.expected_attendance) data.expected_attendance = parseInt(data.expected_attendance);

  if (!data.org_id || !data.name || !data.date) {
    toast('Chapter, event name, and date are required', 'warning');
    return;
  }

  const btn = document.getElementById('saveRegisterBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    await api('POST', '/events', data);
    closeModal('registerModal');
    toast('Event submitted for approval');
    await loadEvents();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit for Approval';
  }
});

// ─── Quick Review ─────────────────────────────────────────────────────────────
async function quickReview(id, decision) {
  if (!canReview) { toast('Insufficient permissions', 'error'); return; }
  try {
    await api('POST', `/events/${id}/review`, { approval_status: decision });
    toast(`Event ${decision}`);
    await loadEvents();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Review Modal ─────────────────────────────────────────────────────────────
function openReviewModal(id) {
  const ev = allEvents.find(e => e.id === id);
  if (!ev) return;

  document.getElementById('reviewEventId').value = id;
  document.getElementById('reviewModalTitle').textContent = ev.name;
  document.getElementById('reviewDecision').value = ev.approval_status;
  document.getElementById('reviewNotes').value = ev.notes || '';

  document.getElementById('reviewEventDetails').innerHTML = `
    <strong>${ev.name}</strong><br>
    Chapter: ${ev.chapter_letters} — ${ev.org_name}<br>
    Date: ${fmtDate(ev.date)}<br>
    Venue: ${ev.venue || 'TBD'}<br>
    Expected Attendance: ${ev.expected_attendance || 'N/A'}<br>
    Alcohol: ${ev.alcohol_present ? '<strong style="color:var(--warning)">YES</strong>' : 'No'}<br>
    ${ev.security_plan ? `Security Plan: ${ev.security_plan}` : '<em style="color:var(--text-muted)">No security plan submitted</em>'}
  `;

  openModal('reviewModal');
}

document.getElementById('saveReviewBtn').addEventListener('click', async () => {
  if (!canReview) { toast('Insufficient permissions', 'error'); return; }

  const id       = document.getElementById('reviewEventId').value;
  const decision = document.getElementById('reviewDecision').value;
  const notes    = document.getElementById('reviewNotes').value;

  const btn = document.getElementById('saveReviewBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    await api('POST', `/events/${id}/review`, { approval_status: decision, notes });
    closeModal('reviewModal');
    toast(`Decision recorded: ${decision}`);
    await loadEvents();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Decision';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadOrgs().then(loadEvents);
