// Version: 1.10.1 - 2026-02-16 21.29.50
// © Christian Vemmelund Helligsø


// Navbar
import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';
renderNavbar();
initNavbar();
initMobileNavbar();

// ---------- Global state ----------
let lastScoreboardParams = null;
let firstsSortMode = "alphabetical"; // "alphabetical" | "newest" | "oldest"
let cachedGlobalYear = null;

// Snapshot af originale data pr. scope/gruppe (til robust filtrering)
let masterData = null;            // { rows, koder, matrix, totals, arter }
let lastSelectedKoder = null;     // Husk sidste brugervalg i filteret

function parseDmyToTime(value) {
  const parts = (value || "").split("-");
  if (parts.length !== 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (!day || !month || !year) return 0;
  const date = new Date(year, month - 1, day);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

async function ensureGlobalYear() {
  if (cachedGlobalYear) return cachedGlobalYear;
  try {
    const res = await fetch('/api/get_year');
    const data = await res.json();
    if (data && data.year) {
      cachedGlobalYear = Number(data.year);
      return cachedGlobalYear;
    }
  } catch (err) {
    console.warn('Kunne ikke hente aktuelt år:', err);
  }
  cachedGlobalYear = new Date().getFullYear();
  return cachedGlobalYear;
}

function shouldShowYearSelector(params) {
  return String(params.aar) !== "global";
}

function getSelectedYear(params) {
  const parsed = Number.parseInt(params.aar, 10);
  if (!Number.isNaN(parsed) && String(params.aar) !== "global") return parsed;
  if (cachedGlobalYear) return cachedGlobalYear;
  return new Date().getFullYear();
}

function createYearSelector(params) {
  if (!shouldShowYearSelector(params)) return null;

  const selectedYear = getSelectedYear(params);
  const minYear = 1950;
  const maxYear = new Date().getFullYear();
  const years = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const wrap = document.createElement("div");
  wrap.id = "yearSelectWrap";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "0.5em";

  const label = document.createElement("label");
  label.htmlFor = "yearSelect";
  label.textContent = "År:";

  const select = document.createElement("select");
  select.id = "yearSelect";
  select.style.padding = "0.4em 0.6em";
  select.innerHTML = years
    .map(y => `<option value="${y}" ${y === selectedYear ? "selected" : ""}>${y}</option>`)
    .join("\n");

  select.addEventListener("change", () => {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set("aar", select.value);
    window.history.replaceState({}, "", "?" + urlParams.toString());
    visSide();
  });

  wrap.appendChild(label);
  wrap.appendChild(select);
  return wrap;
}

function insertYearSelectorRow(params, container) {
  if (!container) return;
  const existing = container.querySelector('#scoreboard-year-row');
  if (existing) existing.remove();

  const yearSelector = createYearSelector(params);
  if (!yearSelector) return;

  const row = document.createElement("div");
  row.id = "scoreboard-year-row";
  row.style.display = "flex";
  row.style.justifyContent = "center";
  row.style.margin = "1em 0";
  row.appendChild(yearSelector);

  container.prepend(row);
}

// Hent grupper til navbar
fetch('/api/get_grupper')
  .then(res => res.json())
  .then(grupper => { addGruppeLinks(grupper); });

// ---------- URL utils ----------
function getParams() {
  const params = {};
  const qs = window.location.search;
  if (!qs || qs.length <= 1) return params;
  const usp = new URLSearchParams(qs);
  usp.forEach((v, k) => { params[k] = v; });
  return params;
}

// ---------- API ----------
async function hentData(params) {
  let url, body;

  if (params.scope && params.scope.startsWith("user_")) {
    // Brugerliste hentes separat i visUserFirsts; vi holder denne for konsistens
    url = "/api/obser";
    body = params;
  } else if (params.scope && params.scope.startsWith("gruppe_")) {
    url = "/api/gruppe_scoreboard";
    body = {
      navn: params.gruppe,
      scope: params.scope,
      aar: params.aar
    };
  } else if (params.scope && params.scope.startsWith("lokal_")) {
    // Hvis du har en separat endpoint til lokal, kan det skiftes her
    url = "/api/scoreboard";
    body = params;
  } else {
    url = "/api/scoreboard";
    body = params;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return await res.json();
}

// ---------- Siderender ----------
async function visSide() {
  const params = getParams();
  const data = await hentData(params);

  const container = document.getElementById("main");
  const pageTitle = document.getElementById("page-title");

  // ------- SCOREBOARD -------
  if (!params.scope || !params.scope.startsWith("user_")) {
    lastScoreboardParams = params;
    await ensureGlobalYear();

    // Gem et master-snapshot som basis for al filtrering
    masterData = {
      rows: Array.isArray(data.rows) ? [...data.rows] : [],
      koder: Array.isArray(data.koder) ? [...data.koder] :
             (Array.isArray(data.rows) ? data.rows.map(r => r.obserkode) : []),
      matrix: Array.isArray(data.matrix) ? data.matrix.map(r => [...r]) : [],
      totals: Array.isArray(data.totals) ? [...data.totals] : [],
      arter: Array.isArray(data.arter) ? [...data.arter] : []
    };

    // Titel
    let title = "Scoreboard";
    if (params.scope === "global_alle") title = "National rangliste";
    else if (params.scope === "global_matrikel") title = "National matrikel-rangliste";
    else if (params.scope === "gruppe_alle") title = (params.gruppe ? params.gruppe + " – Rangliste" : "Gruppe – Rangliste");
    else if (params.scope === "gruppe_matrikel") title = (params.gruppe ? params.gruppe + " – Matrikel-rangliste" : "Gruppe – Matrikel-rangliste");
    else if (params.scope === "lokal_alle") title = (params.afdeling ? params.afdeling + " – Rangliste" : "Lokalafdeling – Rangliste");
    else if (params.scope === "lokal_matrikel") title = (params.afdeling ? params.afdeling + " – Matrikel-rangliste" : "Lokalafdeling – Matrikel-rangliste");
    else if (params.scope === "kommune_alle") title = (params.kommune_navn ? params.kommune_navn + " – Rangliste" : "Kommune – Rangliste");
    else if (params.scope === "kommune_matrikel") title = (params.kommune_navn ? params.kommune_navn + " – Matrikel-rangliste" : "Kommune – Matrikel-rangliste");

    setResponsiveTitle(pageTitle, title);

    const rows = masterData.rows;
    if (!rows.length) {
      container.innerHTML = "<p>Ingen brugere fundet.</p>";
      clearSections();
      return;
    }

    // Cards
    container.innerHTML = rows.map(row => `
      <div class="user-card" data-obserkode="${row.obserkode}">
        <strong>#${row.placering} ${row.navn}</strong><br>
        Antal arter: ${row.antal_arter}<br>
        Sidste art: ${row.sidste_art ? row.sidste_art + (row.sidste_dato ? " (" + row.sidste_dato + ")" : "") : ""}
      </div>
    `).join("");

    if (!params.scope || !params.scope.startsWith("gruppe_")) {
      insertYearSelectorRow(params, container);
    }

    // Filter-knap for grupper
    if (params.scope && params.scope.startsWith("gruppe_")) {
      tilføjGruppeFilterKnappen(masterData, params, container);
    }

    // Sektioner
    visScoreboardMatrix(masterData);
    visScoreboardBlockers(masterData);
    visScoreboardTrend(masterData);

    // Klik på bruger -> vis liste
    container.querySelectorAll('.user-card').forEach(card => {
      card.onclick = async function () {
        const kode = this.getAttribute('data-obserkode');
        const navn = this.querySelector('strong').innerText;
        firstsSortMode = "alphabetical";
        await visUserFirsts(kode, navn, firstsSortMode, lastScoreboardParams);
      };
    });
  }

  // ------- BRUGERLISTE -------
  else {
    firstsSortMode = params.sort || "alphabetical";
    await visUserFirsts(params.obserkode, params.navn || "", firstsSortMode, params);
  }
}

function setResponsiveTitle(el, title) {
  // Mobilombrydning (<=600px)
  if (window.matchMedia("(max-width: 600px)").matches) {
    let splitIdx = title.indexOf(" – ");
    if (splitIdx === -1) splitIdx = title.indexOf(" - ");
    if (splitIdx === -1 && title.includes(" Matrikel-rangliste")) splitIdx = title.indexOf(" Matrikel-rangliste");
    if (splitIdx === -1 && title.includes(" Rangliste")) splitIdx = title.indexOf(" Rangliste");

    if (splitIdx > 0) {
      const first = title.slice(0, splitIdx).trim();
      const rest = title.slice(splitIdx).replace(/^(\s*[-–]\s*)?/, '').trim();
      el.innerHTML = `<span style="display:block;word-break:break-word;">${first}</span><span style="display:block;word-break:break-word;">${rest}</span>`;
    } else {
      el.innerHTML = `<span style="display:block;word-break:break-word;">${title}</span>`;
    }
    el.style.hyphens = "manual";
    el.style.wordBreak = "break-word";
    el.style.overflowWrap = "break-word";
  } else {
    el.innerHTML = "";
    el.textContent = title;
    el.style.hyphens = "";
    el.style.wordBreak = "";
    el.style.overflowWrap = "";
  }
}

function clearSections() {
  const m = document.getElementById('scoreboard-matrix');
  const b = document.getElementById('scoreboard-blockers');
  const t = document.getElementById('scoreboard-trend');
  if (m) m.innerHTML = "";
  if (b) b.innerHTML = "";
  if (t) t.innerHTML = "";
}

// ---------- Brugerliste ----------
async function visUserFirsts(obserkode, navn, sortMode = firstsSortMode, parentParams = {}) {
  // Parent scope -> vælg API-scope
  const scope = parentParams.scope || 'global_alle';
  const gruppe = parentParams.gruppe;
  const afdeling = parentParams.afdeling;
  const kommune = parentParams.kommune;
  const aar = parentParams.aar;

  let apiScope = "user_global";
  const body = { scope: apiScope, obserkode };

  if (scope.endsWith("matrikel")) {
    apiScope = "user_matrikel";
    body.scope = apiScope;
  } else if (scope.startsWith("lokal")) {
    apiScope = "user_lokalafdeling";
    body.scope = apiScope;
    if (afdeling) body.afdeling = afdeling;
  } else if (scope.startsWith("kommune")) {
    apiScope = scope === "kommune_matrikel" ? "user_kommune_matrikel" : "user_kommune_alle";
    body.scope = apiScope;
    if (kommune) body.kommune = kommune;
  }
  if (aar) body.aar = aar;

  // Opdater URL (så back/forward virker)
  const urlParams = new URLSearchParams({
    scope: apiScope,
    obserkode: obserkode,
    navn: navn,
    sort: sortMode
  });
  if (gruppe) urlParams.set('gruppe', gruppe);
  if (afdeling) urlParams.set('afdeling', afdeling);
  if (kommune) urlParams.set('kommune', kommune);
  if (aar) urlParams.set('aar', aar);
  window.history.pushState({}, '', '?' + urlParams.toString());

  // Hent data
  const res = await fetch('/api/obser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const firsts = Array.isArray(data.firsts) ? data.firsts : [];

  // Render
  const container = document.getElementById("main");
  const pageTitle = document.getElementById("page-title");

  const visNavn = navn && !navn.startsWith("#") ? navn : obserkode;
  const isAllTime = String(aar) === "global";
  let prefix = "Første observationer for ";
  if (apiScope === "user_global") prefix = isAllTime ? "Arter (alle år) for " : "Årsarter for ";
  if (apiScope === "user_lokalafdeling") prefix = isAllTime ? "Lokalarter (alle år) for " : "Lokalarter for ";
  if (apiScope === "user_matrikel") prefix = isAllTime ? "Matrikelarter (alle år) for " : "Matrikelarter for ";
  pageTitle.textContent = prefix + visNavn;

  // Underrubrik for lokalafdeling
  const subtitleId = "scoreboard-subtitle";
  let subtitle = document.getElementById(subtitleId);
  if (apiScope === "user_lokalafdeling" && afdeling) {
    if (!subtitle) {
      subtitle = document.createElement("div");
      subtitle.id = subtitleId;
      subtitle.style.fontSize = "1.1em";
      subtitle.style.marginBottom = "1em";
      pageTitle.insertAdjacentElement("afterend", subtitle);
    }
    subtitle.textContent = afdeling;
  } else if (subtitle) {
    subtitle.remove();
  }

  let sortLabel = "";
  if (sortMode === "alphabetical") sortLabel = "Alfabetisk";
  if (sortMode === "newest") sortLabel = "Nyeste";
  if (sortMode === "oldest") sortLabel = "Ældste";

  let html = `<button id="sortBtn" style="margin-bottom:1em;">Sortering: ${sortLabel}</button>`;
  if (!firsts.length) {
    html += "<p>Ingen observationer fundet.</p><button id='tilbageBtn'>Tilbage</button>";
    container.innerHTML = html;
  } else {
    html += `<div id="firstsCards"></div><button id="tilbageBtn">Tilbage</button>`;
    container.innerHTML = html;
    renderFirsts(firsts, sortMode, apiScope);
  }

  // Tilbage -> genskab scoreboard
  document.getElementById('tilbageBtn').onclick = () => {
    if (parentParams) {
      const url = new URL(window.location.pathname, window.location.origin);
      ['scope', 'gruppe', 'afdeling', 'aar'].forEach(key => {
        if (parentParams[key]) url.searchParams.set(key, parentParams[key]);
      });
      window.history.replaceState({}, '', url.pathname + url.search);
    } else {
      window.history.replaceState({}, '', window.location.pathname);
    }
    firstsSortMode = "alphabetical";
    visSide();
  };

  // Togle-sort
  document.getElementById('sortBtn').onclick = () => {
    if (sortMode === "alphabetical") sortMode = "newest";
    else if (sortMode === "newest") sortMode = "oldest";
    else sortMode = "alphabetical";
    firstsSortMode = sortMode;
    visUserFirsts(obserkode, navn, sortMode, parentParams);
  };
}

// Sortér og vis cards
function renderFirsts(firsts, sortMode, scope) {
  let sorted = [...firsts];
  if (sortMode === "alphabetical") {
    sorted.sort((a, b) => a.artnavn.localeCompare(b.artnavn));
  } else if (sortMode === "newest") {
    sorted.sort((a, b) => parseDmyToTime(b.dato) - parseDmyToTime(a.dato));
  } else if (sortMode === "oldest") {
    sorted.sort((a, b) => parseDmyToTime(a.dato) - parseDmyToTime(b.dato));
  }
  const hideLokalitet = scope === "user_matrikel";
  const cards = sorted.map(f => `
    <div class="user-card">
      <strong>${f.artnavn}</strong><br>
      ${!hideLokalitet ? `Lokalitet: ${f.lokalitet}<br>` : ""}
      Dato: ${f.dato}
    </div>
  `).join("");
  const target = document.getElementById("firstsCards");
  if (target) target.innerHTML = cards;
}

// ---------- Matrix / Blockers / Trend ----------
function visScoreboardMatrix(data) {
  const matrixDiv = document.getElementById('scoreboard-matrix');
  if (!matrixDiv) return;

  const arter = Array.isArray(data.arter) ? data.arter : [];
  const koder = Array.isArray(data.koder) ? data.koder : [];
  const matrix = Array.isArray(data.matrix) ? data.matrix : [];

  if (!arter.length || !koder.length || !matrix.length) {
    matrixDiv.innerHTML = "";
    return;
  }

  const sortedKoder = sortKoderByPlacering(data);

  // Tilføj matrix-table--plain hvis kun én kode vises
  const plainClass = (sortedKoder.length === 1) ? "matrix-table--plain" : "";

  let html = `<div class="matrix-table-wrap"><table class="matrix-table ${plainClass}"><thead><tr>`;
  html += `<th>#</th><th class="matrix-art-header" style="white-space:nowrap;cursor:pointer" title="Vis alle observatører">Art</th>`;
  sortedKoder.forEach(k => 
    html += `<th class="matrix-kode-header" data-obserkode="${k}" style="cursor:pointer">${k}</th>`
  );
  html += `</tr></thead><tbody>`;

  for (let i = 0; i < arter.length; i++) {
    // Tæl forekomster pr. art (antal brugere med dato)
    let antalObservationer = 0;
    sortedKoder.forEach(k => {
      const origIdx = koder.indexOf(k);
      if (origIdx >= 0 && matrix[i] && matrix[i][origIdx]) antalObservationer++;
    });

    // Farvelægning
    let rowClass = "";
    if (antalObservationer >= 8) rowClass = "bg-green";
    else if (antalObservationer >= 5) rowClass = "bg-lightgreen";
    else if (antalObservationer >= 2) rowClass = "bg-orange";
    else rowClass = "bg-red";

    // Fjern farveklasser i single obserkode mode
    if (plainClass) rowClass = "";

    html += `<tr class="${rowClass}"><td>${i + 1}</td><td>${arter[i]}</td>`;
    sortedKoder.forEach(k => {
      const origIdx = koder.indexOf(k);
      const val = (origIdx >= 0 && matrix[i]) ? (matrix[i][origIdx] || "") : "";
      html += `<td>${val}</td>`;
    });
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  matrixDiv.innerHTML = `<h3>Matrix</h3>${html}`;

  // --- NYT: Klik på kode-header ---

  matrixDiv.querySelectorAll('.matrix-kode-header').forEach(th => {
    th.addEventListener('click', function () {
      // Hvis kun én bruger vises, gå tilbage til masterData
      if (data.koder && data.koder.length === 1) {
        visScoreboardMatrix(masterData);
      } else {
        const kode = this.getAttribute('data-obserkode');
        const filtered = buildSingleUserMatrixData(kode);
        if (filtered) {
          visScoreboardMatrix(filtered);
        }
      }
    });
  });

  const artHeader = matrixDiv.querySelector('.matrix-art-header');
  if (artHeader) {
    artHeader.addEventListener('click', function () {
      visScoreboardMatrix(masterData);
    });
  }
}

function buildSingleUserMatrixData(obserkode) {
  if (!masterData) return null;
  const idx = masterData.koder.indexOf(obserkode);
  if (idx === -1) return null;
  // Find bruger-row
  const row = (masterData.rows || []).find(r => r.obserkode === obserkode);
  if (!row) return null;
  // Filtrer matrix og totals til kun denne bruger
  const koder = [obserkode];
  const rows = [row];
  const matrix = (masterData.matrix || []).map(r => [r[idx]]);
  const totals = [masterData.totals ? masterData.totals[idx] : null];
  // Find arter hvor brugeren har en observation
  const arter = [];
  const matrixFiltered = [];
  for (let i = 0; i < masterData.arter.length; i++) {
    if (matrix[i][0]) {
      arter.push(masterData.arter[i]);
      matrixFiltered.push([matrix[i][0]]);
    }
  }
  // Sortér arter efter dato (nyeste øverst)
  const combined = arter.map((art, i) => ({ art, dato: matrixFiltered[i][0], idx: i }));
  combined.sort((a, b) => parseDmyToTime(b.dato) - parseDmyToTime(a.dato));
  const arterSorted = combined.map(x => x.art);
  const matrixSorted = combined.map(x => [x.dato]);
  return {
    arter: arterSorted,
    koder,
    rows,
    matrix: matrixSorted,
    totals
  };
}

function visScoreboardBlockers(data) {
  const blockersDiv = document.getElementById('scoreboard-blockers');
  if (!blockersDiv) return;

  const arter = Array.isArray(data.arter) ? data.arter : [];
  const koder = Array.isArray(data.koder) ? data.koder : [];
  const matrix = Array.isArray(data.matrix) ? data.matrix : [];
  const totals = Array.isArray(data.totals) ? data.totals : [];

  if (!arter.length || !koder.length || !matrix.length) {
    blockersDiv.innerHTML = "";
    return;
  }

  const sortedKoder = sortKoderByPlacering(data);

  // Blockers-lister
  const blockers = {};
  sortedKoder.forEach(k => blockers[k] = []);

  for (let i = 0; i < arter.length; i++) {
    const seenBy = [];
    sortedKoder.forEach(k => {
      const origIdx = koder.indexOf(k);
      if (origIdx >= 0 && matrix[i] && matrix[i][origIdx]) {
        seenBy.push(k);
      }
    });
    if (seenBy.length === 1) {
      blockers[seenBy[0]].push(arter[i]);
    }
  }

  // Seneste 5 kryds pr. kode
  const latestCrossings = {};
  sortedKoder.forEach(kode => {
    const origIdx = koder.indexOf(kode);
    const kryds = [];
    for (let i = 0; i < arter.length; i++) {
      const val = (origIdx >= 0 && matrix[i]) ? matrix[i][origIdx] : null;
      if (val) kryds.push({ art: arter[i], dato: val });
    }
    kryds.sort((a, b) => parseDmyToTime(b.dato) - parseDmyToTime(a.dato));
    latestCrossings[kode] = kryds.slice(0, 5);
  });

  // Tabel
  let head = `<tr>${sortedKoder.map(k => `<th>${k}</th>`).join("")}</tr>`;
 let totalsRow = `<tr>${sortedKoder.map((k, i) => {
  // Brug i som fallback hvis idx ikke findes
  const idx = koder.indexOf(k);
  let tot = '';
  if (idx >= 0 && Array.isArray(totals) && typeof totals[idx] !== 'undefined') {
    tot = totals[idx];
  } else if (Array.isArray(totals) && typeof totals[i] !== 'undefined') {
    tot = totals[i];
  }
  return `<td><b>Antal:</b> ${tot}</td>`;
}).join("")}</tr>`;

  let blockersCountRow = `<tr>${sortedKoder.map(k => `<td><b>Blockers:</b> ${blockers[k].length}</td>`).join("")}</tr>`;
  let blockersListRow = `<tr>${sortedKoder.map(k => {
    return `<td>${blockers[k].length ? blockers[k].join('<br>') : '<span style="color:#888">Ingen</span>'}</td>`;
  }).join("")}</tr>`;
  let latestRow = `<tr>${sortedKoder.map(k => {
    const lines = latestCrossings[k].map(x => `${x.dato}: ${x.art}`).join('<br>');
    return `<td><b>Seneste 5 kryds:</b><br>${lines}</td>`;
  }).join("")}</tr>`;

  const table = `
    <div class="matrix-table-wrap">
      <table class="matrix-table blockers-table" style="margin-top:0px">
        <thead>${head}</thead>
        <tbody>
          ${totalsRow}
          ${blockersCountRow}
          ${blockersListRow}
          ${latestRow}
        </tbody>
      </table>
    </div>`;

  blockersDiv.innerHTML = `<h3>Blockers & Seneste kryds</h3>${table}`;
}

function visScoreboardTrend(data) {
  const trendDiv = document.getElementById('scoreboard-trend');
  if (!trendDiv) return;

  const matrix = Array.isArray(data.matrix) ? data.matrix : [];
  const koder = Array.isArray(data.koder) ? data.koder : [];
  const arter = Array.isArray(data.arter) ? data.arter : [];

  if (!matrix.length || !koder.length || !arter.length) {
    trendDiv.innerHTML = "";
    return;
  }

  const sortedKoder = sortKoderByPlacering(data);

  // Saml alle datoer i matrixen
  const dateSet = new Set();
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < koder.length; j++) {
      const d = matrix[i][j];
      if (d) dateSet.add(d);
    }
  }

  // Sorter dd-mm-yyyy
  const sortedDates = Array.from(dateSet).sort((a, b) => {
    const [da, ma, ya] = a.split('-');
    const [db, mb, yb] = b.split('-');
    return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
  });

  const datasets = sortedKoder.map((kode, idx) => {
    const origIdx = koder.indexOf(kode);
    const seenDates = [];
    for (let i = 0; i < matrix.length; i++) {
      const dato = (origIdx >= 0 && matrix[i]) ? matrix[i][origIdx] : null;
      if (dato) seenDates.push({ art: arter[i], dato });
    }

    const dateCounts = {};
    sortedDates.forEach(d => dateCounts[d] = 0);
    seenDates.forEach(({ dato }) => {
      // Alle datoer >= observationer får +1
      sortedDates.forEach(d => {
        const [dd, mm, yyyy] = d.split('-');
        const [od, om, oyyyy] = dato.split('-');
        const dDate = new Date(`${yyyy}-${mm}-${dd}`);
        const oDate = new Date(`${oyyyy}-${om}-${od}`);
        if (dDate >= oDate) dateCounts[d]++;
      });
    });

    const dataPoints = sortedDates.map(d => dateCounts[d]);
    return {
      label: kode,
      data: dataPoints,
      borderColor: `hsl(${idx * 60},70%,50%)`,
      fill: false,
      tension: 0
    };
  });

  trendDiv.innerHTML = `<h3>Udvikling i sete arter</h3><canvas id="trendChart" height="200"></canvas>`;
  // Chart forudsætter at Chart.js er inkluderet på siden
  if (typeof Chart !== "undefined") {
    new Chart(document.getElementById('trendChart').getContext('2d'), {
      type: 'line',
      data: { labels: sortedDates, datasets },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { title: { display: true, text: 'Dato' } },
          y: { title: { display: true, text: 'Antal arter' }, beginAtZero: true }
        }
      }
    });
  }
}

// Sortér koder efter placering (brug data.rows til mapping)
function sortKoderByPlacering(data) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const koder = Array.isArray(data.koder) ? data.koder : [];
  if (!rows.length || !koder.length) return koder;

  const placeringMap = {};
  rows.forEach(row => placeringMap[row.obserkode] = row.placering);
  return [...koder].sort((a, b) => (placeringMap[a] ?? 999) - (placeringMap[b] ?? 999));
}

// ---------- Filtrering (robust) ----------
function buildFilteredData(selectedKoder) {
  if (!masterData) return null;

  const selectedSet = new Set(selectedKoder);
  // Filtrér rows ud fra master.rows
  const rows = (masterData.rows || []).filter(r => selectedSet.has(r.obserkode));

  // Sortér efter placering for konsistent visning/kolonner
  rows.sort((a, b) => (a.placering ?? 999) - (b.placering ?? 999));

  // Koder i samme rækkefølge som rows
  const koder = rows.map(r => r.obserkode);

  // Map til originale kolonneindekser (fra masterData.koder)
  const colIdxs = koder.map(k => masterData.koder.indexOf(k)).filter(idx => idx >= 0);

  // Skær matrix og totals ud efter korrekte kolonner
  const matrix = (masterData.matrix || []).map(r => colIdxs.map(idx => r[idx]));
  const totals = colIdxs.map(idx => (masterData.totals ? masterData.totals[idx] : null));

  return {
    arter: masterData.arter ? [...masterData.arter] : [],
    rows,
    koder,
    matrix,
    totals
  };
}

function filtrerScoreboardPåKoder(valgteKoder, params) {
  const container = document.getElementById("main");
  const filtered = buildFilteredData(valgteKoder);
  if (!filtered) return;

  if (!filtered.rows.length) {
    container.innerHTML = `<p>Ingen brugere fundet for det valgte filter.</p>`;
    tilføjGruppeFilterKnappen(filtered, params, container);

    // Ryd/vis tomme sektioner
    visScoreboardMatrix({ arter: [], koder: [], matrix: [] });
    visScoreboardBlockers({ arter: [], koder: [], matrix: [], totals: [] });
    visScoreboardTrend({ arter: [], koder: [], matrix: [] });
    return;
  }

  // Cards
  container.innerHTML = filtered.rows.map(row => `
    <div class="user-card" data-obserkode="${row.obserkode}">
      <strong>#${row.placering} ${row.navn}</strong><br>
      Antal arter: ${row.antal_arter}<br>
      Sidste art: ${row.sidste_art ? row.sidste_art + (row.sidste_dato ? " (" + row.sidste_dato + ")" : "") : ""}
    </div>
  `).join("");

  // Filter-knap igen
  tilføjGruppeFilterKnappen(filtered, params, container);

  // Sektioner
  visScoreboardMatrix(filtered);
  visScoreboardBlockers(filtered);
  visScoreboardTrend(filtered);

  // Klik på bruger
  container.querySelectorAll('.user-card').forEach(card => {
    card.onclick = async function () {
      const kode = this.getAttribute('data-obserkode');
      const navn = this.querySelector('strong').innerText;
      firstsSortMode = "alphabetical";
      await visUserFirsts(kode, navn, firstsSortMode, params);
    };
  });
}

// ---------- Filter-knap & modal ----------
function tilføjGruppeFilterKnappen(data, params, container) {
  // Undgå duplikat
  const existing = container.querySelector('#gruppeFilterBtn');
  if (existing) existing.remove();
  const existingYearWrap = container.querySelector('#yearSelectWrap');
  if (existingYearWrap) existingYearWrap.remove();
  const existingRow = container.querySelector('#scoreboard-year-row');
  if (existingRow) existingRow.remove();

  const filterBtn = document.createElement("button");
  filterBtn.id = "gruppeFilterBtn";
  filterBtn.textContent = "Filtrer medlemmer";
  filterBtn.style.margin = "1em 0";
  filterBtn.onclick = () => visGruppeFilterModal(data, params);

  // Wrap i centreret div
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.justifyContent = "center";
  wrapper.style.gap = "0.75em";
  wrapper.style.flexWrap = "wrap";
  wrapper.appendChild(filterBtn);

  const yearSelector = createYearSelector(params);
  if (yearSelector) wrapper.appendChild(yearSelector);

  container.prepend(wrapper);
}

function visGruppeFilterModal(_data, params) {
  if (!masterData) return;

  // Modal baggrund
  const modalBg = document.createElement("div");
  modalBg.style.position = "fixed";
  modalBg.style.top = 0;
  modalBg.style.left = 0;
  modalBg.style.width = "100vw";
  modalBg.style.height = "100vh";
  modalBg.style.background = "rgba(0,0,0,0.3)";
  modalBg.style.zIndex = 1000;

  // Modal boks
  const modal = document.createElement("div");
  modal.style.background = "#fff";
  modal.style.padding = "2em";
  modal.style.borderRadius = "10px";
  modal.style.maxWidth = "380px";
  modal.style.margin = "5vh auto";
  modal.style.position = "relative";
  modal.style.top = "10vh";
  modal.style.boxShadow = "0 2px 16px rgba(0,0,0,0.15)";
  modal.innerHTML = `<h3>Vælg medlemmer</h3>`;

  const allRows = masterData.rows || [];
  const defaultSelection = lastSelectedKoder || (_data.koder && _data.koder.length ? _data.koder : allRows.map(r => r.obserkode));
  const currentSelection = new Set(defaultSelection);

  modal.innerHTML += `
    <div style="display:flex; gap:.5em; margin:.5em 0 1em">
      <button id="selectAllBtn" style="flex:1">Vælg alle</button>
      <button id="clearAllBtn" style="flex:1">Fravælg alle</button>
    </div>
  `;

  allRows.forEach(row => {
    modal.innerHTML += `
      <label style="display:block;margin-bottom:0.5em;">
        <input type="checkbox" class="kode-filter" value="${row.obserkode}" ${currentSelection.has(row.obserkode) ? "checked" : ""}>
        ${row.navn}
      </label>
    `;
  });

  modal.innerHTML += `
    <div style="display:flex; gap:0.5em; margin-top:1.5em; justify-content:flex-end;">
      <button id="applyFilterBtn" style="flex:1; padding:0.6em 0.8em; border-radius:6px; border:1px solid #007bff; background:#007bff; color:#fff; font-weight:bold; cursor:pointer;">Vis valgte</button>
      <button id="resetFilterBtn" style="flex:1; padding:0.6em 0.8em; border-radius:6px; border:1px solid #6c757d; background:#f8f9fa; color:#333; font-weight:bold; cursor:pointer;">Nulstil</button>
      <button id="closeFilterBtn" style="flex:1; padding:0.6em 0.8em; border-radius:6px; border:1px solid #dc3545; background:#fff; color:#dc3545; font-weight:bold; cursor:pointer;">Luk</button>
    </div>
  `;

  modalBg.appendChild(modal);
  document.body.appendChild(modalBg);

  // Bind events lokalt i modalen (undgår null/ID-kollisioner)
  const selectAllBtn = modal.querySelector('#selectAllBtn');
  const clearAllBtn = modal.querySelector('#clearAllBtn');
  const applyBtn = modal.querySelector('#applyFilterBtn');
  const resetBtn = modal.querySelector('#resetFilterBtn');
  const closeBtn = modal.querySelector('#closeFilterBtn');

  if (!selectAllBtn || !clearAllBtn || !applyBtn || !resetBtn || !closeBtn) {
    console.warn('Filter-modal: knapperne blev ikke oprettet som forventet.');
    modalBg.remove();
    return;
  }

  selectAllBtn.addEventListener('click', () => {
    modal.querySelectorAll('.kode-filter').forEach(cb => (cb.checked = true));
  });

  clearAllBtn.addEventListener('click', () => {
    modal.querySelectorAll('.kode-filter').forEach(cb => (cb.checked = false));
  });

  closeBtn.addEventListener('click', () => modalBg.remove());

  resetBtn.addEventListener('click', () => {
    const alleKoder = (masterData.rows || []).map(r => r.obserkode);
    lastSelectedKoder = alleKoder;
    modalBg.remove();
    filtrerScoreboardPåKoder(alleKoder, params);
  });

  applyBtn.addEventListener('click', () => {
    const checked = Array.from(modal.querySelectorAll('.kode-filter:checked')).map(cb => cb.value);
    lastSelectedKoder = checked.length ? checked : [];
    modalBg.remove();
    filtrerScoreboardPåKoder(checked, params);
  });
}

// ---------- Lifecycle ----------
window.onload = visSide;
window.onpopstate = visSide;
