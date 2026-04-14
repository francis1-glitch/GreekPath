if (!requireAuth()) throw new Error('unauthenticated');

let allEvents = [];
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;

(async function init() {
  renderSidebar('events');
  const user = getUser();

  await loadOrgs();
  await loadEvents();

  document.getElementById('registerEventBtn').onclick = () => openModal('registerModal');
  document.getElementById('saveRegisterBtn').onclick  = submitRegister;
  document.getElementById('saveReviewBtn').onclick    = submitReview;
  document.getElementById('saveReportBtn').onclick    = submitPostReport;

  ['searchInput','orgFilter','statusFilter','alcoholFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', filterEvents); el.addEventListener('change', filterEvents); }
  });

  document.getElementById('calPrev').onclick = () => { shiftMonth(-1); loadCalendar(); };
  document.getElementById('calNext').onclick = () => { shiftMonth(1);  loadCalendar(); };

  if (user.role === 'admin' || user.role === 'council_officer') {
    document.getElementById('pendingSection').style.display = 'block';
  }
})();

function switchTab(tab) {
  document.getElementById('listView').style.display     = tab === 'list'     ? 'block' : 'none';
  document.getElementById('calendarView').style.display = tab === 'calendar' ? 'block' : 'none';
  document.getElementById('tabList').classList.toggle('active', tab === 'list');
  document.getElementById('tabCalendar').classList.toggle('active', tab === 'calendar');
  if (tab === 'calendar') loadCalendar();
}

async function loadOrgs() {
  const orgs = await api('GET', '/organizations').catch(() => []);
  const options = orgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');
  ['orgFilter','registerOrgSel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.insertAdjacentHTML('beforeend', options);
  });
}

async function loadEvents() {
  try {
    allEvents = await api('GET', '/events');
    updateStats(allEvents);
    renderPendingCards(allEvents.filter(e => e.approval_status === 'pending'));
    renderTable(allEvents);
  } catch (err) {
    document.getElementById('eventsTbody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

function updateStats(events) {
  document.getElementById('es-pending').textContent  = events.filter(e => e.approval_status === 'pending').length;
  document.getElementById('es-approved').textContent = events.filter(e => e.approval_status === 'approved').length;
  document.getElementById('es-denied').textContent   = events.filter(e => e.approval_status === 'denied').length;
  document.getElementById('es-alcohol').textContent  = events.filter(e => e.alcohol_present).length;
}

function renderTable(events) {
  const user = getUser();
  const canReview = user.role === 'admin' || user.role === 'council_officer';
  const tbody = document.getElementById('eventsTbody');
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No events found</td></tr>`;
    return;
  }
  tbody.innerHTML = events.map(ev => `
    <tr>
      <td style="white-space:nowrap;font-size:.85rem">${fmtDate(ev.date)}</td>
      <td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ev.name}</td>
      <td>
        <a href="/chapter.html?id=${ev.org_id}" class="td-link">${ev.chapter_letters}</a>
        <div style="font-size:.72rem;color:var(--text-muted)">${ev.council}</div>
      </td>
      <td style="font-size:.85rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ev.venue || '—'}</td>
      <td>${ev.expected_attendance || '—'}</td>
      <td>${ev.alcohol_present ? '<span class="badge badge-amber">Yes</span>' : '<span class="badge">No</span>'}</td>
      <td>${approvalBadge(ev.approval_status)}</td>
      <td style="font-size:.8rem">${ev.reviewer_name || '—'}</td>
      <td style="white-space:nowrap">
        <div style="display:flex;gap:4px">
          ${canReview ? `<button class="btn btn-ghost btn-sm" onclick="openReview(${ev.id})">Review</button>` : ''}
          ${ev.approval_status === 'approved'
            ? `<button class="btn btn-ghost btn-sm" title="Post-event report" onclick="openPostReport(${ev.id}, '${ev.name.replace(/'/g,"\\'")}')">📝</button>`
            : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPendingCards(pending) {
  const user = getUser();
  const canReview = user.role === 'admin' || user.role === 'council_officer';
  const container = document.getElementById('pendingCards');
  if (!pending.length) {
    container.innerHTML = '<div style="padding:14px;font-size:.875rem;color:var(--text-muted)">No events awaiting review.</div>';
    return;
  }
  container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">` +
    pending.map(ev => `
      <div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <span style="font-weight:600">${ev.name}</span>
          ${ev.alcohol_present ? '<span class="badge badge-amber" style="font-size:.7rem">Alcohol</span>' : ''}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);line-height:1.7">
          <div>📅 ${fmtDate(ev.date)}</div>
          <div>📍 ${ev.venue || 'Venue TBD'}</div>
          <div>🏛 ${ev.org_name} (${ev.chapter_letters})</div>
          <div>👥 ${ev.expected_attendance || '?'} expected</div>
        </div>
        ${canReview ? `<button class="btn btn-primary btn-sm" style="width:100%;margin-top:12px" onclick="openReview(${ev.id})">Review This Event</button>` : ''}
      </div>
    `).join('') + '</div>';
}

function filterEvents() {
  const q      = document.getElementById('searchInput').value.toLowerCase();
  const org    = document.getElementById('orgFilter').value;
  const status = document.getElementById('statusFilter').value;
  const alc    = document.getElementById('alcoholFilter').value;
  const filtered = allEvents.filter(ev =>
    (!q      || ev.name.toLowerCase().includes(q) || (ev.org_name||'').toLowerCase().includes(q))
    && (!org    || String(ev.org_id) === org)
    && (!status || ev.approval_status === status)
    && (!alc    || String(ev.alcohol_present ? 1 : 0) === alc)
  );
  updateStats(filtered);
  renderTable(filtered);
  renderPendingCards(filtered.filter(e => e.approval_status === 'pending'));
}

// ─── Register ────────────────────────────────────────────────────────────────
async function submitRegister() {
  const form = document.getElementById('registerForm');
  const fd = Object.fromEntries(new FormData(form));
  if (!fd.org_id || !fd.name || !fd.date) {
    toast('Chapter, name, and date are required', 'warning'); return;
  }
  const btn = document.getElementById('saveRegisterBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await api('POST', '/events', {
      org_id: fd.org_id,
      name: fd.name,
      date: fd.date,
      venue: fd.venue || null,
      expected_attendance: fd.expected_attendance ? parseInt(fd.expected_attendance, 10) : null,
      alcohol_present: !!fd.alcohol_present,
      security_plan: fd.security_plan || null,
      risk_assessment: fd.risk_assessment || null,
    });
    toast('Event submitted for approval');
    closeModal('registerModal');
    form.reset();
    loadEvents();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit for Approval';
  }
}

// ─── Review ──────────────────────────────────────────────────────────────────
async function openReview(id) {
  const ev = allEvents.find(e => e.id === id) || await api('GET', `/events/${id}`);
  document.getElementById('reviewEventId').value   = ev.id;
  document.getElementById('reviewDecision').value  = ev.approval_status === 'approved' ? 'approved' : ev.approval_status === 'denied' ? 'denied' : 'pending';
  document.getElementById('reviewNotes').value     = ev.notes || '';
  document.getElementById('reviewModalTitle').textContent = `Review: ${ev.name}`;
  document.getElementById('reviewEventDetails').innerHTML = `
    <div><strong>Chapter:</strong> ${ev.org_name} (${ev.chapter_letters})</div>
    <div><strong>Date:</strong> ${fmtDate(ev.date)}</div>
    <div><strong>Venue:</strong> ${ev.venue || 'TBD'}</div>
    <div><strong>Expected Attendance:</strong> ${ev.expected_attendance || '—'}</div>
    <div><strong>Alcohol:</strong> ${ev.alcohol_present ? '⚠ <strong>Yes</strong>' : 'No'}</div>
    ${ev.risk_assessment ? `<div><strong>Risk Assessment:</strong> ${ev.risk_assessment}</div>` : ''}
    ${ev.security_plan   ? `<div><strong>Security Plan:</strong> ${ev.security_plan}</div>` : ''}
  `;
  openModal('reviewModal');
}

async function submitReview() {
  const id     = document.getElementById('reviewEventId').value;
  const status = document.getElementById('reviewDecision').value;
  const notes  = document.getElementById('reviewNotes').value;
  const btn = document.getElementById('saveReviewBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await api('POST', `/events/${id}/review`, { approval_status: status, notes });
    toast(`Decision recorded: ${status}`);
    closeModal('reviewModal');
    loadEvents();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Decision';
  }
}

// ─── Post-event report ───────────────────────────────────────────────────────
async function openPostReport(id, name) {
  document.getElementById('reportEventId').value = id;
  document.getElementById('reportEventName').textContent = name;
  try {
    const existing = await api('GET', `/events/${id}/report`);
    document.getElementById('reportAttendance').value = existing?.actual_attendance || '';
    document.getElementById('reportNotes').value      = existing?.incident_notes    || '';
  } catch (_) {}
  openModal('reportModal');
}

async function submitPostReport() {
  const id = document.getElementById('reportEventId').value;
  const attendance = document.getElementById('reportAttendance').value;
  const notes = document.getElementById('reportNotes').value;
  try {
    await api('POST', `/events/${id}/report`, {
      actual_attendance: attendance ? parseInt(attendance, 10) : null,
      incident_notes: notes || null,
    });
    toast('Post-event report submitted');
    closeModal('reportModal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── Calendar ────────────────────────────────────────────────────────────────
function shiftMonth(delta) {
  calMonth += delta;
  if (calMonth > 12) { calMonth = 1;  calYear++; }
  if (calMonth < 1)  { calMonth = 12; calYear--; }
}

async function loadCalendar() {
  const title = document.getElementById('calTitle');
  title.textContent = new Date(calYear, calMonth - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  try {
    const events = await api('GET', `/events/calendar?year=${calYear}&month=${calMonth}`);
    renderCalendar(events);
  } catch (err) {
    document.getElementById('calendarGrid').innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--danger)">${err.message}</div>`;
  }
}

function renderCalendar(events) {
  const grid = document.getElementById('calendarGrid');
  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const today = new Date();

  const byDay = {};
  events.forEach(ev => {
    const d = new Date(ev.date).getDate();
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(ev);
  });

  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = DOW.map(d => `<div class="cal-header-cell">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = today.getFullYear() === calYear && today.getMonth()+1 === calMonth && today.getDate() === day;
    const dayEvents = byDay[day] || [];
    html += `
      <div class="cal-cell ${isToday ? 'today' : ''}">
        <div class="cal-day-num ${isToday ? 'today-num' : ''}">${day}</div>
        ${dayEvents.slice(0,3).map(ev => `
          <div class="cal-event cal-ev-${ev.approval_status}" title="${ev.name} — ${ev.org_name}" onclick="openReview(${ev.id})" style="cursor:pointer">
            ${ev.name.length > 18 ? ev.name.substring(0,17)+'…' : ev.name}
          </div>
        `).join('')}
        ${dayEvents.length > 3 ? `<div class="cal-event-more">+${dayEvents.length-3} more</div>` : ''}
      </div>
    `;
  }
  grid.innerHTML = html;
}
