if (!requireAuth()) throw new Error('Not authenticated');
renderSidebar('');

const params = new URLSearchParams(location.search);
const orgId = params.get('id');
if (!orgId) window.location.href = '/dashboard.html';

let chapter = null;
let editingComplianceId = null;

async function loadChapter() {
  try {
    chapter = await api('GET', `/organizations/${orgId}`);
    renderChapter();
  } catch (e) {
    document.getElementById('pageContent').innerHTML =
      `<div class="empty-state"><div class="empty-icon">✕</div><div class="empty-text">${e.message}</div></div>`;
  }
}

function renderChapter() {
  const user = getUser();
  const canEdit = user.role === 'admin' || user.role === 'council_officer';

  document.getElementById('pageTitle').textContent = chapter.name;

  // Topbar actions
  document.getElementById('topbarActions').innerHTML = `
    <a href="/roster.html?org_id=${orgId}" class="btn btn-outline btn-sm">👥 Roster</a>
    <a href="/documents.html?org_id=${orgId}" class="btn btn-outline btn-sm">📄 Documents</a>
    ${canEdit ? `<button class="btn btn-outline btn-sm" onclick="openEditModal()">Edit Chapter</button>` : ''}
  `;

  // Compliance stats
  const total = chapter.compliance ? chapter.compliance.length : 0;
  const compliant = chapter.compliance ? chapter.compliance.filter(c => c.status === 'compliant').length : 0;
  const overdue   = chapter.compliance ? chapter.compliance.filter(c => c.status === 'overdue').length : 0;
  const pending   = chapter.compliance ? chapter.compliance.filter(c => c.status === 'pending').length : 0;
  const pct = total ? Math.round((compliant / total) * 100) : 0;
  const fillClass = barColor(pct);

  document.getElementById('pageContent').innerHTML = `
    <!-- Hero -->
    <div class="chapter-hero">
      <div>
        <div class="chapter-hero-letters">${chapter.chapter_letters}</div>
        <div class="chapter-hero-name">${chapter.name}</div>
        <div class="chapter-hero-affil">${chapter.national_affiliation || ''}</div>
        <div class="hero-meta">
          <div class="hero-meta-item">
            <div class="label">Council</div>
            <div class="value">${chapter.council}</div>
          </div>
          <div class="hero-meta-item">
            <div class="label">Status</div>
            <div class="value" style="text-transform:capitalize">${chapter.status}</div>
          </div>
          <div class="hero-meta-item">
            <div class="label">Roster</div>
            <div class="value">${chapter.roster_size || '—'} members</div>
          </div>
          <div class="hero-meta-item">
            <div class="label">Chapter GPA</div>
            <div class="value">${chapter.gpa ? parseFloat(chapter.gpa).toFixed(2) : '—'}</div>
          </div>
          <div class="hero-meta-item">
            <div class="label">Founded</div>
            <div class="value">${chapter.founded_date ? fmtDate(chapter.founded_date) : '—'}</div>
          </div>
          <div class="hero-meta-item">
            <div class="label">Advisor</div>
            <div class="value">${chapter.advisor_name || '—'}</div>
          </div>
        </div>
      </div>
      <div class="hero-right">
        <div style="text-align:center">
          <div style="font-size:2.8rem;font-weight:900;line-height:1">${pct}%</div>
          <div style="font-size:.75rem;opacity:.6;margin-top:4px">Compliance Rate</div>
          <div style="width:120px;height:6px;background:rgba(255,255,255,.2);border-radius:99px;margin-top:10px;overflow:hidden">
            <div class="compliance-bar-fill ${fillClass}" style="width:${pct}%;background:${pct>=80?'#22c55e':pct>=50?'#f59e0b':'#ef4444'}"></div>
          </div>
        </div>
        <div style="display:flex;gap:12px;font-size:.78rem;opacity:.75">
          <span>✓ ${compliant} compliant</span>
          <span>⚠ ${pending} pending</span>
          ${overdue ? `<span style="color:#fca5a5">✕ ${overdue} overdue</span>` : ''}
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab active" data-tab="compliance" onclick="switchTab('compliance')">
        Compliance <span style="background:rgba(74,143,232,.12);color:var(--accent);padding:1px 7px;border-radius:99px;font-size:.7rem;margin-left:5px">${total}</span>
      </div>
      <div class="tab" data-tab="incidents" onclick="switchTab('incidents')">
        Incidents <span style="background:rgba(239,68,68,.1);color:var(--danger);padding:1px 7px;border-radius:99px;font-size:.7rem;margin-left:5px">${chapter.incidents ? chapter.incidents.length : 0}</span>
      </div>
      <div class="tab" data-tab="events" onclick="switchTab('events')">
        Events <span style="background:rgba(245,158,11,.1);color:var(--warning);padding:1px 7px;border-radius:99px;font-size:.7rem;margin-left:5px">${chapter.events ? chapter.events.length : 0}</span>
      </div>
    </div>

    <!-- Compliance Tab -->
    <div class="tab-pane active" id="tab-compliance">
      <div class="section-header">
        <div>
          <div class="section-title">Compliance Checklist</div>
          <div class="section-subtitle">Spring 2026 requirements</div>
        </div>
        ${canEdit ? `
          <div style="display:flex;gap:8px">
            <a href="/api/compliance/export/csv?org_id=${orgId}" class="btn btn-outline btn-sm">⬇ Export CSV</a>
            <button class="btn btn-outline btn-sm" style="color:var(--warning);border-color:var(--warning)" onclick="openResetChapterModal()">↺ Reset Semester</button>
          </div>
        ` : ''}
      </div>
      ${renderComplianceList()}
    </div>

    <!-- Incidents Tab -->
    <div class="tab-pane" id="tab-incidents">
      <div class="section-header">
        <div class="section-title">Incident History</div>
        <button class="btn btn-danger btn-sm" onclick="openAddIncidentModal()">+ Report Incident</button>
      </div>
      ${renderIncidentsTable()}
    </div>

    <!-- Events Tab -->
    <div class="tab-pane" id="tab-events">
      <div class="section-header">
        <div class="section-title">Events</div>
        <button class="btn btn-primary btn-sm" onclick="openAddEventModal()">+ Register Event</button>
      </div>
      ${renderEventsTable()}
    </div>
  `;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

function renderComplianceList() {
  if (!chapter.compliance || !chapter.compliance.length) {
    return `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No compliance requirements found</div></div>`;
  }

  const user = getUser();
  const canReview = user.role === 'admin' || user.role === 'council_officer';

  // Group by category
  const cats = {};
  for (const c of chapter.compliance) {
    if (!cats[c.category]) cats[c.category] = [];
    cats[c.category].push(c);
  }

  const catIcons = { training: '🎓', documentation: '📄', academic: '📚', insurance: '🛡' };

  return Object.entries(cats).map(([cat, items]) => `
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em">
        ${catIcons[cat] || '•'} ${cat}
      </div>
      ${items.map(c => {
        const icons = { compliant: '✓', pending: '⏳', overdue: '✕', waived: '◎' };
        const iconClasses = { compliant: 'ci-compliant', pending: 'ci-pending', overdue: 'ci-overdue', waived: 'ci-waived' };
        return `
          <div class="checklist-item">
            <div class="checklist-icon ${iconClasses[c.status]}">${icons[c.status]}</div>
            <div class="checklist-info">
              <div class="checklist-name">${c.req_name}</div>
              <div class="checklist-desc">${c.req_description || ''} ${c.deadline ? '· Due ' + fmtDate(c.deadline) : ''}</div>
            </div>
            <div class="checklist-right">
              ${statusBadge(c.status)}
              ${c.submitted_date ? `<span class="text-sm text-muted">${fmtDateShort(c.submitted_date)}</span>` : ''}
              ${canReview ? `<button class="btn btn-ghost btn-sm" onclick="openComplianceModal(${c.id}, '${c.req_name}', '${c.status}', '${(c.notes||'').replace(/'/g,"\\'")}', '${c.req_description||''}')">Update</button>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');
}

function renderIncidentsTable() {
  if (!chapter.incidents || !chapter.incidents.length) {
    return `<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-text">No incidents on record</div></div>`;
  }

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Description</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            ${chapter.incidents.map(i => `
              <tr>
                <td>${fmtDate(i.reported_date)}</td>
                <td>${i.type.replace(/_/g,' ')}</td>
                <td>${severityBadge(i.severity)}</td>
                <td>${statusBadge(i.status)}</td>
                <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.resolution || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderEventsTable() {
  if (!chapter.events || !chapter.events.length) {
    return `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">No events registered</div></div>`;
  }

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Venue</th>
              <th>Attendance</th>
              <th>Alcohol</th>
              <th>Status</th>
              <th>Reviewed By</th>
            </tr>
          </thead>
          <tbody>
            ${chapter.events.map(e => `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td style="font-weight:600">${e.name}</td>
                <td>${e.venue || '—'}</td>
                <td>${e.expected_attendance || '—'}</td>
                <td>${e.alcohol_present ? '<span style="color:var(--warning)">Yes</span>' : 'No'}</td>
                <td>${approvalBadge(e.approval_status)}</td>
                <td>${e.reviewer_name || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Compliance Modal ─────────────────────────────────────────────────────────
function openComplianceModal(id, name, currentStatus, notes, desc) {
  editingComplianceId = id;
  document.getElementById('complianceModalTitle').textContent = name;
  document.getElementById('complianceModalDesc').textContent = desc;
  document.getElementById('complianceStatusSel').value = currentStatus;
  document.getElementById('complianceNotes').value = notes || '';
  openModal('complianceModal');
}

document.getElementById('saveComplianceBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveComplianceBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    await api('PUT', `/compliance/status/${editingComplianceId}`, {
      status: document.getElementById('complianceStatusSel').value,
      notes:  document.getElementById('complianceNotes').value,
    });
    closeModal('complianceModal');
    toast('Compliance status updated');
    await loadChapter();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Update';
  }
});

// ─── Edit Org Modal ───────────────────────────────────────────────────────────
function openEditModal() {
  const form = document.getElementById('editOrgForm');
  const fields = ['id','name','chapter_letters','national_affiliation','council','status',
                  'founded_date','advisor_name','advisor_email','roster_size','gpa'];
  for (const f of fields) {
    const el = form.elements[f];
    if (el) el.value = chapter[f] !== null && chapter[f] !== undefined ? chapter[f] : '';
  }
  openModal('editOrgModal');
}

document.getElementById('saveEditOrgBtn').addEventListener('click', async () => {
  const form = document.getElementById('editOrgForm');
  const data = Object.fromEntries(new FormData(form));
  data.roster_size = parseInt(data.roster_size) || 0;
  data.gpa = parseFloat(data.gpa) || 0;

  const btn = document.getElementById('saveEditOrgBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    await api('PUT', `/organizations/${orgId}`, data);
    closeModal('editOrgModal');
    toast('Chapter updated successfully');
    await loadChapter();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
});

// ─── Add Incident Modal ───────────────────────────────────────────────────────
function openAddIncidentModal() {
  const form = document.getElementById('addIncidentForm');
  form.reset();
  form.elements['org_id'].value = orgId;
  openModal('addIncidentModal');
}

document.getElementById('saveIncidentBtn').addEventListener('click', async () => {
  const form = document.getElementById('addIncidentForm');
  const data = Object.fromEntries(new FormData(form));
  data.org_id = parseInt(data.org_id);

  if (!data.type || !data.severity || !data.description) {
    toast('All fields are required', 'warning');
    return;
  }

  const btn = document.getElementById('saveIncidentBtn');
  btn.disabled = true; btn.textContent = 'Reporting…';

  try {
    await api('POST', '/incidents', data);
    closeModal('addIncidentModal');
    toast('Incident reported');
    await loadChapter();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Report Incident';
  }
});

// ─── Add Event Modal ──────────────────────────────────────────────────────────
function openAddEventModal() {
  const form = document.getElementById('addEventForm');
  form.reset();
  form.elements['org_id'].value = orgId;
  openModal('addEventModal');
}

document.getElementById('saveEventBtn').addEventListener('click', async () => {
  const form = document.getElementById('addEventForm');
  const data = Object.fromEntries(new FormData(form));
  data.org_id = parseInt(data.org_id);
  data.alcohol_present = form.elements['alcohol_present'].checked ? 1 : 0;
  if (data.expected_attendance) data.expected_attendance = parseInt(data.expected_attendance);

  if (!data.name || !data.date) {
    toast('Event name and date are required', 'warning');
    return;
  }

  const btn = document.getElementById('saveEventBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    await api('POST', '/events', data);
    closeModal('addEventModal');
    toast('Event submitted for approval');
    await loadChapter();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit for Approval';
  }
});

// ─── Compliance Reset ─────────────────────────────────────────────────────────
function openResetChapterModal() {
  document.getElementById('resetChapterInput').value = '';
  openModal('resetChapterModal');
}

document.getElementById('confirmChapterResetBtn').addEventListener('click', async () => {
  if (document.getElementById('resetChapterInput').value !== 'RESET') {
    toast('Type RESET to confirm', 'warning');
    return;
  }
  const btn = document.getElementById('confirmChapterResetBtn');
  btn.disabled = true; btn.textContent = 'Resetting…';
  try {
    const result = await api('POST', '/compliance/reset', { org_id: parseInt(orgId) });
    toast(result.message);
    closeModal('resetChapterModal');
    await loadChapter();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Reset This Chapter';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadChapter();
