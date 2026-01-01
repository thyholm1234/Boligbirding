// Version: 1.1.6 - 2026-01-02 00.46.41
// © Christian Vemmelund Helligsø
function visMatrix(data) {
    const table = document.createElement('table');
    // Header
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    hrow.innerHTML = `<th>Art</th>` + data.koder.map(k => `<th>${k}</th>`).join('');
    thead.appendChild(hrow);

    // Total-række (direkte under header)
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td><b>Total</b></td>` + data.totals.map(t => `<td><b>${t}</b></td>`).join('');
    thead.appendChild(totalRow);

    // Tid brugt-række
    const tidRow = document.createElement('tr');
    tidRow.innerHTML = `<td><b>Tid brugt</b></td>` + (data.tid_brugt || data.tid_brugt_minutter || []).map(t => `<td>${t}</td>`).join('');
    thead.appendChild(tidRow);

    // Antal ture-række
    const tureRow = document.createElement('tr');
    tureRow.innerHTML = `<td><b>Antal ture</b></td>` + (data.antal_observationer || []).map(t => `<td>${t}</td>`).join('');
    thead.appendChild(tureRow);

    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (let i = 0; i < data.arter.length; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${data.arter[i]}</td>`;
        for (let j = 0; j < data.koder.length; j++) {
            let val = data.matrix[i][j];
            let seen = data.matrix[i].filter(x => x).length;
            let color = "";
            if (seen === 1) color = "bg-red";
            else if (seen === 2) color = "bg-orange";
            else if (seen === 3) color = "bg-darkgreen";
            else if (seen >= 4) color = "bg-lightgreen";
            row.innerHTML += `<td class="${color}">${val || ""}</td>`;
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = "";
    resultDiv.appendChild(table);
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

document.getElementById('themeToggle').onclick = function() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    localStorage.setItem('theme', root.getAttribute('data-theme'));
};
// Sæt theme ved load
window.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    hentMatrixMedPolling();
    hentLeadChart();
});

document.getElementById('refreshMatrixBtn').onclick = () => {
    hentMatrixMedPolling();
    hentLeadChart();
};

// --- GRAF: Hvem fører dag for dag ---

async function hentLeadChart() {
    const res = await fetch('/matrix');
    const data = await res.json();
    if (!data.arter.length || !data.koder.length) return;

    // Hent år fra backend
    const yearRes = await fetch('/get_year');
    const yearData = await yearRes.json();
    const year = yearData.year;

    // Byg dag-for-dag stilling
    // 1. Find alle datoer (fra 1. jan til 31. dec i valgt år ELLER til i dag hvis aktuelt år)
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

    // 2. For hver kode, lav et set af arter set til og med hver dag
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
    data.koder.forEach(k => dagligePoints[k] = []);
    days.forEach(day => {
        const dayStr = day.toLocaleDateString('da-DK');
        data.koder.forEach(kode => {
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

    // 3. Find hvem der fører hver dag
    const leaders = [];
    days.forEach((_, idx) => {
        let max = -1, leader = [];
        data.koder.forEach(kode => {
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

    // 4. Tegn grafen
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
            datasets: data.koder.map((kode, idx) => ({
                label: kode,
                data: dagligePoints[kode],
                borderColor: getColor(idx),
                backgroundColor: getColor(idx),
                fill: false,
                tension: 0.1,
                pointRadius: showPoints,        // Kun cirkler hvis < 8 dage
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