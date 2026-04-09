if (!requireAuth()) throw new Error('Not authenticated');

renderSidebar('dashboard');

let allChapters = [];

async function loadStats() {
  try {
    const s = await api('GET', '/organizations/summary');
    document.getElementById('s-total').textContent      = s.total;
    document.getElementById('s-active').textContent     = s.active;
    document.getElementById('s-probation').textContent  = s.probation;
    document.getElementById('s-suspended').textContent  = (s.suspended || 0) + (s.revoked || 0);
    document.getElementById('s-compliance').textContent = (s.complianceRate || 0) + '%';
    document.getElementById('s-incidents').textContent  = s.openIncidents;
    document.getElementById('s-events').textContent     = s.pendingEvents;
  } catch (e) {
    console.error(e);
  }
}

async function loadChapters() {
  try {
    const overview = await api('GET', '/compliance/overview');
    allChapters = overview;
    renderGrid(allChapters);
  } catch (e) {
    document.getElementById('chaptersGrid').innerHTML =
      `<div class="empty-state"><div class="empty-icon">✕</div><div class="empty-text">Failed to load chapters: ${e.message}</div></div>`;
  }
}

function renderGrid(chapters) {
  const grid = document.getElementById('chaptersGrid');
  if (!chapters.length) {
    grid.innerHTML = `<div class="empty-state col-span-3"><div class="empty-icon">🏛</div><div class="empty-text">No chapters found</div></div>`;
    return;
  }

  grid.innerHTML = chapters.map(ch => {
    const pct = ch.compliance_pct || 0;
    const fillClass = barColor(pct);
    const textColor = barTextColor(pct);

    const statusDot = {
      active:    '🟢',
      probation: '🟡',
      suspended: '🔴',
      revoked:   '⚫',
    }[ch.org_status] || '⚪';

    return `
      <div class="chapter-card" onclick="window.location.href='/chapter.html?id=${ch.id}'">
        <div class="chapter-card-header">
          <div>
            <div class="chapter-letters">${ch.chapter_letters}</div>
            <div class="chapter-name">${ch.name}</div>
          </div>
          <div class="chapter-badges">
            ${councilBadge(ch.council)}
            ${orgStatusBadge(ch.org_status)}
          </div>
        </div>
        <div class="chapter-card-body">
          <div class="compliance-bar-wrap">
            <div class="compliance-bar-label">
              <span style="font-weight:600;color:${textColor}">${pct}% Compliant</span>
              <span style="color:var(--text-muted)">${ch.compliant_count}/${ch.total} items</span>
            </div>
            <div class="compliance-bar">
              <div class="compliance-bar-fill ${fillClass}" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="chapter-meta">
            <span>📚 GPA ${ch.gpa ? parseFloat(ch.gpa).toFixed(2) : '—'}</span>
            ${ch.overdue_count > 0 ? `<span style="color:var(--danger)">⚠ ${ch.overdue_count} overdue</span>` : ''}
            ${ch.pending_count > 0 ? `<span style="color:var(--warning)">${ch.pending_count} pending</span>` : ''}
          </div>
        </div>
        <div class="chapter-card-footer">
          <span class="text-sm text-muted">${statusDot} ${ch.org_status}</span>
          <span class="text-sm" style="color:var(--accent);font-weight:600">View Details →</span>
        </div>
      </div>
    `;
  }).join('');
}

function applyFilters() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const council = document.getElementById('councilFilter').value;
  const status  = document.getElementById('statusFilter').value;

  const filtered = allChapters.filter(ch => {
    const matchSearch  = !search  || ch.name.toLowerCase().includes(search) || ch.chapter_letters.toLowerCase().includes(search);
    const matchCouncil = !council || ch.council === council;
    const matchStatus  = !status  || ch.org_status === status;
    return matchSearch && matchCouncil && matchStatus;
  });
  renderGrid(filtered);
}

document.getElementById('searchInput').addEventListener('input', applyFilters);
document.getElementById('councilFilter').addEventListener('change', applyFilters);
document.getElementById('statusFilter').addEventListener('change', applyFilters);

// ─── Add Org Modal ────────────────────────────────────────────────────────────
document.getElementById('addOrgBtn').addEventListener('click', () => {
  const user = getUser();
  if (user.role === 'chapter_officer') {
    toast('Only admins and council officers can add chapters', 'warning');
    return;
  }
  document.getElementById('addOrgForm').reset();
  openModal('addOrgModal');
});

document.getElementById('saveOrgBtn').addEventListener('click', async () => {
  const form = document.getElementById('addOrgForm');
  const data = Object.fromEntries(new FormData(form));
  if (!data.name || !data.chapter_letters || !data.council) {
    toast('Name, letters, and council are required', 'warning');
    return;
  }
  if (data.roster_size) data.roster_size = parseInt(data.roster_size);
  if (data.gpa) data.gpa = parseFloat(data.gpa);

  const btn = document.getElementById('saveOrgBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await api('POST', '/organizations', data);
    closeModal('addOrgModal');
    toast('Chapter added successfully');
    loadStats();
    loadChapters();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Chapter';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadStats();
loadChapters();
