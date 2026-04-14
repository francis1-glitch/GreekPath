if (!requireAuth()) throw new Error('unauthenticated');

let gpaThreshold = 2.5;
const CHART_COLORS = {
  navy:  '#1e3a5f',
  blue:  '#4a8fe8',
  green: '#22c55e',
  amber: '#f59e0b',
  red:   '#ef4444',
  IFC:   '#4a8fe8',
  PHC:   '#ec4899',
  MGC:   '#8b5cf6',
  NPHC:  '#22c55e',
};

(async function init() {
  renderSidebar('analytics');
  const user = getUser();

  document.getElementById('gpaSettingsBtn').style.display =
    user.role === 'admin' ? 'inline-flex' : 'none';
  document.getElementById('resetBtn').style.display =
    user.role === 'admin' ? 'inline-flex' : 'none';

  document.getElementById('gpaSettingsBtn').onclick = openGpaSettings;
  document.getElementById('saveGpaBtn').onclick     = saveGpaSettings;
  document.getElementById('confirmResetBtn').onclick = confirmReset;

  await Promise.all([
    loadSummary(),
    loadComplianceChart(),
    loadIncidentCharts(),
    loadGpaData(),
    loadRiskScores(),
  ]);
})();

async function loadSummary() {
  try {
    const s = await api('GET', '/analytics/summary');
    document.getElementById('an-total').textContent      = s.total ?? '—';
    document.getElementById('an-active').textContent     = s.active ?? '—';
    document.getElementById('an-compliance').textContent = s.compliance_rate != null ? s.compliance_rate + '%' : '—';
    document.getElementById('an-pending').textContent    = s.pending_reviews ?? '—';
    document.getElementById('an-incidents').textContent  = s.open_incidents ?? '—';
    document.getElementById('an-gpa').textContent        = s.overall_gpa != null ? parseFloat(s.overall_gpa).toFixed(2) : '—';
  } catch (_) {}
}

async function loadComplianceChart() {
  try {
    const rows = await api('GET', '/analytics/compliance-by-council');
    const ctx = document.getElementById('complianceChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.council),
        datasets: [{
          label: 'Compliance Rate (%)',
          data: rows.map(r => parseFloat(r.rate) || 0),
          backgroundColor: rows.map(r => CHART_COLORS[r.council] || CHART_COLORS.blue),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true, max: 100,
            ticks: { callback: v => v + '%' },
            grid: { color: '#f0f4f8' },
          },
          x: { grid: { display: false } },
        },
      },
    });
  } catch (_) {}
}

async function loadIncidentCharts() {
  try {
    const data = await api('GET', '/analytics/incident-frequency');

    // Monthly frequency chart
    const ctx1 = document.getElementById('incidentChart').getContext('2d');
    const months = data.monthly.map(r => r.month);
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Total',
            data: data.monthly.map(r => r.total),
            backgroundColor: CHART_COLORS.blue + 'cc',
            borderRadius: 4,
          },
          {
            label: 'Critical',
            data: data.monthly.map(r => r.critical),
            backgroundColor: CHART_COLORS.red + 'cc',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#f0f4f8' } },
          x: { grid: { display: false } },
        },
      },
    });

    // Type donut chart
    const ctx2 = document.getElementById('typeChart').getContext('2d');
    const typeColors = [CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.navy, CHART_COLORS.blue];
    new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: data.by_type.map(r => r.type.replace('_',' ')),
        datasets: [{
          data: data.by_type.map(r => r.count),
          backgroundColor: typeColors.slice(0, data.by_type.length),
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 16 } },
        },
      },
    });
  } catch (_) {}
}

async function loadGpaData() {
  try {
    const [data, thresholds] = await Promise.all([
      api('GET', '/analytics/gpa-trends'),
      api('GET', '/analytics/gpa-thresholds'),
    ]);

    gpaThreshold = parseFloat(thresholds.global_threshold) || 2.5;
    document.getElementById('gpaThresholdLabel').textContent = gpaThreshold.toFixed(2);
    document.getElementById('globalGpaInput').value = gpaThreshold;

    // GPA bar chart (current GPA per org)
    const orgs = thresholds.orgs.filter(o => parseFloat(o.gpa) > 0);
    const ctx = document.getElementById('gpaChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: orgs.map(o => o.chapter_letters),
        datasets: [
          {
            label: 'Chapter GPA',
            data: orgs.map(o => parseFloat(o.gpa)),
            backgroundColor: orgs.map(o =>
              parseFloat(o.gpa) >= gpaThreshold ? CHART_COLORS.green + 'cc' : CHART_COLORS.red + 'cc'
            ),
            borderRadius: 4,
          },
          {
            label: `Threshold (${gpaThreshold})`,
            data: orgs.map(() => gpaThreshold),
            type: 'line',
            borderColor: CHART_COLORS.amber,
            borderWidth: 2,
            borderDash: [5,4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
        scales: {
          y: { beginAtZero: false, min: 1.5, max: 4.0, grid: { color: '#f0f4f8' } },
          x: { grid: { display: false } },
        },
      },
    });

    // GPA table
    const tbody = document.getElementById('gpaTbody');
    if (!orgs.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">No GPA data. Import rosters to populate.</td></tr>`;
      return;
    }
    tbody.innerHTML = orgs.sort((a,b) => a.gpa - b.gpa).map(o => {
      const gpa = parseFloat(o.gpa);
      const flag = gpa < gpaThreshold;
      return `
        <tr>
          <td style="font-weight:500">${o.name} <span style="color:var(--text-muted);font-size:.8rem">${o.chapter_letters}</span></td>
          <td>${councilBadge(o.council)}</td>
          <td>
            <span style="font-weight:700;color:${flag ? 'var(--danger)' : 'var(--success)'}">${gpa.toFixed(2)}</span>
          </td>
          <td>${o.roster_size || '—'}</td>
          <td>
            ${flag
              ? '<span class="badge badge-red">Below Threshold</span>'
              : '<span class="badge badge-green">Meets Requirement</span>'
            }
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('GPA data error:', err);
  }
}

// ─── Risk Scores ─────────────────────────────────────────────────────────────
async function loadRiskScores() {
  const tbody = document.getElementById('riskTbody');
  try {
    const scores = await api('GET', '/analytics/risk-scores');
    if (!scores.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No data.</td></tr>`;
      return;
    }
    tbody.innerHTML = scores.map(s => {
      const barW  = s.risk_score;
      const color = s.risk_level === 'critical' ? '#dc2626'
                  : s.risk_level === 'high'     ? '#ef4444'
                  : s.risk_level === 'medium'   ? '#f59e0b'
                  : '#22c55e';
      return `
        <tr>
          <td>
            <a href="/chapter.html?id=${s.id}" class="td-link">${s.name}</a>
            <span style="color:var(--text-muted);font-size:.75rem;margin-left:5px">${s.chapter_letters}</span>
          </td>
          <td>${councilBadge(s.council)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:80px;height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden">
                <div style="width:${barW}%;height:100%;background:${color};border-radius:99px"></div>
              </div>
              <span style="font-weight:700;color:${color}">${s.risk_score}</span>
            </div>
          </td>
          <td><span class="badge badge-risk-${s.risk_level}">${s.risk_level}</span></td>
          <td>${s.open_incidents > 0 ? `<span style="color:var(--danger);font-weight:600">${s.open_incidents}</span>` : '<span style="color:var(--text-muted)">0</span>'}</td>
          <td>${s.overdue_requirements > 0 ? `<span style="color:var(--danger);font-weight:600">${s.overdue_requirements}</span>` : '<span style="color:var(--text-muted)">0</span>'}</td>
          <td>${orgStatusBadge(s.status)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────
function exportCSV(type) {
  window.location.href = `/api/analytics/export/${type}`;
}

// ─── Semester reset ───────────────────────────────────────────────────────────
function openResetModal() {
  document.getElementById('resetConfirmInput').value = '';
  openModal('resetModal');
}

async function confirmReset() {
  if (document.getElementById('resetConfirmInput').value !== 'RESET') {
    toast('Type RESET to confirm', 'warning');
    return;
  }
  const btn = document.getElementById('confirmResetBtn');
  btn.disabled = true; btn.textContent = 'Resetting…';
  try {
    const result = await api('POST', '/compliance/reset', {});
    toast(`Semester reset — ${result.updated} requirement(s) cleared`);
    closeModal('resetModal');
    await Promise.all([loadSummary(), loadComplianceChart(), loadGpaData(), loadRiskScores()]);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Reset All Chapters';
  }
}

// ─── GPA settings ────────────────────────────────────────────────────────────
function openGpaSettings() {
  openModal('gpaModal');
}

async function saveGpaSettings() {
  const val = parseFloat(document.getElementById('globalGpaInput').value);
  if (isNaN(val) || val < 0 || val > 4) {
    toast('Enter a GPA between 0.00 and 4.00', 'warning');
    return;
  }
  try {
    await api('PUT', '/analytics/gpa-thresholds/global', { threshold: val });
    toast('GPA threshold updated to ' + val.toFixed(2));
    closeModal('gpaModal');
    loadGpaData();
  } catch (err) {
    toast(err.message, 'error');
  }
}
