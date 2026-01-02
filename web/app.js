// Version: 1.2.5 - 2026-01-02 23.31.42
// © Christian Vemmelund Helligsø
function visMatrix(data, sortMode = "alphabetical", kodeFilter = null) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = "";

    // --- GRAF ---
    hentLeadChart(kodeFilter);

    // --- Blockers og seneste kryds tabel ---
    let blockersDiv = document.getElementById('blockersTabel');
    if (!blockersDiv) {
        blockersDiv = document.createElement('div');
        blockersDiv.id = 'blockersTabel';
    }
    resultDiv.appendChild(blockersDiv);
    visBlockersTabel(kodeFilter);

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

    // --- Matrix tabel ---
    const table = document.createElement('table');
    // Header
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    let koderVis = data.koder;
    let koderIdx = data.koder.map((k, i) => i);
    if (kodeFilter && kodeFilter.length > 0) {
        koderVis = data.koder.filter((k, i) => kodeFilter.includes(k));
        koderIdx = data.koder.map((k, i) => kodeFilter.includes(k) ? i : -1).filter(i => i !== -1);
    }

    // --- SORTÉR KODER EFTER FLEST OBSERVATIONER ---
    const kodeAntal = koderIdx.map(j => {
        let count = 0;
        for (let i = 0; i < data.arter.length; i++) {
            if (data.matrix[i][j]) count++;
        }
        return count;
    });
    const sortOrder = kodeAntal
        .map((antal, idx) => ({ idx, antal }))
        .sort((a, b) => b.antal - a.antal)
        .map(obj => obj.idx);

    koderVis = sortOrder.map(idx => koderVis[idx]);
    koderIdx = sortOrder.map(idx => koderIdx[idx]);

    hrow.innerHTML = `<th style="width:32px">#</th><th>Art</th>` + koderVis.map((k, idx) => `<th class="obserkode" data-idx="${koderIdx[idx]}" style="cursor:pointer">${k}</th>`).join('');
    thead.appendChild(hrow);

    // Total-række (direkte under header)
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td></td><td><b>Total</b></td>` + koderIdx.map(i => `<td class="total-antal"><b>${data.totals[i]}</b></td>`).join('');
    thead.appendChild(totalRow);

    // Tid brugt-række
    const tidRow = document.createElement('tr');
    tidRow.innerHTML = `<td></td><td><b>Tid brugt</b></td>` + koderIdx.map(i => `<td class="tid-brugt">${(data.tid_brugt || data.tid_brugt_minutter || [])[i] || ""}</td>`).join('');
    thead.appendChild(tidRow);

    // Antal ture-række
    const tureRow = document.createElement('tr');
    tureRow.innerHTML = `<td></td><td><b>Antal lister</b></td>` + koderIdx.map(i => `<td class="antal-lister">${(data.antal_observationer || [])[i] || ""}</td>`).join('');
    thead.appendChild(tureRow);

    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    let filteredRows = [];
    for (let i = 0; i < data.arter.length; i++) {
        let hasObs = true;
        if (koderIdx.length > 0 && koderIdx.length !== data.koder.length) {
            hasObs = koderIdx.some(j => data.matrix[i][j]);
        }
        if (!hasObs) continue;
        filteredRows.push(i);
    }

    let rowOrder = [...filteredRows];

    let selectedKodeIdx = null;
    let selectedKodeSort = false;

    function renderRows(order, kodeSortIdx = null) {
        thead.innerHTML = "";
        if (kodeSortIdx !== null) {
            const kodeNavn = data.koder[kodeSortIdx];
            const th = document.createElement('th');
            th.className = "obserkode";
            th.setAttribute("data-idx", kodeSortIdx);
            th.style.cursor = "pointer";
            th.textContent = kodeNavn;

            const tr = document.createElement('tr');
            tr.innerHTML = `<th style="width:32px">#</th><th>Art</th>`;
            tr.appendChild(th);
            thead.appendChild(tr);

            thead.innerHTML += `
                <tr>
                    <td></td>
                    <td><b>Total</b></td>
                    <td class="total-antal"><b>${order.filter(i => data.matrix[i][kodeSortIdx]).length}</b></td>
                </tr>
                <tr>
                    <td></td>
                    <td><b>Tid brugt</b></td>
                    <td class="tid-brugt">${(data.tid_brugt || data.tid_brugt_minutter || [])[kodeSortIdx] || ""}</td>
                </tr>
                <tr>
                    <td></td>
                    <td><b>Antal lister</b></td>
                    <td class="antal-lister">${(data.antal_observationer || [])[kodeSortIdx] || ""}</td>
                </tr>
            `;
        } else {
            thead.appendChild(hrow);
            thead.appendChild(totalRow);
            thead.appendChild(tidRow);
            thead.appendChild(tureRow);
        }

        tbody.innerHTML = "";
        let rowNum = 1;
        for (const i of order) {
            if (kodeSortIdx !== null) {
                let val = data.matrix[i][kodeSortIdx];
                if (!val) continue;
            }
            const row = document.createElement('tr');
            row.innerHTML = `<td style="text-align:center;width:32px">${rowNum++}</td><td>${data.arter[i]}</td>`;
            if (kodeSortIdx === null) {
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
            } else {
                let val = data.matrix[i][kodeSortIdx];
                row.innerHTML += `<td>${val || ""}</td>`;
            }
            tbody.appendChild(row);
        }

        if (kodeSortIdx !== null) {
            thead.querySelector('.obserkode').addEventListener('click', function () {
                selectedKodeIdx = null;
                selectedKodeSort = false;
                visMatrix(data, "alphabetical", kodeFilter);
            });
        }
    }

    renderRows(rowOrder);

    table.appendChild(tbody);
    resultDiv.appendChild(table);

    table.querySelectorAll('.obserkode').forEach(th => {
        th.addEventListener('click', function () {
            const idx = Number(this.dataset.idx);
            if (selectedKodeIdx === idx) {
                selectedKodeIdx = null;
                selectedKodeSort = false;
                visMatrix(data, "alphabetical", kodeFilter);
            } else {
                selectedKodeIdx = idx;
                selectedKodeSort = true;
                let rowsWithObs = filteredRows.filter(i => data.matrix[i][idx]);
                rowsWithObs.sort((a, b) => {
                    let va = data.matrix[a][idx];
                    let vb = data.matrix[b][idx];
                    function parseDate(val) {
                        if (!val) return new Date(0);
                        if (val.match(/^\d{2}-\d{2}-\d{4}$/)) {
                            const [dd, mm, yyyy] = val.split('-');
                            return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                        } else if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            const [yyyy, mm, dd] = val.split('-');
                            return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                        }
                        return new Date(val);
                    }
                    return parseDate(vb) - parseDate(va);
                });
                renderRows(rowsWithObs, idx);
            }
        });
    });

    filterBtn.onclick = () => {
        modal.style.display = "block";
        const kodeForm = modal.querySelector('#kodeForm');
        kodeForm.innerHTML = "";
        data.koder.forEach((kode, i) => {
            let kodePrefs = [];
            try {
                kodePrefs = JSON.parse(localStorage.getItem('kodeFilterPrefs') || "[]");
            } catch {}
            const checked = (!kodeFilter && (!kodePrefs.length || kodePrefs.includes(kode))) || (kodeFilter && kodeFilter.includes(kode)) ? "checked" : "";
            kodeForm.innerHTML += `<label style="display:block;margin-bottom:4px"><input type="checkbox" name="kode" value="${kode}" ${checked}> ${kode}</label>`;
        });
    };

    modal.onclick = e => {
        if (e.target === modal) modal.style.display = "none";
    };
    modal.querySelector('#kodeModalOk').onclick = () => {
        const checked = Array.from(modal.querySelectorAll('input[name="kode"]:checked')).map(cb => cb.value);
        localStorage.setItem('kodeFilterPrefs', JSON.stringify(checked));
        modal.style.display = "none";
        visMatrix(
            data,
            "alphabetical",
            checked.length === data.koder.length ? null : checked
        );
        hentLeadChart(checked.length === data.koder.length ? null : checked);
    };
    modal.querySelector('#kodeModalCancel').onclick = () => {
        modal.style.display = "none";
    };

    // --- REGLER MODAL KNAP ---
    let reglerBtn = document.getElementById('reglerBtn');
    if (!reglerBtn) {
        reglerBtn = document.createElement('button');
        reglerBtn.id = "reglerBtn";
        reglerBtn.textContent = "Vis regler for konkurrencen";
        reglerBtn.style.margin = "16px 0 16px 0";
        resultDiv.parentNode.insertBefore(reglerBtn, resultDiv);
    }

    let reglerModal = document.getElementById('reglerModal');
    if (!reglerModal) {
        reglerModal = document.createElement('div');
        reglerModal.id = "reglerModal";
        reglerModal.style.display = "none";
        reglerModal.style.position = "fixed";
        reglerModal.style.left = "0";
        reglerModal.style.top = "0";
        reglerModal.style.width = "100vw";
        reglerModal.style.height = "100vh";
        reglerModal.style.background = "rgba(0,0,0,0.3)";
        reglerModal.style.zIndex = "2000";
        reglerModal.innerHTML = `
            <div style="background:#fff;max-width:600px;margin:80px auto;padding:24px 24px 16px 24px;border-radius:8px;box-shadow:0 2px 12px #0003;position:relative">
                <h2 style="margin-top:0">REGLER FOR DEN ØSTJYSKE MATRIKEL-KONKURRENCE 2026</h2>
                <ol style="margin-bottom:1em">
                    <li>Konkurrencen kører over hele året: 2026. Alle arter, som er registreret og noteret indtil d. 31.12. kl. 24.00 tæller med.</li>
                    <li>Alle kryds skal indtastes i DOFbasen, med tagget <b>#BB26</b> i turnoten (der kan godt skrives andet derudover).</li>
                    <li>Alle arter, som er set på matriklen eller fra matriklen tæller med. Det betyder, at en biæder, som sidder i et træ på matriklen, men ses mens man står udenfor matriklen, tæller med, selv om den er væk, når man kommer ind på matriklen. En overflyvende fugl tæller kun med, hvis den ses fra matriklen.</li>
                    <li>Alle arter, som deltageren selv har set eller hørt, tæller med. Arter, som er optaget (f.eks. på nattræk) eller set/hørt af andre, men ikke af deltageren selv, tæller ikke med.</li>
                    <li>SU-arter skal være veldokumenterede med kommentarer og/eller foto. Ligeledes skal SUB-arter også have en form for dokumentation.</li>
                    <li>Vinderen af konkurrencen er den, som d. 31.12.2026 kl. 24.00 har set flest arter og offentliggjort antallet til de øvrige deltagere rettidigt. Vinderen kåres i løbet af den første uge i 2026.</li>
                </ol>
                <button id="reglerModalClose" style="margin-top:8px">Luk</button>
            </div>
        `;
        document.body.appendChild(reglerModal);
    }

    reglerBtn.onclick = () => {
        reglerModal.style.display = "block";
    };
    reglerModal.onclick = e => {
        if (e.target === reglerModal) reglerModal.style.display = "none";
    };
    reglerModal.querySelector('#reglerModalClose').onclick = () => {
        reglerModal.style.display = "none";
    };

    if (!kodeFilter) {
        try {
            const kodePrefs = JSON.parse(localStorage.getItem('kodeFilterPrefs') || "[]");
            if (kodePrefs.length && kodePrefs.length !== data.koder.length) {
                setTimeout(() => {
                    visMatrix(data, "alphabetical", kodePrefs);
                    hentLeadChart(kodePrefs);
                }, 0);
                return;
            }
        } catch {}
    }
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

    // Udregn antal observationer for hver kode
    const kodeAntal = koderIdx.map(j => {
        let count = 0;
        for (let i = 0; i < data.arter.length; i++) {
            if (data.matrix[i][j]) count++;
        }
        return count;
    });

    // Sorter koder efter flest observationer
    const sortedIdx = kodeAntal
        .map((antal, idx) => ({ idx, antal }))
        .sort((a, b) => b.antal - a.antal)
        .map(obj => obj.idx);

    koderVis = sortedIdx.map(idx => koderVis[idx]);
    koderIdx = sortedIdx.map(idx => koderIdx[idx]);
    const kodeAntalSorted = sortedIdx.map(idx => kodeAntal[idx]);

    // Find blockers for hver kode
    const blockers = {};
    koderVis.forEach(kode => blockers[kode] = []);
    for (let i = 0; i < data.arter.length; i++) {
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
    const latestCrossings = {};
    koderVis.forEach(kode => latestCrossings[kode] = []);
    for (let idx = 0; idx < koderIdx.length; idx++) {
        let j = koderIdx[idx];
        const kryds = [];
        for (let i = 0; i < data.arter.length; i++) {
            const val = data.matrix[i][j];
            if (val) {
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

    // Antal observationer
    html += `<tr>`;
    kodeAntalSorted.forEach(antal => {
        html += `<td><b>Antal:</b> ${antal}</td>`;
    });
    html += `</tr>`;

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

// Theme toggle funktionalitet
document.getElementById('themeToggle').onclick = function () {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
};