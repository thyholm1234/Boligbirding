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

function renderRows(rows) {
  const tbody = document.getElementById('obs-table-body');
  const countEl = document.getElementById('obs-count');
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Ingen data fundet.</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  tbody.innerHTML = rows.map(row => {
    const obsValue = row.link
      ? `<a href="${row.link}" target="_blank" rel="noopener">${row.observationer}</a>`
      : `${row.observationer}`;
    return `
      <tr>
        <td>${row.artnr}</td>
        <td>${row.navn}</td>
        <td>${row.latin}</td>
        <td class="text-right">${obsValue}</td>
        <td class="text-right">${row.individer}</td>
      </tr>
    `;
  }).join('');
  if (countEl) countEl.textContent = `${rows.length} arter`; 
}

function filterRows(rows, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(row => {
    return String(row.artnr).toLowerCase().includes(q)
      || String(row.navn).toLowerCase().includes(q)
      || String(row.latin).toLowerCase().includes(q);
  });
}

async function loadObservationer() {
  const res = await fetch('/api/observationer_table');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();
  const rows = data.rows || [];
  const search = document.getElementById('obs-search');

  renderRows(rows);

  if (search) {
    search.addEventListener('input', () => {
      renderRows(filterRows(rows, search.value));
    });
  }
}

ensureLoggedIn().then(ok => {
  if (ok) loadObservationer();
});
