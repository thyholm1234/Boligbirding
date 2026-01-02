// Version: 1.1.32 - 2026-01-02 14.48.19
// © Christian Vemmelund Helligsø
async function hentObserkoder() {
    const res = await fetch('/obserkoder');
    const koder = await res.json();
    const listDiv = document.getElementById('obserkodeList');
    listDiv.innerHTML = '<h2>Obserkoder</h2>';
    koder.forEach(k => {
        const card = document.createElement('div');
        card.className = 'card obserkode-card';
        card.innerHTML = `
            <div class="card-top">
                <div class="left">
                    <b>${k.kode}</b>
                </div>
                <div class="right admin-btn-wrap">
                    <button data-kode="${k.kode}" class="sync">Sync</button>
                    <button data-kode="${k.kode}" class="slet">Slet</button>
                </div>
            </div>
        `;
        listDiv.appendChild(card);
    });
    // Slet-knapper
    listDiv.querySelectorAll('button.slet').forEach(btn => {
        btn.onclick = async () => {
            await fetch(`/delete_obserkode?kode=${encodeURIComponent(btn.dataset.kode)}`, { method: "DELETE" });
            hentObserkoder();
        };
    });
    // Sync-knapper
    listDiv.querySelectorAll('button.sync').forEach(btn => {
        btn.onclick = async () => {
            await fetch(`/sync_obserkode?kode=${encodeURIComponent(btn.dataset.kode)}`, { method: "POST" });
        };
    });
}

document.getElementById('addForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const kode = document.getElementById('addKode').value.trim();
    await fetch(`/add_obserkode?kode=${encodeURIComponent(kode)}`, { method: "POST" });
    document.getElementById('addKode').value = "";
    hentObserkoder();
});

async function hentGlobalFilter() {
    const res = await fetch('/get_filter');
    const data = await res.json();
    document.getElementById('globalFilter').value = data.filter || "";
}
document.getElementById('filterForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const filter = document.getElementById('globalFilter').value.trim();
    await fetch(`/set_filter?filter=${encodeURIComponent(filter)}`, { method: "POST" });
});

document.getElementById('syncAllBtn').onclick = async function() {
    await fetch('/sync_all', { method: "POST" });
};

document.getElementById('themeToggle').onclick = function() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    localStorage.setItem('theme', root.getAttribute('data-theme'));
};

// Admin-login funktionalitet
async function checkAdmin() {
    const res = await fetch('/is_admin');
    const data = await res.json();
    if (!data.isAdmin) {
        document.body.innerHTML = `
            <form id="adminLogin" style="margin:40px auto;max-width:300px">
                <h2>Admin login</h2>
                <input type="password" id="adminPw" placeholder="Adgangskode" required style="width:100%;margin-bottom:8px">
                <button style="width:100%">Login</button>
            </form>
        `;
        document.getElementById('adminLogin').onsubmit = async e => {
            e.preventDefault();
            const pw = document.getElementById('adminPw').value;
            const resp = await fetch('/admin_login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (resp.ok) {
                location.reload();
            } else {
                alert('Forkert adgangskode');
            }
        };
        return false;
    }
    return true;
}

window.addEventListener('DOMContentLoaded', async () => {
    if (await checkAdmin()) {
        const saved = localStorage.getItem('theme');
        if (saved) document.documentElement.setAttribute('data-theme', saved);
        hentGlobalFilter();
        hentObserkoder();
        const year = localStorage.getItem('syncYear');
        if (year) document.getElementById('syncYear').value = year;
    }
});

// (valgfrit) Tilføj en logout-knap et sted i admin-UI:
const logoutBtn = document.getElementById('adminLogout');
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        await fetch('/admin_logout', { method: 'POST' });
        location.reload();
    };
}

// År-funktionalitet (valgfrit, hvis du vil kunne sætte år globalt)
document.getElementById('yearForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const year = document.getElementById('syncYear').value.trim();
    localStorage.setItem('syncYear', year);
    await fetch(`/set_year?year=${encodeURIComponent(year)}`, { method: "POST" });
    alert('År sat til ' + year + '. Synkroniserer alle koder...');
    await fetch('/sync_all', { method: "POST" });
    alert('Alle koder synkroniseret for år ' + year);
});
window.addEventListener('DOMContentLoaded', () => {
    const year = localStorage.getItem('syncYear');
    if (year) document.getElementById('syncYear').value = year;
});