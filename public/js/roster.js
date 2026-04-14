if (!requireAuth()) throw new Error('unauthenticated');

let allOrgs = [];
let allMembers = [];
let selectedOrgId = null;
let pendingImportData = null;

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  renderSidebar('roster');
  await loadOrgs();

  // Wire buttons
  document.getElementById('addMemberBtn').onclick = openAddMember;
  document.getElementById('exportBtn').onclick   = exportRoster;
  document.getElementById('uploadBtn').onclick   = () => { resetUpload(); openModal('uploadModal'); };
  document.getElementById('historyBtn').onclick  = loadHistory;
  document.getElementById('saveMemberBtn').onclick = saveMember;
  document.getElementById('confirmImportBtn').onclick = confirmImport;

  // Filters
  document.getElementById('chapterSel').addEventListener('change', e => {
    selectedOrgId = e.target.value;
    loadMembers();
  });
  document.getElementById('searchInput').addEventListener('input', filterMembers);
  document.getElementById('statusFilter').addEventListener('change', filterMembers);
  document.getElementById('roleFilter').addEventListener('change', filterMembers);

  // File upload
  const fileInput = document.getElementById('rosterFileInput');
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileUpload(fileInput.files[0]); });

  // Drag & drop
  const zone = document.getElementById('dropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFileUpload(f);
  });
})();

// ─── Load organizations ───────────────────────────────────────────────────────
async function loadOrgs() {
  try {
    allOrgs = await api('GET', '/organizations');
    const user = getUser();
    const sel = document.getElementById('chapterSel');
    sel.innerHTML = '<option value="">— Select a chapter —</option>' +
      allOrgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');

    // Auto-select from URL param, chapter_officer linked org, or first org
    const urlOrgId = new URLSearchParams(location.search).get('org_id');
    const autoId = urlOrgId || (user.role === 'chapter_officer' ? user.org_id : null);
    if (autoId) {
      sel.value = autoId;
      selectedOrgId = autoId;
      loadMembers();
    }
  } catch (err) {
    toast('Failed to load organizations', 'error');
  }
}

// ─── Load members ─────────────────────────────────────────────────────────────
async function loadMembers() {
  if (!selectedOrgId) return;
  document.getElementById('membersTbody').innerHTML =
    `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-muted)"><div class="spinner" style="border-color:var(--border);border-top-color:var(--accent);display:inline-block;vertical-align:middle;margin-right:8px"></div> Loading…</td></tr>`;
  try {
    allMembers = await api('GET', `/roster?org_id=${selectedOrgId}`);
    updateStats();
    renderMembers(allMembers);
  } catch (err) {
    toast('Failed to load members', 'error');
  }
}

function updateStats() {
  const active  = allMembers.filter(m => m.status === 'active').length;
  const alumni  = allMembers.filter(m => m.status === 'alumni').length;
  const pledge  = allMembers.filter(m => m.pledge_class && m.status === 'active').length;
  const gpas    = allMembers.filter(m => m.gpa && m.status === 'active').map(m => parseFloat(m.gpa));
  const avgGpa  = gpas.length ? (gpas.reduce((a,b)=>a+b,0)/gpas.length).toFixed(2) : '—';
  document.getElementById('rs-active').textContent = active;
  document.getElementById('rs-alumni').textContent = alumni;
  document.getElementById('rs-pledge').textContent = pledge;
  document.getElementById('rs-gpa').textContent    = avgGpa;
}

function renderMembers(members) {
  const tbody = document.getElementById('membersTbody');
  if (!members.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">No members found. Import a roster or add members manually.</td></tr>`;
    return;
  }
  const user = getUser();
  const canEdit = user.role === 'admin' || user.role === 'council_officer' || user.role === 'chapter_officer';
  tbody.innerHTML = members.map(m => `
    <tr>
      <td style="font-weight:500">${m.first_name} ${m.last_name}</td>
      <td style="font-size:.8rem">${m.email || '—'}</td>
      <td style="font-size:.8rem">${m.student_id || '—'}</td>
      <td style="font-size:.8rem">${m.pledge_class || '—'}</td>
      <td>${m.graduation_year || '—'}</td>
      <td style="font-size:.8rem">${m.major || '—'}</td>
      <td>${m.gpa != null ? parseFloat(m.gpa).toFixed(2) : '—'}</td>
      <td>${memberStatusBadge(m.status)}</td>
      <td>${memberRoleBadge(m.role)}</td>
      <td>
        ${canEdit ? `
          <button class="btn btn-ghost btn-sm" onclick="openEditMember(${m.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteMember(${m.id})">Delete</button>
        ` : '—'}
      </td>
    </tr>
  `).join('');
}

function filterMembers() {
  const q      = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const role   = document.getElementById('roleFilter').value;
  const filtered = allMembers.filter(m => {
    const name = `${m.first_name} ${m.last_name} ${m.email||''} ${m.student_id||''}`.toLowerCase();
    return (!q || name.includes(q))
      && (!status || m.status === status)
      && (!role   || m.role === role);
  });
  renderMembers(filtered);
}

function memberStatusBadge(s) {
  const cls = { active:'green', inactive:'', alumni:'blue', suspended:'red' }[s] || '';
  return `<span class="badge ${cls ? 'badge-'+cls : ''}">${s}</span>`;
}

function memberRoleBadge(r) {
  const cls = { president:'navy', vp:'navy', treasurer:'blue', secretary:'blue', officer:'blue', member:'' }[r] || '';
  return `<span class="badge ${cls ? 'badge-'+cls : ''}" style="font-size:.7rem">${r}</span>`;
}

// ─── Add / Edit member ───────────────────────────────────────────────────────
function openAddMember() {
  if (!selectedOrgId) { toast('Select a chapter first', 'warning'); return; }
  document.getElementById('memberModalTitle').textContent = 'Add Member';
  document.getElementById('memberForm').reset();
  document.querySelector('#memberForm [name="id"]').value = '';
  openModal('memberModal');
}

async function openEditMember(id) {
  try {
    const m = await api('GET', `/roster/${id}`);
    const form = document.getElementById('memberForm');
    document.getElementById('memberModalTitle').textContent = 'Edit Member';
    form.querySelector('[name="id"]').value = m.id;
    form.querySelector('[name="first_name"]').value = m.first_name || '';
    form.querySelector('[name="last_name"]').value  = m.last_name  || '';
    form.querySelector('[name="email"]').value       = m.email       || '';
    form.querySelector('[name="student_id"]').value  = m.student_id  || '';
    form.querySelector('[name="pledge_class"]').value= m.pledge_class || '';
    form.querySelector('[name="graduation_year"]').value = m.graduation_year || '';
    form.querySelector('[name="major"]').value       = m.major       || '';
    form.querySelector('[name="gpa"]').value         = m.gpa != null ? m.gpa : '';
    form.querySelector('[name="status"]').value      = m.status || 'active';
    form.querySelector('[name="role"]').value        = m.role   || 'member';
    form.querySelector('[name="joined_date"]').value = m.joined_date ? m.joined_date.split('T')[0] : '';
    openModal('memberModal');
  } catch (err) {
    toast('Failed to load member', 'error');
  }
}

async function saveMember() {
  const form = document.getElementById('memberForm');
  const fd = Object.fromEntries(new FormData(form));
  const isEdit = !!fd.id;

  const payload = {
    org_id:          selectedOrgId,
    first_name:      fd.first_name.trim(),
    last_name:       fd.last_name.trim(),
    email:           fd.email || null,
    student_id:      fd.student_id || null,
    pledge_class:    fd.pledge_class || null,
    graduation_year: fd.graduation_year ? parseInt(fd.graduation_year, 10) : null,
    major:           fd.major || null,
    gpa:             fd.gpa !== '' ? parseFloat(fd.gpa) : null,
    status:          fd.status,
    role:            fd.role,
    joined_date:     fd.joined_date || null,
  };

  try {
    if (isEdit) {
      await api('PUT', `/roster/${fd.id}`, payload);
      toast('Member updated');
    } else {
      await api('POST', '/roster', payload);
      toast('Member added');
    }
    closeModal('memberModal');
    loadMembers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteMember(id) {
  if (!confirm('Delete this member?')) return;
  try {
    await api('DELETE', `/roster/${id}`);
    toast('Member removed');
    loadMembers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── File upload & preview ───────────────────────────────────────────────────
async function handleFileUpload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls','csv'].includes(ext)) {
    showUploadError('Only .xlsx, .xls, and .csv files are supported.');
    return;
  }
  showUploadError('');
  document.getElementById('dropZone').innerHTML = `<div class="spinner" style="display:inline-block"></div> Parsing file…`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = getToken();
    const res = await fetch('/api/roster/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    pendingImportData = data;
    showPreview(data);
  } catch (err) {
    resetUpload();
    showUploadError(err.message);
  }
}

function showUploadError(msg) {
  const el = document.getElementById('uploadError');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function showPreview(data) {
  document.getElementById('uploadStep1').style.display = 'none';
  document.getElementById('uploadStep2').style.display = 'block';
  document.getElementById('confirmImportBtn').style.display = 'inline-flex';

  document.getElementById('previewCount').textContent = `${data.total} rows detected`;
  document.getElementById('previewTotalCount').textContent = data.total;

  const mappedFields = Object.keys(data.columnMap);
  document.getElementById('previewNote').textContent =
    `Auto-mapped: ${mappedFields.join(', ')}`;

  const DISPLAY_COLS = ['first_name','last_name','email','student_id','pledge_class','graduation_year','major','gpa','status','role'];
  const headers = DISPLAY_COLS.filter(c => data.columnMap[c] !== undefined || data.columnMap[c] === 0);

  document.getElementById('previewHead').innerHTML =
    `<tr>${headers.map(h => `<th>${h.replace('_',' ')}</th>`).join('')}</tr>`;

  document.getElementById('previewBody').innerHTML = data.preview.map(row => `
    <tr>${headers.map(h => `<td>${row[h] != null ? row[h] : '—'}</td>`).join('')}</tr>
  `).join('');
}

function resetUpload() {
  pendingImportData = null;
  document.getElementById('uploadStep1').style.display = 'block';
  document.getElementById('uploadStep2').style.display = 'none';
  document.getElementById('confirmImportBtn').style.display = 'none';
  document.getElementById('dropZone').innerHTML = `
    <div style="font-size:2rem">📂</div>
    <div style="font-weight:600;margin:8px 0">Drag & drop your roster file here</div>
    <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:16px">Supports .xlsx, .xls, .csv — max 10 MB</div>
    <button class="btn btn-outline btn-sm" onclick="document.getElementById('rosterFileInput').click()">Choose File</button>
    <input type="file" id="rosterFileInput" accept=".xlsx,.xls,.csv" style="display:none">
  `;
  // Rebind input
  document.getElementById('rosterFileInput').addEventListener('change', function() {
    if (this.files[0]) handleFileUpload(this.files[0]);
  });
  showUploadError('');
}

async function confirmImport() {
  if (!pendingImportData || !selectedOrgId) return;
  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const result = await api('POST', '/roster/import', {
      org_id: selectedOrgId,
      members: pendingImportData.rows,
      semester: document.getElementById('importSemester').value,
      year: parseInt(document.getElementById('importYear').value, 10),
      replace_existing: document.getElementById('replaceExisting').checked,
    });
    closeModal('uploadModal');
    toast(`✓ Imported ${result.imported} members. Avg GPA: ${result.avg_gpa || '—'}`);
    loadMembers();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Confirm Import';
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────
function exportRoster() {
  if (!selectedOrgId) { toast('Select a chapter first', 'warning'); return; }
  window.location.href = `/api/roster/export?org_id=${selectedOrgId}`;
}

// ─── History ─────────────────────────────────────────────────────────────────
async function loadHistory() {
  if (!selectedOrgId) { toast('Select a chapter first', 'warning'); return; }
  openModal('historyModal');
  const list = document.getElementById('historyList');
  list.innerHTML = '<div style="padding:20px;text-align:center">Loading…</div>';
  try {
    const snapshots = await api('GET', `/roster/history/${selectedOrgId}`);
    if (!snapshots.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No history available. Import rosters with a semester/year to create snapshots.</div>';
      return;
    }
    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Semester</th><th>Year</th><th>Total</th><th>Active</th><th>Avg GPA</th><th>Snapshot Date</th></tr></thead>
          <tbody>
            ${snapshots.map(s => `
              <tr>
                <td>${s.semester}</td>
                <td>${s.year}</td>
                <td>${s.member_count || '—'}</td>
                <td>${s.active_count || '—'}</td>
                <td>${s.avg_gpa ? parseFloat(s.avg_gpa).toFixed(2) : '—'}</td>
                <td style="font-size:.8rem">${fmtDate(s.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    list.innerHTML = `<div style="padding:20px;color:var(--danger)">${err.message}</div>`;
  }
}
