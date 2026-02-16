// Version: 1.8.17 - 2026-02-16 21.04.34
// © Christian Vemmelund Helligsø
import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';

renderNavbar();
initNavbar();
initMobileNavbar();

fetch('/api/get_grupper')
  .then(res => res.json())
  .then(grupper => { addGruppeLinks(grupper); });

function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('da-DK');
}

function renderYearList(targetId, years, user, scope) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const filtered = (years || []).filter(y => {
    const count = Number.parseInt(y.count, 10);
    return Number.isFinite(count) && count > 0;
  });
  if (!filtered.length) {
    target.innerHTML = '<div class="muted">Ingen årsdata fundet.</div>';
    return;
  }
  const rows = filtered.map(y => {
    const params = new URLSearchParams({
      scope: scope,
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

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadStatistik(obserkode) {
  const res = await fetch(`/api/statistik_data?obserkode=${encodeURIComponent(obserkode)}`);
  if (res.status === 404) {
    document.getElementById('profile-header').innerHTML = '<div class="muted">Observatør ikke fundet.</div>';
    return;
  }
  if (!res.ok) {
    document.getElementById('profile-header').innerHTML = '<div class="muted">Fejl ved indlæsning af data.</div>';
    return;
  }

  const data = await res.json();

  const user = data.user || {};
  const header = document.getElementById('profile-header');
  if (header) {
    const kommune = user.kommune_navn || user.kommune || '-';
    header.innerHTML = `
      <div class="profile-title">${user.navn || 'Ukendt bruger'}</div>
      <div class="profile-meta">
        <div><b>Obserkode:</b> ${user.obserkode || '-'}</div>
        <div><b>Lokalafdeling:</b> ${user.lokalafdeling || '-'}</div>
        <div><b>Kommune:</b> ${kommune}</div>
      </div>
    `;
  }
  renderYearList('year-list', data.years || [], user, 'user_global');
  renderYearList('matrikel-year-list', data.matrikel_years || [], user, 'user_matrikel');

  const chartGlobal = data.charts?.global_by_year || [];
  const chartMatrikel = data.charts?.matrikel_by_year || [];
  const chartObs = data.charts?.obs_by_year || [];

  const filteredGlobal = chartGlobal.filter(d => Number(d.count) > 0);
  const filteredMatrikel = chartMatrikel.filter(d => Number(d.count) > 0);
  const filteredObs = chartObs.filter(d => Number(d.count) > 0);

  const labelsGlobal = filteredGlobal.map(d => d.year);
  const valuesGlobal = filteredGlobal.map(d => d.count);
  const labelsMatrikel = filteredMatrikel.map(d => d.year);
  const valuesMatrikel = filteredMatrikel.map(d => d.count);
  const labelsObs = filteredObs.map(d => d.year);
  const valuesObs = filteredObs.map(d => d.count);

  buildLineChart('chart-global', labelsGlobal, valuesGlobal, 'Arter', '#2b7a78');
  buildLineChart('chart-matrikel', labelsMatrikel, valuesMatrikel, 'Matrikelarter', '#3aafa9');
  buildLineChart('chart-obs', labelsObs, valuesObs, 'Observationer', '#1976d2');
}

function initSearch() {
  const input = document.getElementById('obserkode-input');
  const btn = document.getElementById('search-btn');

  searchContainer.style.display = 'block';

  btn.addEventListener('click', () => {
    const value = input.value.trim();
    if (value) {
      window.location.href = `statistik.html?obserkode=${encodeURIComponent(value)}`;
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      btn.click();
    }
  });
}

// Main initialization
const queryObserkode = getQueryParam('obserkode');
const searchContainer = document.getElementById('search-container');
const statisticsContent = document.getElementById('statistics-content');

if (queryObserkode) {
  searchContainer.style.display = 'none';
  statisticsContent.style.display = 'block';
  loadStatistik(queryObserkode);
} else {
  statisticsContent.style.display = 'none';
  initSearch();
}
