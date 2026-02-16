// Version: 1.8.17 - 2026-02-16 21.04.34
// © Christian Vemmelund Helligsø
import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';

renderNavbar();
initNavbar();
initMobileNavbar();

fetch('/api/get_grupper')
  .then(res => res.json())
  .then(grupper => { addGruppeLinks(grupper); });

async function ensureLoggedIn() {
  const res = await fetch('/api/is_logged_in');
  const data = await res.json();
  if (!data.ok) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('da-DK');
}

function formatListItem(item) {
  const dato = item.dato ? item.dato : '';
  const art = item.artnavn ? item.artnavn : '';
  const lok = item.lokalitet ? ` (${item.lokalitet})` : '';
  return `${dato} - ${art}${lok}`.trim();
}

function renderList(targetId, items) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!items || !items.length) {
    target.innerHTML = '<div class="muted">Ingen data.</div>';
    return;
  }
  target.innerHTML = `<ul class="profile-list-ul">${items
    .map(it => `<li>${formatListItem(it)}</li>`)
    .join('')}</ul>`;
}

function renderBlockers(targetId, blockers) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!blockers || !blockers.length) {
    target.innerHTML = '<span class="muted">Blockers: 0</span>';
    return;
  }
  const maxItems = 20;
  const shown = blockers.slice(0, maxItems);
  const list = shown.map(b => `${b.art}${b.count ? ` (${b.count})` : ''}`);
  const suffix = blockers.length > maxItems ? ` +${blockers.length - maxItems} flere` : '';
  target.innerHTML = `<b>Blockers (${blockers.length}):</b> ${list.join(', ')}${suffix}`;
}

function setupToggles() {
  document.querySelectorAll('.profile-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const target = document.getElementById(targetId);
      if (!target) return;
      const isOpen = target.classList.toggle('is-open');
      btn.textContent = isOpen ? 'Skjul liste' : 'Se liste';
    });
  });
}

function renderYearList(years, user) {
  const target = document.getElementById('year-list');
  if (!target) return;
  if (!years || !years.length) {
    target.innerHTML = '<div class="muted">Ingen årsdata fundet.</div>';
    return;
  }
  const rows = years.map(y => {
    const params = new URLSearchParams({
      scope: 'user_global',
      obserkode: user.obserkode || '',
      navn: user.navn || user.obserkode || '',
      aar: String(y.year)
    });
    const link = `scoreboard.html?${params.toString()}`;
    const count = formatNumber(y.count);
    const rank = y.rank ? `#${y.rank}` : '-';
    return `
      <tr>
        <td>${y.year}</td>
        <td><a href="${link}">Se listen</a></td>
        <td>${count}</td>
        <td>${rank}</td>
      </tr>
    `;
  }).join('');

  target.innerHTML = `
    <table class="profile-table">
      <thead>
        <tr>
          <th>År</th>
          <th>Liste</th>
          <th>X</th>
          <th>Placering</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildLineChart(canvasId, labels, data, label, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          borderColor: color,
          backgroundColor: color,
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: 'År' } },
        y: { title: { display: true, text: label }, beginAtZero: true }
      }
    }
  });
}

async function loadProfile() {
  const res = await fetch('/api/profile_data');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();

  const user = data.user || {};
  const header = document.getElementById('profile-header');
  if (header) {
    header.innerHTML = `
      <div class="profile-title">${user.navn || 'Ukendt bruger'}</div>
      <div class="profile-meta">
        <div><b>Obserkode:</b> ${user.obserkode || '-'}</div>
        <div><b>Lokalafdeling:</b> ${user.lokalafdeling || '-'}</div>
        <div><b>Kommune:</b> ${user.kommune || '-'}</div>
      </div>
    `;
  }

  const danmark = data.lists?.danmark || { items: [], count: 0 };
  const vp = data.lists?.vp || { items: [], count: 0 };

  const danmarkMetrics = document.getElementById('danmark-metrics');
  if (danmarkMetrics) {
    danmarkMetrics.innerHTML = `
      <div><b>Kryds:</b> ${formatNumber(danmark.count || 0)}</div>
      <div class="muted">Kronologisk</div>
    `;
  }

  const vpMetrics = document.getElementById('vp-metrics');
  if (vpMetrics) {
    vpMetrics.innerHTML = `
      <div><b>Kryds:</b> ${formatNumber(vp.count || 0)}</div>
      <div class="muted">Kronologisk</div>
    `;
  }

  renderBlockers('danmark-blockers', danmark.blockers || []);
  renderList('danmark-list', danmark.items || []);
  renderList('vp-list', vp.items || []);
  renderYearList(data.years || [], user);

  setupToggles();

  const chartGlobal = data.charts?.global_by_year || [];
  const chartMatrikel = data.charts?.matrikel_by_year || [];
  const chartObs = data.charts?.obs_by_year || [];

  const labelsGlobal = chartGlobal.map(d => d.year);
  const valuesGlobal = chartGlobal.map(d => d.count);
  const labelsMatrikel = chartMatrikel.map(d => d.year);
  const valuesMatrikel = chartMatrikel.map(d => d.count);
  const labelsObs = chartObs.map(d => d.year);
  const valuesObs = chartObs.map(d => d.count);

  buildLineChart('chart-global', labelsGlobal, valuesGlobal, 'Arter', '#2b7a78');
  buildLineChart('chart-matrikel', labelsMatrikel, valuesMatrikel, 'Matrikelarter', '#3aafa9');
  buildLineChart('chart-obs', labelsObs, valuesObs, 'Observationer', '#1976d2');
}

ensureLoggedIn().then(ok => {
  if (ok) loadProfile();
});
