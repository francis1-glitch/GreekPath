if (!requireAuth()) throw new Error('unauthenticated');

let allIncidents = [];
let currentIncidentId = null;
let currentEditTab = 'details';

(async function init() {
  renderSidebar('incidents');
  const user = getUser();

  await loadOrgs();
  await loadIncidents();

  document.getElementById('reportIncidentBtn').onclick = openReportModal;
  document.getElementById('saveReportBtn').onclick     = submitReport;
  document.getElementById('saveEditBtn').onclick       = saveEdit;

  ['searchInput','orgFilter','typeFilter','statusFilter','severityFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', filterIncidents); el.addEventListener('change', filterIncidents); }
  });

  // Hide sanctions/add-sanction for non-officers
  if (user.role === 'chapter_officer') {
    const sec = document.getElementById('addSanctionSection');
    if (sec) sec.style.display = 'none';
  }
})();

async function loadOrgs() {
  const orgs = await api('GET', '/organizations').catch(() => []);
  const options = orgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');
  ['orgFilter','reportOrgSel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.insertAdjacentHTML('beforeend', options);
  });
  // Pre-fill sanction org selector based on current incident (done later)
}

async function loadIncidents() {
  try {
    allIncidents = await api('GET', '/incidents');
    updateStats(allIncidents);
    renderTable(allIncidents);
  } catch (err) {
    document.getElementById('incidentsTbody').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

function updateStats(incidents) {
  document.getElementById('is-open').textContent         = incidents.filter(i => i.status === 'open').length;
  document.getElementById('is-investigating').textContent= incidents.filter(i => i.status === 'investigating').length;
  document.getElementById('is-resolved').textContent     = incidents.filter(i => i.status === 'resolved').length;
  document.getElementById('is-critical').textContent     = incidents.filter(i => i.severity === 'critical').length;
}

function renderTable(incidents) {
  const user = getUser();
  const canManage = user.role === 'admin' || user.role === 'council_officer';
  const tbody = document.getElementById('incidentsTbody');
  if (!incidents.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No incidents found</td></tr>`;
    return;
  }
  tbody.innerHTML = incidents.map(inc => `
    <tr>
      <td style="white-space:nowrap;font-size:.85rem">${fmtDate(inc.reported_date)}</td>
      <td>
        <a href="/chapter.html?id=${inc.org_id}" class="td-link">${inc.chapter_letters}</a>
        <div style="font-size:.72rem;color:var(--text-muted)">${inc.council}</div>
      </td>
      <td style="text-transform:capitalize">${inc.type.replace(/_/g,' ')}</td>
      <td>${severityBadge(inc.severity)}</td>
      <td>${statusBadge(inc.status)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${inc.description}">${inc.description}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="openEdit(${inc.id})">
            ${canManage ? 'Edit' : 'View'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterIncidents() {
  const q      = document.getElementById('searchInput').value.toLowerCase();
  const org    = document.getElementById('orgFilter').value;
  const type   = document.getElementById('typeFilter').value;
  const status = document.getElementById('statusFilter').value;
  const sev    = document.getElementById('severityFilter').value;
  const filtered = allIncidents.filter(inc =>
    (!q      || inc.description.toLowerCase().includes(q) || (inc.org_name||'').toLowerCase().includes(q))
    && (!org    || String(inc.org_id) === org)
    && (!type   || inc.type === type)
    && (!status || inc.status === status)
    && (!sev    || inc.severity === sev)
  );
  updateStats(filtered);
  renderTable(filtered);
}

// ─── Report ──────────────────────────────────────────────────────────────────
function openReportModal() {
  document.getElementById('reportForm').reset();
  openModal('reportModal');
}

async function submitReport() {
  const form = document.getElementById('reportForm');
  const fd = Object.fromEntries(new FormData(form));
  if (!fd.org_id || !fd.type || !fd.severity || !fd.description) {
    toast('All fields are required', 'warning'); return;
  }
  const btn = document.getElementById('saveReportBtn');
  btn.disabled = true; btn.textContent = 'Reporting…';
  try {
    await api('POST', '/incidents', fd);
    toast('Incident reported');
    closeModal('reportModal');
    loadIncidents();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Report Incident';
  }
}

// ─── Edit / view incident ────────────────────────────────────────────────────
async function openEdit(id) {
  currentIncidentId = id;
  const inc = allIncidents.find(i => i.id === id);
  if (!inc) return;

  document.getElementById('editModalTitle').textContent =
    `${inc.chapter_letters}: ${inc.type.replace(/_/g,' ')} — ${fmtDate(inc.reported_date)}`;

  // Fill form
  const form = document.getElementById('editForm');
  form.querySelector('[name="id"]').value           = inc.id;
  form.querySelector('[name="type"]').value         = inc.type;
  form.querySelector('[name="severity"]').value     = inc.severity;
  form.querySelector('[name="status"]').value       = inc.status;
  form.querySelector('[name="description"]').value  = inc.description || '';
  form.querySelector('[name="resolution"]').value   = inc.resolution  || '';
  form.querySelector('[name="resolved_date"]').value = inc.resolved_date ? inc.resolved_date.split('T')[0] : '';

  // Set sanction org
  document.getElementById('sancOrgId').value = inc.org_id;

  switchEditTab('details');
  openModal('editModal');
}

function switchEditTab(tab) {
  currentEditTab = tab;
  ['details','timeline','sanctions'].forEach(t => {
    document.getElementById('editTab' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = t === tab ? 'block' : 'none';
    document.getElementById('etab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  const footer = document.getElementById('editModalFooter');
  footer.style.display = tab === 'details' ? 'flex' : 'none';
  if (tab === 'timeline')  loadTimeline();
  if (tab === 'sanctions') loadSanctions();
}

async function saveEdit() {
  const user = getUser();
  if (user.role !== 'admin' && user.role !== 'council_officer') {
    toast('Insufficient permissions', 'error'); return;
  }
  const form = document.getElementById('editForm');
  const fd   = Object.fromEntries(new FormData(form));
  const id   = fd.id;
  const btn  = document.getElementById('saveEditBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('PUT', `/incidents/${id}`, {
      type: fd.type, description: fd.description, status: fd.status,
      severity: fd.severity, resolution: fd.resolution || null,
      resolved_date: fd.resolved_date || null,
    });
    toast('Incident updated');
    closeModal('editModal');
    loadIncidents();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

// ─── Timeline ────────────────────────────────────────────────────────────────
async function loadTimeline() {
  const container = document.getElementById('timelineList');
  container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Loading…</div>';
  try {
    const entries = await api('GET', `/incidents/${currentIncidentId}/timeline`);
    if (!entries.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">No timeline entries yet.</div>';
      return;
    }
    container.innerHTML = `<div class="timeline">` +
      entries.map((e, idx) => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-action">${e.action_taken}</span>
              <span class="timeline-meta">${e.author_name} · ${fmtDate(e.entry_date)}</span>
            </div>
            ${e.notes ? `<div class="timeline-notes">${e.notes}</div>` : ''}
          </div>
        </div>
      `).join('') + '</div>';
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);font-size:.85rem">${err.message}</div>`;
  }
}

async function addTimelineEntry() {
  const action = document.getElementById('tlAction').value.trim();
  const notes  = document.getElementById('tlNotes').value.trim();
  if (!action) { toast('Action taken is required', 'warning'); return; }
  try {
    await api('POST', `/incidents/${currentIncidentId}/timeline`, { action_taken: action, notes: notes || null });
    document.getElementById('tlAction').value = '';
    document.getElementById('tlNotes').value  = '';
    toast('Entry added');
    loadTimeline();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── Sanctions ───────────────────────────────────────────────────────────────
async function loadSanctions() {
  const container = document.getElementById('sanctionsList');
  container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Loading…</div>';
  try {
    const sanctions = await api('GET', `/incidents/${currentIncidentId}/sanctions`);
    if (!sanctions.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">No sanctions recorded.</div>';
      return;
    }
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${sanctions.map(s => `
          <div class="card" style="padding:14px;border-left:3px solid ${sanctionColor(s.sanction_type)}">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div>
                <span class="badge" style="background:${sanctionColor(s.sanction_type)}22;color:${sanctionColor(s.sanction_type)};text-transform:capitalize">${s.sanction_type}</span>
                <span class="badge badge-${s.status}" style="margin-left:4px">${s.status}</span>
              </div>
              <span style="font-size:.75rem;color:var(--text-muted)">${fmtDate(s.start_date)}${s.end_date ? ' – ' + fmtDate(s.end_date) : ''}</span>
            </div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-top:6px">
              Chapter: ${s.org_name} · Added by ${s.created_by_name || '—'}
            </div>
            ${s.conditions ? `<div style="font-size:.82rem;margin-top:6px">${s.conditions}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);font-size:.85rem">${err.message}</div>`;
  }
}

async function addSanction() {
  const user = getUser();
  if (user.role === 'chapter_officer') { toast('Insufficient permissions', 'error'); return; }
  const sanc_type   = document.getElementById('sancType').value;
  const start_date  = document.getElementById('sancStart').value;
  const end_date    = document.getElementById('sancEnd').value;
  const conditions  = document.getElementById('sancConditions').value;
  const status      = document.getElementById('sancStatus').value;
  const org_id      = document.getElementById('sancOrgId').value;

  if (!start_date) { toast('Start date is required', 'warning'); return; }
  if (!org_id)     { toast('Organization not found', 'error'); return; }

  try {
    await api('POST', `/incidents/${currentIncidentId}/sanctions`, {
      org_id, sanction_type: sanc_type, start_date,
      end_date: end_date || null, conditions: conditions || null, status,
    });
    toast('Sanction added');
    document.getElementById('sancStart').value = '';
    document.getElementById('sancEnd').value   = '';
    document.getElementById('sancConditions').value = '';
    loadSanctions();
    // Reload incidents to reflect potential org status change
    loadIncidents();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function sanctionColor(type) {
  return { warning:'#f59e0b', probation:'#f97316', suspension:'#ef4444', revocation:'#7f1d1d' }[type] || '#64748b';
}
