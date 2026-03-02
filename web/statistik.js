// Version: 1.8.17 - 2026-02-16 21.04.34
// © Christian Vemmelund Helligsø
import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';

renderNavbar();
initNavbar();
initMobileNavbar();

fetch('/api/get_grupper')
  .then(res => res.json())
  .then(grupper => { addGruppeLinks(grupper); });

const chartInstances = {};
let primaryStatData = null;
let compareStatData = null;

function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('da-DK');
}

function renderYearList(targetId, years, user, scope, totalCount = 0, totalRank = null, compareYears = [], compareUser = null, compareTotalCount = null, compareTotalRank = null) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const filtered = (years || []).filter(y => {
    const count = Number.parseInt(y.count, 10);
    return Number.isFinite(count) && count > 0;
  }).sort((a, b) => Number(b.year) - Number(a.year));
  const compareMap = new Map((compareYears || []).map(y => [String(y.year), y]));
  const hasTotal = Number(totalCount) > 0;
  if (!filtered.length && !hasTotal) {
    target.innerHTML = '<div class="muted">Ingen årsdata fundet.</div>';
    return;
  }
  const totalParams = new URLSearchParams({
    scope,
    obserkode: user.obserkode || '',
    navn: user.navn || user.obserkode || '',
    aar: 'global'
  });
  const totalLink = `scoreboard.html?${totalParams.toString()}`;
  const totalCompareCell = compareUser
    ? `<td>${compareTotalCount !== null && compareTotalCount !== undefined ? `${formatNumber(compareTotalCount)} (${compareTotalRank ? `#${compareTotalRank}` : '-'})` : '-'}</td>`
    : '';
  const totalRankText = totalRank ? `#${totalRank}` : '-';
  const totalRow = hasTotal
    ? `
      <tr>
        <td><b>Total</b></td>
        <td><a href="${totalLink}">Se listen</a></td>
        <td><b>${formatNumber(totalCount)}</b></td>
        <td>${totalRankText}</td>
        ${totalCompareCell}
      </tr>
    `
    : '';

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
    const compareRow = compareMap.get(String(y.year));
    const compareCell = compareUser
      ? `<td>${compareRow ? `${formatNumber(compareRow.count)} (${compareRow.rank ? `#${compareRow.rank}` : '-'})` : '-'}</td>`
      : '';
    return `
      <tr>
        <td>${y.year}</td>
        <td><a href="${link}">Se listen</a></td>
        <td>${count}</td>
        <td>${rank}</td>
        ${compareCell}
      </tr>
    `;
  }).join('');

  const compareHeader = compareUser ? `<th>${compareUser.obserkode || 'Sammenligning'}</th>` : '';

  target.innerHTML = `
    <table class="profile-table">
      <thead>
        <tr>
          <th>År</th>
          <th>Liste</th>
          <th>X</th>
          <th>Placering</th>
          ${compareHeader}
        </tr>
      </thead>
      <tbody>${totalRow}${rows}</tbody>
    </table>
  `;
}

function buildLineChart(canvasId, labels, datasets, yAxisTitle) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }
  chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: 'År' } },
        y: { title: { display: true, text: yAxisTitle }, beginAtZero: true }
      }
    }
  });
}

function mergeSeries(primary = [], compare = []) {
  const years = new Set();
  (primary || []).forEach(d => years.add(Number(d.year)));
  (compare || []).forEach(d => years.add(Number(d.year)));
  const labels = Array.from(years).filter(Number.isFinite).sort((a, b) => a - b);
  const primaryMap = new Map((primary || []).map(d => [Number(d.year), Number(d.count) || 0]));
  const compareMap = new Map((compare || []).map(d => [Number(d.year), Number(d.count) || 0]));
  const primaryValues = labels.map(y => primaryMap.get(y) || 0);
  const compareValues = labels.map(y => compareMap.get(y) || 0);
  return { labels, primaryValues, compareValues };
}

function buildDevelopmentSeriesFromFirsts(items = []) {
  const byYear = new Map();
  (items || []).forEach(item => {
    const dato = String(item?.dato || '');
    const parts = dato.split('-');
    if (parts.length !== 3) return;
    const year = Number(parts[2]);
    if (!Number.isFinite(year)) return;
    byYear.set(year, (byYear.get(year) || 0) + 1);
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  let running = 0;
  return years.map(year => {
    running += byYear.get(year) || 0;
    return { year, count: running };
  });
}

function mergeCumulativeSeries(primary = [], compare = []) {
  const years = new Set();
  (primary || []).forEach(d => years.add(Number(d.year)));
  (compare || []).forEach(d => years.add(Number(d.year)));
  const labels = Array.from(years).filter(Number.isFinite).sort((a, b) => a - b);

  const primaryMap = new Map((primary || []).map(d => [Number(d.year), Number(d.count) || 0]));
  const compareMap = new Map((compare || []).map(d => [Number(d.year), Number(d.count) || 0]));

  let lastPrimary = 0;
  let lastCompare = 0;
  const primaryValues = labels.map(y => {
    if (primaryMap.has(y)) lastPrimary = primaryMap.get(y) || 0;
    return lastPrimary;
  });
  const compareValues = labels.map(y => {
    if (compareMap.has(y)) lastCompare = compareMap.get(y) || 0;
    return lastCompare;
  });

  return { labels, primaryValues, compareValues };
}

function createDataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    fill: false,
    tension: 0.2
  };
}

function renderStatistik() {
  if (!primaryStatData) return;

  const data = primaryStatData;
  const user = data.user || {};
  const compareUser = compareStatData?.user || null;

  const header = document.getElementById('profile-header');
  if (header) {
    const kommune = user.kommune_navn || user.kommune || '-';
    const compareText = compareUser
      ? `<div><b>Sammenligner med:</b> ${compareUser.navn || '-'} (${compareUser.obserkode || '-'})</div>`
      : '';
    header.innerHTML = `
      <div class="profile-title">${user.navn || 'Ukendt bruger'}</div>
      <div class="profile-meta">
        <div><b>Obserkode:</b> ${user.obserkode || '-'}</div>
        <div><b>Lokalafdeling:</b> ${user.lokalafdeling || '-'}</div>
        <div><b>Kommune:</b> ${kommune}</div>
        ${compareText}
      </div>
    `;
  }

  renderYearList(
    'year-list',
    data.years || [],
    user,
    'user_global',
    Number(data.lists?.danmark?.count || 0),
    data.lists?.danmark?.rank ?? null,
    compareStatData?.years || [],
    compareUser,
    compareStatData ? Number(compareStatData?.lists?.danmark?.count || 0) : null,
    compareStatData?.lists?.danmark?.rank ?? null
  );
  renderYearList(
    'matrikel-year-list',
    data.matrikel_years || [],
    user,
    'user_matrikel',
    Number(data.lists?.vp?.count || 0),
    data.lists?.vp?.rank ?? null,
    compareStatData?.matrikel_years || [],
    compareUser,
    compareStatData ? Number(compareStatData?.lists?.vp?.count || 0) : null,
    compareStatData?.lists?.vp?.rank ?? null
  );

  const globalSeries = mergeSeries(data.charts?.global_by_year || [], compareStatData?.charts?.global_by_year || []);
  const matrikelSeries = mergeSeries(data.charts?.matrikel_by_year || [], compareStatData?.charts?.matrikel_by_year || []);
  const obsSeries = mergeSeries(data.charts?.obs_by_year || [], compareStatData?.charts?.obs_by_year || []);
  const globalDevPrimary = buildDevelopmentSeriesFromFirsts(data.lists?.danmark?.items || []);
  const globalDevCompare = buildDevelopmentSeriesFromFirsts(compareStatData?.lists?.danmark?.items || []);
  const matrikelDevPrimary = buildDevelopmentSeriesFromFirsts(data.lists?.vp?.items || []);
  const matrikelDevCompare = buildDevelopmentSeriesFromFirsts(compareStatData?.lists?.vp?.items || []);
  const globalDevSeries = mergeCumulativeSeries(globalDevPrimary, globalDevCompare);
  const matrikelDevSeries = mergeCumulativeSeries(matrikelDevPrimary, matrikelDevCompare);

  buildLineChart(
    'chart-global',
    globalSeries.labels,
    [
      createDataset(user.obserkode || 'Primær', globalSeries.primaryValues, '#2b7a78'),
      ...(compareUser ? [createDataset(compareUser.obserkode || 'Sammenligning', globalSeries.compareValues, '#d32f2f')] : [])
    ],
    'Arter'
  );
  buildLineChart(
    'chart-matrikel',
    matrikelSeries.labels,
    [
      createDataset(user.obserkode || 'Primær', matrikelSeries.primaryValues, '#3aafa9'),
      ...(compareUser ? [createDataset(compareUser.obserkode || 'Sammenligning', matrikelSeries.compareValues, '#ef6c00')] : [])
    ],
    'Matrikelarter'
  );
  buildLineChart(
    'chart-global-dev',
    globalDevSeries.labels,
    [
      createDataset(user.obserkode || 'Primær', globalDevSeries.primaryValues, '#00695c'),
      ...(compareUser ? [createDataset(compareUser.obserkode || 'Sammenligning', globalDevSeries.compareValues, '#c62828')] : [])
    ],
    'Sete arter (kumulativ)'
  );
  buildLineChart(
    'chart-matrikel-dev',
    matrikelDevSeries.labels,
    [
      createDataset(user.obserkode || 'Primær', matrikelDevSeries.primaryValues, '#00838f'),
      ...(compareUser ? [createDataset(compareUser.obserkode || 'Sammenligning', matrikelDevSeries.compareValues, '#ef6c00')] : [])
    ],
    'Sete matrikelarter (kumulativ)'
  );
  buildLineChart(
    'chart-obs',
    obsSeries.labels,
    [
      createDataset(user.obserkode || 'Primær', obsSeries.primaryValues, '#1976d2'),
      ...(compareUser ? [createDataset(compareUser.obserkode || 'Sammenligning', obsSeries.compareValues, '#8e24aa')] : [])
    ],
    'Observationer'
  );
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadStatistik(obserkode) {
  try {
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
    primaryStatData = data;
    compareStatData = null;
    const compareStatus = document.getElementById('compare-status');
    if (compareStatus) compareStatus.textContent = '';
    renderStatistik();
  } catch (e) {
    document.getElementById('profile-header').innerHTML = '<div class="muted">Fejl ved indlæsning af data.</div>';
  }
}

function initSearch() {
  const input = document.getElementById('obserkode-input');
  const btn = document.getElementById('search-btn');

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

function initComparison() {
  const input = document.getElementById('compare-obserkode-input');
  const btn = document.getElementById('compare-btn');
  const clearBtn = document.getElementById('clear-compare-btn');
  const status = document.getElementById('compare-status');

  const runCompare = async () => {
    if (!primaryStatData?.user?.obserkode) return;
    const value = (input?.value || '').trim().toUpperCase();
    if (!value) {
      if (status) status.textContent = 'Indtast en obserkode for at sammenligne.';
      return;
    }
    if (value === String(primaryStatData.user.obserkode || '').toUpperCase()) {
      if (status) status.textContent = 'Du sammenligner allerede med den viste observatør.';
      return;
    }
    if (status) status.textContent = `Henter data for ${value}...`;
    try {
      const res = await fetch(`/api/statistik_data?obserkode=${encodeURIComponent(value)}`);
      if (!res.ok) {
        if (status) status.textContent = 'Kunne ikke finde observatør til sammenligning.';
        return;
      }
      compareStatData = await res.json();
      renderStatistik();
      if (status) status.textContent = `Sammenligner nu med ${compareStatData?.user?.obserkode || value}.`;
    } catch (e) {
      if (status) status.textContent = 'Fejl ved hentning af sammenligningsdata.';
    }
  };

  btn?.addEventListener('click', runCompare);
  input?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      runCompare();
    }
  });
  clearBtn?.addEventListener('click', () => {
    compareStatData = null;
    renderStatistik();
    if (status) status.textContent = 'Sammenligning fjernet.';
    if (input) input.value = '';
  });
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/profile_data');
    if (res.ok) {
      const data = await res.json();
      return data.user?.obserkode;
    }
  } catch (e) {
    // Fall through if not logged in
  }
  return null;
}

// Main initialization
const queryObserkode = getQueryParam('obserkode');
const statisticsContent = document.getElementById('statistics-content');

statisticsContent.style.display = 'block';
initSearch();
initComparison();

// Load statistics
if (queryObserkode) {
  loadStatistik(queryObserkode);
} else {
  // Load current user's statistics
  loadCurrentUser().then(obserkode => {
    if (obserkode) {
      loadStatistik(obserkode);
    }
  });
}
