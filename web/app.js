// Version: 1.1.25 - 2026-01-02 14.29.54
// © Christian Vemmelund Helligsø
function visMatrix(data, sortMode = "alphabetical", kodeFilter = null) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = "";

    // --- GRAF ---
    hentLeadChart(kodeFilter);

    // --- Blockers og seneste kryds tabel ---
    // Sæt blockersDiv INDEN matrix og knapper
    let blockersDiv = document.getElementById('blockersTabel');
    if (!blockersDiv) {
        blockersDiv = document.createElement('div');
        blockersDiv.id = 'blockersTabel';
    }
    // Indsæt blockersDiv øverst i resultDiv
    resultDiv.appendChild(blockersDiv);
    visBlockersTabel(kodeFilter);

    // --- Sorteringsknap ---
    let sortBtn = document.getElementById('sortBtn');
    if (!sortBtn) {
        sortBtn = document.createElement('button');
        sortBtn.id = "sortBtn";
        sortBtn.style.marginBottom = "8px";
        sortBtn.textContent = "Sortér: Alfabetisk";
        resultDiv.appendChild(sortBtn);
    }

    // --- Filterknap ---
    let filterBtn = document.getElementById('kodeFilterBtn');
    if (!filterBtn) {
        filterBtn = document.createElement('button');
        filterBtn.id = "kodeFilterBtn";
        filterBtn.style.marginLeft = "8px";
        filterBtn.style.marginBottom = "8px";
        filterBtn.textContent = "Filtrer obserkoder";
        resultDiv.appendChild(filterBtn);
    }

    // --- Modal til kodefilter ---
    let modal = document.getElementById('kodeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = "kodeModal";
        modal.style.display = "none";
        modal.style.position = "fixed";
        modal.style.left = "0";
        modal.style.top = "0";
        modal.style.width = "100vw";
        modal.style.height = "100vh";
        modal.style.background = "rgba(0,0,0,0.3)";
        modal.style.zIndex = "1000";
        modal.innerHTML = `
            <div style="background:#fff;max-width:350px;margin:80px auto;padding:20px;border-radius:8px;box-shadow:0 2px 12px #0003;position:relative">
                <h3>Vælg obserkoder</h3>
                <form id="kodeForm" style="max-height:300px;overflow:auto;margin-bottom:12px"></form>
                <button id="kodeModalOk">OK</button>
                <button id="kodeModalCancel" type="button" style="margin-left:8px">Annullér</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // --- Sortering ---
    let indices = [...Array(data.arter.length).keys()];
    if (sortMode === "alphabetical") {
        indices.sort((a, b) => data.arter[a].localeCompare(data.arter[b], 'da'));
    } else if (sortMode === "latest") {
        indices.sort((a, b) => {
            function getLatest(idx) {
                let dates = data.matrix[idx]
                    .map(val => {
                        if (!val) return null;
                        // DD-MM-YYYY eller YYYY-MM-DD
                        if (val.match(/^\d{2}-\d{2}-\d{4}$/)) {
                            const [dd, mm, yyyy] = val.split('-');
                            return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                        } else if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            const [yyyy, mm, dd] = val.split('-');
                            return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                        }
                        return new Date(val);
                    })
                    .filter(d => d && !isNaN(d));
                if (!dates.length) return new Date(0); // meget gammel hvis ingen dato
                return new Date(Math.max(...dates.map(d => d.getTime())));
            }
            return getLatest(b) - getLatest(a);
        });
    }

    // --- Matrix tabel ---
    const table = document.createElement('table');
    // Header
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    // Filtrer koder hvis kodeFilter er sat
    let koderVis = data.koder;
    let koderIdx = data.koder.map((k, i) => i);
    if (kodeFilter && kodeFilter.length > 0) {
        koderVis = data.koder.filter((k, i) => kodeFilter.includes(k));
        koderIdx = data.koder.map((k, i) => kodeFilter.includes(k) ? i : -1).filter(i => i !== -1);
    }
    hrow.innerHTML = `<th style="width:32px">#</th><th>Art</th>` + koderVis.map((k, idx) => `<th class="obserkode" data-idx="${koderIdx[idx]}" style="cursor:pointer">${k}</th>`).join('');
    thead.appendChild(hrow);

    // Total-række (direkte under header)
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td></td><td><b>Total</b></td>` + koderIdx.map(i => `<td><b>${data.totals[i]}</b></td>`).join('');
    thead.appendChild(totalRow);

    // Tid brugt-række
    const tidRow = document.createElement('tr');
    tidRow.innerHTML = `<td></td><td><b>Tid brugt</b></td>` + koderIdx.map(i => `<td>${(data.tid_brugt || data.tid_brugt_minutter || [])[i] || ""}</td>`).join('');
    thead.appendChild(tidRow);

    // Antal ture-række
    const tureRow = document.createElement('tr');
    tureRow.innerHTML = `<td></td><td><b>Antal lister</b></td>` + koderIdx.map(i => `<td>${(data.antal_observationer || [])[i] || ""}</td>`).join('');
    thead.appendChild(tureRow);

    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (let n = 0; n < indices.length; n++) {
        const i = indices[n];
        // Hvis der er kodeFilter, så tjek om rækken har mindst én observation i de viste koder
        let hasObs = true;
        if (koderIdx.length > 0 && koderIdx.length !== data.koder.length) {
            hasObs = koderIdx.some(j => data.matrix[i][j]);
        }
        if (!hasObs) continue; // spring rækker uden obs over

        const row = document.createElement('tr');
        row.innerHTML = `<td style="text-align:center;width:32px">${n + 1}</td><td>${data.arter[i]}</td>`;
        for (let idx = 0; idx < koderIdx.length; idx++) {
            let j = koderIdx[idx];
            let val = data.matrix[i][j];
            let seen = data.matrix[i].filter(x => x).length;
            let color = "";
            if (seen === 1) color = "bg-red";
            else if (seen === 2) color = "bg-orange";
            else if (seen === 3) color = "bg-green";
            else if (seen >= 4) color = "bg-lightgreen";
            row.innerHTML += `<td class="${color}">${val || ""}</td>`;
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    resultDiv.appendChild(table);

    // --- Filterfunktion ---
    let selectedKodeIdx = null;
    table.querySelectorAll('.obserkode').forEach(th => {
        th.addEventListener('click', function () {
            const idx = Number(this.dataset.idx);
            if (selectedKodeIdx === idx) {
                // Fjern filter
                selectedKodeIdx = null;
                Array.from(tbody.rows).forEach(row => row.style.display = "");
                table.querySelectorAll('.obserkode').forEach(th2 => th2.style.background = "");
                // Vis alle kolonner igen
                Array.from(tbody.rows).forEach(row => {
                    for (let i = 2; i < row.cells.length; i++) {
                        row.cells[i].style.display = "";
                    }
                });
                table.querySelectorAll('thead tr').forEach(tr => {
                    for (let i = 2; i < tr.cells.length; i++) {
                        tr.cells[i].style.display = "";
                    }
                });
                // Opdater grafen med nuværende kodeFilter
                hentLeadChart(kodeFilter);
            } else {
                selectedKodeIdx = idx;
                // Marker valgt kode
                table.querySelectorAll('.obserkode').forEach(th2 => th2.style.background = "");
                this.style.background = "#ffe";
                // Vis kun kolonne for valgt kode, skjul de andre
                table.querySelectorAll('thead tr').forEach(tr => {
                    for (let i = 2; i < tr.cells.length; i++) {
                        tr.cells[i].style.display = (i === 2 + koderIdx.indexOf(idx)) ? "" : "none";
                    }
                });
                Array.from(tbody.rows).forEach(row => {
                    // Skjul alle kolonner undtagen valgt kode
                    for (let i = 2; i < row.cells.length; i++) {
                        row.cells[i].style.display = (i === 2 + koderIdx.indexOf(idx)) ? "" : "none";
                    }
                    // Skjul rækker uden obs i valgt kode
                    const cell = row.cells[2 + koderIdx.indexOf(idx)];
                    if (cell && cell.textContent.trim()) {
                        row.style.display = "";
                    } else {
                        row.style.display = "none";
                    }
                });
                // Opdater grafen med kun denne kode
                hentLeadChart([data.koder[idx]]);
            }
        });
    });

    // --- Sorteringsknap event ---
    sortBtn.onclick = () => {
        if (sortBtn.dataset.mode === "latest") {
            sortBtn.textContent = "Sortér: Alfabetisk";
            sortBtn.dataset.mode = "alphabetical";
            visMatrix(data, "alphabetical", kodeFilter);
        } else {
            sortBtn.textContent = "Sortér: Nyeste observation";
            sortBtn.dataset.mode = "latest";
            visMatrix(data, "latest", kodeFilter);
        }
    };
    // Sæt initial state
    sortBtn.dataset.mode = sortMode;
    sortBtn.textContent = sortMode === "latest" ? "Sortér: Nyeste observation" : "Sortér: Alfabetisk";

    // --- Filterknap event ---
    filterBtn.onclick = () => {
        modal.style.display = "block";
        // Udfyld form med koder og flueben
        const kodeForm = modal.querySelector('#kodeForm');
        kodeForm.innerHTML = "";
        data.koder.forEach((kode, i) => {
            // Hent preferencer fra localStorage
            let kodePrefs = [];
            try {
                kodePrefs = JSON.parse(localStorage.getItem('kodeFilterPrefs') || "[]");
            } catch {}
            const checked = (!kodeFilter && (!kodePrefs.length || kodePrefs.includes(kode))) || (kodeFilter && kodeFilter.includes(kode)) ? "checked" : "";
            kodeForm.innerHTML += `<label style="display:block;margin-bottom:4px"><input type="checkbox" name="kode" value="${kode}" ${checked}> ${kode}</label>`;
        });
    };

    // Luk modal hvis klik udenfor
    modal.onclick = e => {
        if (e.target === modal) modal.style.display = "none";
    };
    // OK/Annullér knapper
    modal.querySelector('#kodeModalOk').onclick = () => {
        const checked = Array.from(modal.querySelectorAll('input[name="kode"]:checked')).map(cb => cb.value);
        // Gem preferencer i localStorage
        localStorage.setItem('kodeFilterPrefs', JSON.stringify(checked));
        modal.style.display = "none";
        visMatrix(
            data,
            sortBtn.dataset.mode || "alphabetical",
            checked.length === data.koder.length ? null : checked
        );
        // Opdater grafen med valgte koder
        hentLeadChart(checked.length === data.koder.length ? null : checked);
    };
    modal.querySelector('#kodeModalCancel').onclick = () => {
        modal.style.display = "none";
    };

    // --- Hent filter preferencer fra localStorage ved første load ---
    if (!kodeFilter) {
        try {
            const kodePrefs = JSON.parse(localStorage.getItem('kodeFilterPrefs') || "[]");
            if (kodePrefs.length && kodePrefs.length !== data.koder.length) {
                setTimeout(() => {
                    visMatrix(data, sortMode, kodePrefs);
                    hentLeadChart(kodePrefs);
                }, 0);
                return;
            }
        } catch {}
    }

    // Opdater grafen ved første load
    hentLeadChart(kodeFilter);
    visBlockersTabel(kodeFilter);
}

async function hentMatrixMedPolling(maxTries = 10) {
    const resultDiv = document.getElementById('result');
    let tries = 0;
    while (tries < maxTries) {
        resultDiv.textContent = "Henter data...";
        const url = `/matrix`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.arter.length > 0 && data.koder.length > 0) {
            visMatrix(data);
            return;
        }
        tries++;
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    resultDiv.textContent = "Ingen data fundet (prøv igen senere)";
}

// Sæt theme ved load
window.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    hentMatrixMedPolling();
    hentLeadChart();
});

// --- GRAF: Hvem fører dag for dag ---

async function hentLeadChart(kodeFilter = null) {
    const res = await fetch('/matrix');
    const data = await res.json();
    if (!data.arter.length || !data.koder.length) return;

    // Hent år fra backend
    const yearRes = await fetch('/get_year');
    const yearData = await yearRes.json();
    const year = yearData.year;

    // Filtrer koder hvis kodeFilter er sat
    let koderVis = data.koder;
    let koderIdx = data.koder.map((k, i) => i);
    if (kodeFilter && kodeFilter.length > 0) {
        koderVis = data.koder.filter((k, i) => kodeFilter.includes(k));
        koderIdx = data.koder.map((k, i) => kodeFilter.includes(k) ? i : -1).filter(i => i !== -1);
    }

    // Byg dag-for-dag stilling
    const start = new Date(year, 0, 1);
    const today = new Date();
    let end;
    if (year === today.getFullYear()) {
        end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    } else {
        end = new Date(year, 11, 31);
    }
    const days = [];
    let d = new Date(start);
    while (d <= end) {
        days.push(new Date(d.getTime()));
        d.setDate(d.getDate() + 1);
    }

    // For hver kode, lav et set af arter set til og med hver dag
    const kodeIndex = {};
    data.koder.forEach((k, i) => kodeIndex[k] = i);
    // Lav lookup: [art][kode] = dato
    const artKodeDato = {};
    for (let i = 0; i < data.arter.length; i++) {
        for (let j = 0; j < data.koder.length; j++) {
            const val = data.matrix[i][j];
            if (val) {
                if (!artKodeDato[data.arter[i]]) artKodeDato[data.arter[i]] = {};
                artKodeDato[data.arter[i]][data.koder[j]] = val;
            }
        }
    }
    // For hver kode, for hver dag: hvor mange arter er set til og med denne dag?
    const dagligePoints = {};
    koderVis.forEach(k => dagligePoints[k] = []);
    days.forEach(day => {
        koderVis.forEach((kode, kodeIdx2) => {
            let count = 0;
            for (const art in artKodeDato) {
                const datoStr = artKodeDato[art][kode];
                if (datoStr) {
                    let artDate;
                    if (datoStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
                        // DD-MM-YYYY
                        const [dd, mm, yyyy] = datoStr.split('-');
                        artDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                    } else if (datoStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        // YYYY-MM-DD
                        const [yyyy, mm, dd] = datoStr.split('-');
                        artDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                    } else {
                        artDate = new Date(datoStr); // fallback
                    }
                    if (isNaN(artDate)) {
                        console.log("Invalid date:", datoStr);
                    }
                    if (sameOrBefore(artDate, day)) count++;
                }
            }
            dagligePoints[kode].push(count);
        });
    });

    function sameOrBefore(a, b) {
        return (
            a.getFullYear() < b.getFullYear() ||
            (a.getFullYear() === b.getFullYear() && a.getMonth() < b.getMonth()) ||
            (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() <= b.getDate())
        );
    }

    // Find hvem der fører hver dag
    const leaders = [];
    days.forEach((_, idx) => {
        let max = -1, leader = [];
        koderVis.forEach(kode => {
            const val = dagligePoints[kode][idx];
            if (val > max) {
                max = val;
                leader = [kode];
            } else if (val === max) {
                leader.push(kode);
            }
        });
        leaders.push(leader.length === 1 ? leader[0] : leader.join(','));
    });

    // Tegn grafen
    const ctx = document.getElementById('leaderChart').getContext('2d');
    if (window.leaderChartObj) window.leaderChartObj.destroy();

    // Tildel hver kode en unik farve (enkelt palette)
    const palette = [
        '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0',
        '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8',
        '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080', '#ffffff', '#000000'
    ];
    function getColor(idx) {
        return palette[idx % palette.length];
    }

    // Hvis færre end 8 datoer, vis cirkler, ellers ingen
    const showPoints = days.length < 8 ? 4 : 0;

    window.leaderChartObj = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days.map(d => d.toLocaleDateString('da-DK')),
            datasets: koderVis.map((kode, idx) => ({
                label: kode,
                data: dagligePoints[kode],
                borderColor: getColor(idx),
                backgroundColor: getColor(idx),
                fill: false,
                tension: 0.1,
                pointRadius: showPoints,
                pointHoverRadius: showPoints ? 6 : 0
            }))
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: 'Førende antal arter pr. dag'
                },
                tooltip: {
                    callbacks: {
                        afterBody: function(context) {
                            const idx = context[0].dataIndex;
                            return 'Førende: ' + leaders[idx];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Dato' },
                    ticks: { maxTicksLimit: 15 }
                },
                y: {
                    title: { display: true, text: 'Antal arter' },
                    beginAtZero: true
                }
            }
        }
    });
}

// Blockers og seneste kryds tabel
async function visBlockersTabel(kodeFilter = null) {
    // Hent matrix-data
    const res = await fetch('/matrix');
    const data = await res.json();
    if (!data.arter.length || !data.koder.length) return;

    // Filtrer koder hvis kodeFilter er sat
    let koderVis = data.koder;
    let koderIdx = data.koder.map((k, i) => i);
    if (kodeFilter && kodeFilter.length > 0) {
        koderVis = data.koder.filter((k, i) => kodeFilter.includes(k));
        koderIdx = data.koder.map((k, i) => kodeFilter.includes(k) ? i : -1).filter(i => i !== -1);
    }

    // Find blockers for hver kode
    // Blocker: art som kun er set af én kode
    const blockers = {};
    koderVis.forEach(kode => blockers[kode] = []);
    for (let i = 0; i < data.arter.length; i++) {
        // Find hvilke koder der har set denne art
        const seenBy = [];
        for (let idx = 0; idx < koderIdx.length; idx++) {
            let j = koderIdx[idx];
            if (data.matrix[i][j]) seenBy.push(koderVis[idx]);
        }
        if (seenBy.length === 1) {
            blockers[seenBy[0]].push(data.arter[i]);
        }
    }

    // Find seneste 5 kryds for hver kode
    // Kryds = observation (dato) for en art
    const latestCrossings = {};
    koderVis.forEach(kode => latestCrossings[kode] = []);
    for (let idx = 0; idx < koderIdx.length; idx++) {
        let j = koderIdx[idx];
        const kryds = [];
        for (let i = 0; i < data.arter.length; i++) {
            const val = data.matrix[i][j];
            if (val) {
                // Find dato som Date-objekt
                let d;
                if (val.match(/^\d{2}-\d{2}-\d{4}$/)) {
                    const [dd, mm, yyyy] = val.split('-');
                    d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                } else if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    const [yyyy, mm, dd] = val.split('-');
                    d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                } else {
                    d = new Date(val);
                }
                kryds.push({ art: data.arter[i], dato: d, datoStr: val });
            }
        }
        kryds.sort((a, b) => b.dato - a.dato);
        latestCrossings[koderVis[idx]] = kryds.slice(0, 5);
    }

    // Byg tabel
    let html = `<table style="margin-top:24px; margin-bottom:10px"><thead><tr>`;
    html += koderVis.map(k => `<th>${k}</th>`).join('');
    html += `</tr></thead><tbody>`;

    // Blockers antal
    html += `<tr>`;
    koderVis.forEach(k => {
        html += `<td><b>Blockers:</b> ${blockers[k].length}</td>`;
    });
    html += `</tr>`;

    // Blockers arter
    html += `<tr>`;
    koderVis.forEach(k => {
        html += `<td>${blockers[k].length ? blockers[k].join('<br>') : '<span style="color:#888">Ingen</span>'}</td>`;
    });
    html += `</tr>`;

    // Seneste 5 kryds
    html += `<tr>`;
    koderVis.forEach(k => {
        html += `<td><b>Seneste 5 kryds:</b><br>`;
        latestCrossings[k].forEach(kryds => {
            html += `${kryds.datoStr}: ${kryds.art}<br>`;
        });
        html += `</td>`;
    });
    html += `</tr>`;

    html += `</tbody></table>`;

    // Indsæt i DOM (efter matrix)
    let blockersDiv = document.getElementById('blockersTabel');
    if (!blockersDiv) {
        blockersDiv = document.createElement('div');
        blockersDiv.id = 'blockersTabel';
        document.getElementById('result').parentNode.appendChild(blockersDiv);
    }
    blockersDiv.innerHTML = `<h3>Blockers & Seneste kryds</h3>${html}`;
}

// Kald denne efter visMatrix og når kodeFilter ændres:
window.visBlockersTabel = visBlockersTabel;

// Tilføj i visMatrix efter hentLeadChart:
    // hentLeadChart(kodeFilter);
    // visBlockersTabel(kodeFilter);