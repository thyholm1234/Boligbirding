// Version: 1.3.63 - 2026-01-05 14.37.38
// © Christian Vemmelund Helligsø
import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';

renderNavbar();
initNavbar();
initMobileNavbar()

let lastScoreboardParams = null;

// Hent grupper og vis dem i dropdowns
fetch('/api/get_grupper')
    .then(res => res.json())
    .then(grupper => {
      addGruppeLinks(grupper);
    });

// --- Hjælpefunktion: Læs parametre fra URL ---
function getParams() {
  const params = {};
  window.location.search.substring(1).split("&").forEach(pair => {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return params;
}

// --- Hent data fra API ---
async function hentData(params) {
  let url, body;
  if (params.scope && params.scope.startsWith("user_")) {
      url = "/api/obser";
      body = params;
  } else if (params.scope && params.scope.startsWith("gruppe_")) {
      url = "/api/gruppe_scoreboard";
      body = {
        navn: params.gruppe,
        scope: params.scope,
        aar: params.aar // hvis du vil understøtte år
      };
  } else {
      url = "/api/scoreboard";
      body = params;
  }
  const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
  });
  return await res.json();
}

// --- Vis side dynamisk ---
async function visSide() {
  const params = getParams();
  const data = await hentData(params);
  const container = document.getElementById("main");
  const pageTitle = document.getElementById("page-title");

  // Scoreboard
  if (!params.scope || !params.scope.startsWith("user_")) {
    lastScoreboardParams = params; // Gemmer hovedliste-parametre
    const rows = data.rows || [];
    let title = "";
    if (params.scope === "global_alle") {
    title = "National rangliste";
    } else if (params.scope === "global_matrikel") {
    title = "National matrikel-rangliste";
    } else if (params.scope === "gruppe_alle") {
    title = (params.gruppe ? params.gruppe + " – Rangliste" : "Gruppe – Rangliste");
    } else if (params.scope === "gruppe_matrikel") {
    title = (params.gruppe ? params.gruppe + " – Matrikel-rangliste" : "Gruppe – Matrikel-rangliste");
    } else if (params.scope === "lokal_alle") {
    title = (params.afdeling ? params.afdeling + " – Rangliste" : "Lokalafdeling – Rangliste");
    } else if (params.scope === "lokal_matrikel") {
    title = (params.afdeling ? params.afdeling + " – Matrikel-rangliste" : "Lokalafdeling – Matrikel-rangliste");
    } else {
    title = "Scoreboard";
    }
    pageTitle.textContent = title;

    // Ombryd page-title på mobil
    if (window.matchMedia("(max-width: 600px)").matches) {
      // Find første " – " eller " - " eller " Matrikel-rangliste"/" Rangliste"
      let splitIdx = title.indexOf(" – ");
      if (splitIdx === -1) splitIdx = title.indexOf(" - ");
      if (splitIdx === -1 && title.includes(" Matrikel-rangliste")) splitIdx = title.indexOf(" Matrikel-rangliste");
      if (splitIdx === -1 && title.includes(" Rangliste")) splitIdx = title.indexOf(" Rangliste");
      if (splitIdx > 0) {
        const first = title.slice(0, splitIdx).trim();
        const rest = title.slice(splitIdx).replace(/^(\s*[-–]\s*)?/, '').trim();
        pageTitle.innerHTML = `<span style="display:block;word-break:break-word;">${first}</span><span style="display:block;word-break:break-word;">${rest}</span>`;
      } else {
        pageTitle.innerHTML = `<span style="display:block;word-break:break-word;">${title}</span>`;
      }
      // Forhindr bindestreg
      pageTitle.style.hyphens = "manual";
      pageTitle.style.wordBreak = "break-word";
      pageTitle.style.overflowWrap = "break-word";
    } else {
      // Desktop: behold normal tekst
      pageTitle.innerHTML = "";
      pageTitle.textContent = title;
      pageTitle.style.hyphens = "";
      pageTitle.style.wordBreak = "";
      pageTitle.style.overflowWrap = "";
    }

    if (!rows.length) {
      container.innerHTML = "<p>Ingen brugere fundet.</p>";
      return;
    }
    let html = "";
    rows.forEach(row => {
      html += `
        <div class="user-card" data-obserkode="${row.obserkode}">
          <strong>#${row.placering} ${row.navn}</strong><br>
          Antal arter: ${row.antal_arter}<br>
          Sidste art: ${row.sidste_art ? row.sidste_art + (row.sidste_dato ? " (" + row.sidste_dato + ")" : "") : ""}
        </div>
      `;
    });
    container.innerHTML = html;

    // Tilføj disse tre linjer:
    visScoreboardMatrix(data);
    visScoreboardBlockers(data);
    visScoreboardTrend(data);

    // Klik på bruger viser deres liste i main
    document.querySelectorAll('.user-card').forEach(card => {
      card.onclick = async function() {
        const kode = this.getAttribute('data-obserkode');
        const navn = this.querySelector('strong').innerText;
        firstsSortMode = "alphabetical";
        await visUserFirsts(kode, navn, firstsSortMode, lastScoreboardParams);
      };
    });
  }
  // Brugerliste
  else {
    // Læs sortering fra URL hvis angivet
    firstsSortMode = params.sort || "alphabetical";
    await visUserFirsts(params.obserkode, params.navn || "", firstsSortMode);
  }
}

let firstsSortMode = "alphabetical"; // "alphabetical" | "newest" | "oldest"

// --- Render brugerliste direkte i main ---
async function visUserFirsts(obserkode, navn, sortMode = firstsSortMode, parentParams = {}) {
  // Find scope og evt. gruppe/afdeling fra parentParams
  const scope = parentParams.scope || 'global_alle';
  const gruppe = parentParams.gruppe;
  const afdeling = parentParams.afdeling;

  // Find korrekt API-scope til /api/obser
  let apiScope = "user_global";
  let body = { scope: apiScope, obserkode };

  if (scope.endsWith("matrikel")) {
    apiScope = "user_matrikel";
    body.scope = apiScope;
  } else if (scope.startsWith("lokal")) {
    apiScope = "user_lokalafdeling";
    body.scope = apiScope;
    if (afdeling) body.afdeling = afdeling;
  }

  // Opdater URL'en
  const urlParams = new URLSearchParams({
    scope: apiScope,
    obserkode: obserkode,
    navn: navn,
    sort: sortMode
  });
  if (gruppe) urlParams.set('gruppe', gruppe);
  if (afdeling) urlParams.set('afdeling', afdeling);
  window.history.pushState({}, '', '?' + urlParams.toString());

  // Hent data fra API
  const res = await fetch('/api/obser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const firsts = data.firsts || [];
  const container = document.getElementById("main");
  const pageTitle = document.getElementById("page-title");
  let visNavn = navn && !navn.startsWith("#") ? navn : obserkode;
  let prefix = "Første observationer for ";
  if (apiScope === "user_global") prefix = "Årsarter for ";
  if (apiScope === "user_lokalafdeling") prefix = "Lokalarter for ";
  if (apiScope === "user_matrikel") prefix = "Matrikelarter for ";
  pageTitle.textContent = prefix + visNavn;

  // Tilføj underrubrik for lokalafdeling
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

  // Sorteringsknap
  let sortLabel = "";
  if (sortMode === "alphabetical") sortLabel = "Alfabetisk";
  if (sortMode === "newest") sortLabel = "Nyeste";
  if (sortMode === "oldest") sortLabel = "Ældste";

  let html = `
    <button id="sortBtn" style="margin-bottom:1em;">Sortering: ${sortLabel}</button>
  `;

  if (!firsts.length) {
    html += "<p>Ingen observationer fundet.</p><button id='tilbageBtn'>Tilbage</button>";
    container.innerHTML = html;
  } else {
    html += `<div id="firstsCards"></div><button id="tilbageBtn">Tilbage</button>`;
    container.innerHTML = html;
    renderFirsts(firsts, sortMode);
  }

    document.getElementById('tilbageBtn').onclick = () => {
    // Gå tilbage til det oprindelige scoreboard (kun scope, gruppe, afdeling, aar)
    if (parentParams) {
        const url = new URL(window.location.pathname, window.location.origin);
        // Kun relevante parametre til scoreboard
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

  document.getElementById('sortBtn').onclick = function() {
    // Three-state toggle
    if (sortMode === "alphabetical") sortMode = "newest";
    else if (sortMode === "newest") sortMode = "oldest";
    else sortMode = "alphabetical";
    firstsSortMode = sortMode;
    visUserFirsts(obserkode, navn, sortMode, parentParams);
  };
}

// Hjælpefunktion til at sortere og vise cards
function renderFirsts(firsts, sortMode) {
  let sorted = [...firsts];
  if (sortMode === "alphabetical") {
    sorted.sort((a, b) => a.artnavn.localeCompare(b.artnavn));
  } else if (sortMode === "newest") {
    sorted.sort((a, b) => b.dato.localeCompare(a.dato));
  } else if (sortMode === "oldest") {
    sorted.sort((a, b) => a.dato.localeCompare(b.dato));
  }
  const cards = sorted.map(f => `
    <div class="user-card">
      <strong>${f.artnavn}</strong><br>
      Lokalitet: ${f.lokalitet}<br>
      Dato: ${f.dato}
    </div>
  `).join("");
  document.getElementById("firstsCards").innerHTML = cards;
}

function visScoreboardMatrix(data) {
  const matrixDiv = document.getElementById('scoreboard-matrix');
  if (!data.arter.length || !data.koder.length) return;
  const sortedKoder = sortKoderByPlacering(data);

  let html = `<div class="matrix-table-wrap"><table class="matrix-table"><thead><tr>`;
  html += `<th>#</th><th style="white-space:nowrap;">Art</th>`;
  sortedKoder.forEach(k => html += `<th>${k}</th>`);
  html += `</tr></thead><tbody>`;

  for (let i = 0; i < data.arter.length; i++) {
    // Tæl hvor mange brugere har en dato på denne art
    let antalObservationer = 0;
    sortedKoder.forEach((k, j) => {
      const origIdx = data.koder.indexOf(k);
      if (data.matrix[i][origIdx]) antalObservationer++;
    });
    // Sæt farveklasse ud fra antal observationer
    let rowClass = "";
    if (antalObservationer >= 8) rowClass = "bg-green";
    else if (antalObservationer >= 5) rowClass = "bg-lightgreen";
    else if (antalObservationer >= 2) rowClass = "bg-orange";
    else rowClass = "bg-red";

    html += `<tr class="${rowClass}"><td>${i+1}</td><td>${data.arter[i]}</td>`;
    sortedKoder.forEach((k, j) => {
      const origIdx = data.koder.indexOf(k);
      const val = data.matrix[i][origIdx] || "";
      html += `<td>${val}</td>`;
    });
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  matrixDiv.innerHTML = `<h3>Matrix</h3>${html}`;
}

function visScoreboardBlockers(data) {
  const blockersDiv = document.getElementById('scoreboard-blockers');
  if (!data.arter.length || !data.koder.length) {
    blockersDiv.innerHTML = "";
    return;
  }
  const sortedKoder = sortKoderByPlacering(data);
  // Blockers
  const blockers = {};
  sortedKoder.forEach(kode => blockers[kode] = []);
  for (let i = 0; i < data.arter.length; i++) {
    const seenBy = [];
    sortedKoder.forEach((k, j) => {
      const origIdx = data.koder.indexOf(k);
      if (data.matrix[i][origIdx]) seenBy.push(k);
    });
    if (seenBy.length === 1) {
      blockers[seenBy[0]].push(data.arter[i]);
    }
  }
  // Seneste 5 kryds
  const latestCrossings = {};
  sortedKoder.forEach((kode, j) => {
    const origIdx = data.koder.indexOf(kode);
    const kryds = [];
    for (let i = 0; i < data.arter.length; i++) {
      const val = data.matrix[i][origIdx];
      if (val) kryds.push({ art: data.arter[i], dato: val });
    }
    kryds.sort((a, b) => b.dato.localeCompare(a.dato));
    latestCrossings[kode] = kryds.slice(0, 5);
  });
  // Tabel
  let html = `<table><thead><tr>`;
  sortedKoder.forEach(k => html += `<th>${k}</th>`);
  html += `</tr></thead><tbody><tr>`;
  sortedKoder.forEach(k => {
    const origIdx = data.koder.indexOf(k);
    html += `<td><b>Antal:</b> ${data.totals[origIdx]}</td>`;
  });
  html += `</tr><tr>`;
  sortedKoder.forEach(k => html += `<td><b>Blockers:</b> ${blockers[k].length}</td>`);
  html += `</tr><tr>`;
  sortedKoder.forEach(k => html += `<td>${blockers[k].length ? blockers[k].join('<br>') : '<span style="color:#888">Ingen</span>'}</td>`);
  html += `</tr><tr>`;
  sortedKoder.forEach(k => {
    html += `<td><b>Seneste 5 kryds:</b><br>`;
    latestCrossings[k].forEach(kryds => {
      html += `${kryds.dato}: ${kryds.art}<br>`;
    });
    html += `</td>`;
  });
  html += `</tr></tbody></table>`;
  blockersDiv.innerHTML = `<h3>Blockers & Seneste kryds</h3>
    <div class="matrix-table-wrap">
    <table class="matrix-table blockers-table" style="margin-top:0px">${html}</table>
    </div>`;
}

function visScoreboardTrend(data) {
  const trendDiv = document.getElementById('scoreboard-trend');
  if (!data.matrix || !data.koder || !data.arter) {
    trendDiv.innerHTML = "";
    return;
  }
  const sortedKoder = sortKoderByPlacering(data);

  // Find alle datoer i matrixen
  const dateSet = new Set();
  for (let i = 0; i < data.matrix.length; i++) {
    for (let j = 0; j < data.koder.length; j++) {
      const dato = data.matrix[i][j];
      if (dato) dateSet.add(dato);
    }
  }
  const sortedDates = Array.from(dateSet).sort((a, b) => {
    // dd-mm-yyyy sortering
    const [da, ma, ya] = a.split('-');
    const [db, mb, yb] = b.split('-');
    return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
  });

  // For hver kode, lav et array med antal arter set pr. dato
  const datasets = sortedKoder.map((kode, idx) => {
    const origIdx = data.koder.indexOf(kode);
    // For hver dato, tæl hvor mange arter brugeren har set indtil da
    const seenDates = [];
    for (let i = 0; i < data.matrix.length; i++) {
      const dato = data.matrix[i][origIdx];
      if (dato) seenDates.push({ art: data.arter[i], dato });
    }
    // Byg en cumulative count for hver dato
    const dateCounts = {};
    sortedDates.forEach(d => dateCounts[d] = 0);
    seenDates.forEach(({ dato }) => {
      // Alle datoer >= observationen får +1
      sortedDates.forEach(d => {
        const [dd, mm, yyyy] = d.split('-');
        const [od, om, oyyyy] = dato.split('-');
        const dDate = new Date(`${yyyy}-${mm}-${dd}`);
        const oDate = new Date(`${oyyyy}-${om}-${od}`);
        if (dDate >= oDate) dateCounts[d]++;
      });
    });
    // Byg array med cumulative antal arter for hver dato
    const dataPoints = sortedDates.map(d => dateCounts[d]);
    return {
      label: kode,
      data: dataPoints,
      borderColor: `hsl(${idx*60},70%,50%)`,
      fill: false,
      tension: 0
    };
  });

  trendDiv.innerHTML = `<h3>Udvikling i sete arter</h3><canvas id="trendChart" height="200"></canvas>`;

  new Chart(document.getElementById('trendChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: sortedDates,
      datasets: datasets
    },
    options: {
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: 'Dato' } },
        y: { title: { display: true, text: 'Antal arter' }, beginAtZero: true }
      }
    }
  });
}

function sortKoderByPlacering(data) {
  if (!data.rows || !data.koder) return data.koder;
  // Lav mapping fra obserkode til placering
  const placeringMap = {};
  data.rows.forEach(row => placeringMap[row.obserkode] = row.placering);
  // Sorter koder efter placering
  return [...data.koder].sort((a, b) => (placeringMap[a] || 999) - (placeringMap[b] || 999));
}

window.onload = visSide;
window.onpopstate = visSide;