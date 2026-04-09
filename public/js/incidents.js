if (!requireAuth()) throw new Error('Not authenticated');
renderSidebar('incidents');

const user = getUser();
const canManage = user.role === 'admin' || user.role === 'council_officer';

let allIncidents = [];
let allOrgs = [];

async function loadOrgs() {
  allOrgs = await api('GET', '/organizations');

  // Populate org filters
  const html = allOrgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');
  document.getElementById('orgFilter').insertAdjacentHTML('beforeend', html);
  document.getElementById('reportOrgSel').insertAdjacentHTML('beforeend', html);
}

async function loadIncidents() {
  try {
    allIncidents = await api('GET', '/incidents');
    updateStats();
    renderTable(allIncidents);
  } catch (e) {
    document.getElementById('incidentsTbody').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--danger)">${e.message}</td></tr>`;
  }
}

function updateStats() {
  document.getElementById('is-open').textContent        = allIncidents.filter(i => i.status === 'open').length;
  document.getElementById('is-investigating').textContent = allIncidents.filter(i => i.status === 'investigating').length;
  document.getElementById('is-resolved').textContent    = allIncidents.filter(i => i.status === 'resolved').length;
  document.getElementById('is-critical').textContent    = allIncidents.filter(i => i.severity === 'critical').length;
}

function renderTable(incidents) {
  const tbody = document.getElementById('incidentsTbody');
  if (!incidents.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No incidents found</td></tr>`;
    return;
  }

  tbody.innerHTML = incidents.map(i => `
    <tr>
      <td style="white-space:nowrap">${fmtDate(i.reported_date)}</td>
      <td>
        <a href="/chapter.html?id=${i.org_id}" class="td-link">${i.chapter_letters}</a>
        <div style="font-size:.72rem;color:var(--text-muted)">${i.council}</div>
      </td>
      <td style="text-transform:capitalize">${i.type.replace(/_/g,' ')}</td>
      <td>
        <span style="display:flex;align-items:center;gap:5px">
          <span class="sev-dot sev-${i.severity}"></span>
          ${severityBadge(i.severity)}
        </span>
      </td>
      <td>${statusBadge(i.status)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${i.description}">${i.description}</td>
      <td>
        <div style="display:flex;gap:6px">
          ${canManage ? `<button class="btn btn-ghost btn-sm" onclick="openEdit(${i.id})">Edit</button>` : ''}
          <a href="/chapter.html?id=${i.org_id}" class="btn btn-ghost btn-sm">Chapter</a>
        </div>
      </td>
    </tr>
  `).join('');
}

function applyFilters() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const orgId    = document.getElementById('orgFilter').value;
  const type     = document.getElementById('typeFilter').value;
  const status   = document.getElementById('statusFilter').value;
  const severity = document.getElementById('severityFilter').value;

  renderTable(allIncidents.filter(i => {
    return (!search   || i.description.toLowerCase().includes(search) || i.org_name.toLowerCase().includes(search))
        && (!orgId    || i.org_id == orgId)
        && (!type     || i.type === type)
        && (!status   || i.status === status)
        && (!severity || i.severity === severity);
  }));
}

['searchInput','orgFilter','typeFilter','statusFilter','severityFilter'].forEach(id => {
  document.getElementById(id).addEventListener('input', applyFilters);
  document.getElementById(id).addEventListener('change', applyFilters);
});

// ─── Report Incident ──────────────────────────────────────────────────────────
document.getElementById('reportIncidentBtn').addEventListener('click', () => {
  document.getElementById('reportForm').reset();
  openModal('reportModal');
});

document.getElementById('saveReportBtn').addEventListener('click', async () => {
  const form = document.getElementById('reportForm');
  const data = Object.fromEntries(new FormData(form));
  data.org_id = parseInt(data.org_id);

  if (!data.org_id || !data.type || !data.severity || !data.description) {
    toast('All fields are required', 'warning');
    return;
  }

  const btn = document.getElementById('saveReportBtn');
  btn.disabled = true; btn.textContent = 'Reporting…';

  try {
    await api('POST', '/incidents', data);
    closeModal('reportModal');
    toast('Incident reported');
    await loadIncidents();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Report Incident';
  }
});

// ─── Edit Incident ────────────────────────────────────────────────────────────
async function openEdit(id) {
  const inc = allIncidents.find(i => i.id === id);
  if (!inc) return;

  const form = document.getElementById('editForm');
  const fields = ['id','type','severity','status','description','resolution','resolved_date'];
  for (const f of fields) {
    const el = form.elements[f];
    if (el) el.value = inc[f] !== null && inc[f] !== undefined ? inc[f] : '';
  }
  openModal('editModal');
}

document.getElementById('saveEditBtn').addEventListener('click', async () => {
  if (!canManage) { toast('Insufficient permissions', 'error'); return; }

  const form = document.getElementById('editForm');
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;

  const btn = document.getElementById('saveEditBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    await api('PUT', `/incidents/${id}`, data);
    closeModal('editModal');
    toast('Incident updated');
    await loadIncidents();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadOrgs().then(loadIncidents);
