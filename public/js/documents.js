if (!requireAuth()) throw new Error('unauthenticated');

let allDocs = [];
let allOrgs = [];
let allReqs = [];
let selectedDocFile = null;

(async function init() {
  renderSidebar('documents');
  await Promise.all([loadOrgs(), loadReqs()]);
  await loadDocs();

  document.getElementById('uploadDocBtn').onclick = openUploadModal;
  document.getElementById('saveDocBtn').onclick = uploadDocument;
  document.getElementById('saveReviewBtn').onclick = submitReview;

  document.getElementById('searchInput').addEventListener('input', filterDocs);
  document.getElementById('orgFilter').addEventListener('change', filterDocs);
  document.getElementById('statusFilter').addEventListener('change', filterDocs);
  document.getElementById('reqFilter').addEventListener('change', filterDocs);

  // File input
  document.getElementById('docFileInput').addEventListener('change', function() {
    if (this.files[0]) selectDocFile(this.files[0]);
  });

  // Drop zone
  const zone = document.getElementById('docDropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) selectDocFile(e.dataTransfer.files[0]);
  });
})();

async function loadOrgs() {
  try {
    allOrgs = await api('GET', '/organizations');
    const populate = id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = (id === 'orgFilter' ? '<option value="">All Chapters</option>' : '<option value="">Select chapter…</option>') +
        allOrgs.map(o => `<option value="${o.id}">${o.chapter_letters} — ${o.name}</option>`).join('');
    };
    populate('orgFilter');
    populate('uploadOrgSel');
  } catch (_) {}
}

async function loadReqs() {
  try {
    allReqs = await api('GET', '/compliance/requirements');
    const populateReq = id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const base = id === 'reqFilter' ? '<option value="">All Requirements</option>' : '<option value="">Not linked to a requirement</option>';
      sel.innerHTML = base + allReqs.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    };
    populateReq('reqFilter');
    populateReq('uploadReqSel');
  } catch (_) {}
}

async function loadDocs() {
  try {
    allDocs = await api('GET', '/documents');
    updateStats();
    // Auto-filter by org_id from URL if present
    const urlOrgId = new URLSearchParams(location.search).get('org_id');
    if (urlOrgId) {
      document.getElementById('orgFilter').value = urlOrgId;
    }
    renderDocs(urlOrgId ? allDocs.filter(d => String(d.org_id) === urlOrgId) : allDocs);
  } catch (err) {
    toast('Failed to load documents', 'error');
  }
}

function updateStats() {
  document.getElementById('ds-pending').textContent  = allDocs.filter(d => d.status === 'pending_review').length;
  document.getElementById('ds-approved').textContent = allDocs.filter(d => d.status === 'approved').length;
  document.getElementById('ds-rejected').textContent = allDocs.filter(d => d.status === 'rejected').length;
  document.getElementById('ds-total').textContent    = allDocs.length;
}

function renderDocs(docs) {
  const user = getUser();
  const canReview = user.role === 'admin' || user.role === 'council_officer';
  const tbody = document.getElementById('docsTbody');
  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No documents found.</td></tr>`;
    return;
  }
  tbody.innerHTML = docs.map(d => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.1rem">${fileIcon(d.file_type)}</span>
          <div>
            <div style="font-weight:500;font-size:.875rem">${d.original_name}</div>
            ${d.description ? `<div style="font-size:.75rem;color:var(--text-muted)">${d.description}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="font-size:.85rem">${d.org_name} ${d.chapter_letters ? `<span style="color:var(--text-muted)">(${d.chapter_letters})</span>` : ''}</td>
      <td style="font-size:.8rem">${d.requirement_name || '—'}</td>
      <td style="font-size:.8rem">${d.uploaded_by_name || '—'}</td>
      <td style="font-size:.8rem">${fmtDate(d.uploaded_at)}</td>
      <td>${docStatusBadge(d.status)}</td>
      <td style="font-size:.8rem">${d.reviewed_by_name || '—'}</td>
      <td>
        <a href="/api/documents/${d.id}/download" class="btn btn-ghost btn-sm" target="_blank">⬇</a>
        ${canReview ? `<button class="btn btn-ghost btn-sm" onclick="openReview(${d.id})">Review</button>` : ''}
        ${user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteDoc(${d.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function filterDocs() {
  const q      = document.getElementById('searchInput').value.toLowerCase();
  const org    = document.getElementById('orgFilter').value;
  const status = document.getElementById('statusFilter').value;
  const req    = document.getElementById('reqFilter').value;
  const filtered = allDocs.filter(d => {
    const text = `${d.original_name} ${d.org_name} ${d.requirement_name||''}`.toLowerCase();
    return (!q || text.includes(q))
      && (!org    || String(d.org_id) === org)
      && (!status || d.status === status)
      && (!req    || String(d.requirement_id) === req);
  });
  renderDocs(filtered);
}

function docStatusBadge(s) {
  const map = { pending_review:'amber', approved:'green', rejected:'red' };
  const label = s.replace('_', ' ');
  return `<span class="badge badge-${map[s]||''}">${label}</span>`;
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('docx')) return '📘';
  if (mime.includes('image')) return '🖼';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📗';
  return '📄';
}

// ─── Upload ──────────────────────────────────────────────────────────────────
function openUploadModal() {
  selectedDocFile = null;
  document.getElementById('docUploadError').style.display = 'none';
  document.getElementById('docSelectedFile').style.display = 'none';
  // Pre-select org from URL or current filter
  const urlOrgId = new URLSearchParams(location.search).get('org_id');
  const filtOrgId = document.getElementById('orgFilter').value;
  const preselect = urlOrgId || filtOrgId;
  if (preselect) document.getElementById('uploadOrgSel').value = preselect;
  openModal('uploadModal');
}

function selectDocFile(file) {
  selectedDocFile = file;
  const el = document.getElementById('docSelectedFile');
  el.style.cssText = 'display:flex;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin-top:10px;font-size:.85rem;gap:8px;align-items:center';
  el.innerHTML = `${fileIcon(file.type)} <span><strong>${file.name}</strong> (${(file.size/1024/1024).toFixed(2)} MB)</span>`;
}

async function uploadDocument() {
  const orgId = document.getElementById('uploadOrgSel').value;
  if (!orgId) { toast('Select a chapter', 'warning'); return; }
  if (!selectedDocFile) { toast('Choose a file to upload', 'warning'); return; }

  const btn = document.getElementById('saveDocBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  const formData = new FormData();
  formData.append('file', selectedDocFile);
  formData.append('org_id', orgId);
  const reqId = document.getElementById('uploadReqSel').value;
  if (reqId) formData.append('requirement_id', reqId);
  const desc = document.getElementById('uploadDesc').value;
  if (desc) formData.append('description', desc);

  try {
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    toast('Document uploaded successfully');
    closeModal('uploadModal');
    loadDocs();
  } catch (err) {
    document.getElementById('docUploadError').textContent = err.message;
    document.getElementById('docUploadError').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Document';
  }
}

// ─── Review ──────────────────────────────────────────────────────────────────
async function openReview(id) {
  try {
    const doc = await api('GET', `/documents/${id}`);
    document.getElementById('reviewDocId').value = doc.id;
    document.getElementById('reviewDecision').value = doc.status === 'approved' ? 'approved' : doc.status === 'rejected' ? 'rejected' : 'pending_review';
    document.getElementById('reviewNotes').value = doc.review_notes || '';
    document.getElementById('reviewDocDetails').innerHTML = `
      <div><strong>File:</strong> ${doc.original_name}</div>
      <div><strong>Chapter:</strong> ${doc.org_name}</div>
      ${doc.requirement_name ? `<div><strong>Requirement:</strong> ${doc.requirement_name}</div>` : ''}
      <div><strong>Uploaded by:</strong> ${doc.uploaded_by_name} on ${fmtDate(doc.uploaded_at)}</div>
      ${doc.description ? `<div><strong>Notes:</strong> ${doc.description}</div>` : ''}
    `;
    openModal('reviewModal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitReview() {
  const id     = document.getElementById('reviewDocId').value;
  const status = document.getElementById('reviewDecision').value;
  const notes  = document.getElementById('reviewNotes').value;
  try {
    await api('PUT', `/documents/${id}/review`, { status, review_notes: notes });
    toast(`Document ${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'returned to pending'}`);
    closeModal('reviewModal');
    loadDocs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return;
  try {
    await api('DELETE', `/documents/${id}`);
    toast('Document deleted');
    loadDocs();
  } catch (err) {
    toast(err.message, 'error');
  }
}
