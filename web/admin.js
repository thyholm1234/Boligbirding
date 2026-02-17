// Version: 1.10.21 - 2026-02-17 01.58.11
// © Christian Vemmelund Helligsø
async function hentObserkoder() {
    const res = await fetch('/api/obserkoder');
    const koder = await res.json();
    const listDiv = document.getElementById('obserkodeList');
    listDiv.innerHTML = '<h2>Obserkoder</h2>';
    koder.forEach(k => {
        const card = document.createElement('div');
        card.className = 'card obserkode-card';
        card.innerHTML = `
            <div class="card-top">
                <div class="left">
                    <b>${k.kode}</b>${k.navn ? ` <span class="muted">(${k.navn})</span>` : ""}
                </div>
                <div class="right admin-btn-wrap">
                    <button data-kode="${k.kode}" class="sync">Sync</button>
                    <button data-kode="${k.kode}" class="full-sync">Full sync</button>
                    <button data-kode="${k.kode}" class="edit-user">Rediger</button>
                    <button data-kode="${k.kode}" class="slet">Slet</button>
                </div>
            </div>
        `;
        listDiv.appendChild(card);
    });
    // Slet-knapper
    listDiv.querySelectorAll('button.slet').forEach(btn => {
        btn.onclick = async () => {
            if (confirm(`Vil du slette brugeren/obserkoden '${btn.dataset.kode}'?`)) {
                await fetch(`/api/delete_obserkode?kode=${encodeURIComponent(btn.dataset.kode)}`, { method: "DELETE" });
                hentObserkoder();
            }
        };
    });
    // Sync-knapper
    listDiv.querySelectorAll('button.sync').forEach(btn => {
        btn.onclick = async () => {
            const kode = btn.dataset.kode;
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Synkroniserer...";
            try {
                const res = await fetch(`/api/sync_obserkode?kode=${encodeURIComponent(kode)}`, { method: "POST" });
                const data = await res.json();
                btn.textContent = data.msg || "✓ Synkroniseret";
                setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
            } catch (e) {
                btn.textContent = "Fejl!";
                setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
            }
        };
    });
    // Full sync-knapper
    listDiv.querySelectorAll('button.full-sync').forEach(btn => {
        btn.onclick = async () => {
            const kode = btn.dataset.kode;
            if (!confirm(`Vil du starte full sync for '${kode}'?`)) return;
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Starter full sync...";
            try {
                const res = await fetch(`/api/admin/full_sync_user?kode=${encodeURIComponent(kode)}`, { method: "POST" });
                const data = await res.json();
                btn.textContent = data.msg || "✓ Startet";
                setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2200);
            } catch (e) {
                btn.textContent = "Fejl!";
                setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2200);
            }
        };
    });
    // Rediger bruger
    listDiv.querySelectorAll('button.edit-user').forEach(btn => {
        btn.onclick = async () => {
            await openUserModal(btn.dataset.kode);
        };
    });
}

let cachedAfdelinger = null;
let cachedKommuner = null;
let currentEditKode = null;

async function ensureAfdelingerLoaded() {
    if (cachedAfdelinger && cachedKommuner) return;
    const res = await fetch('/api/afdelinger');
    const data = await res.json();
    cachedAfdelinger = Array.isArray(data.lokalafdelinger) ? data.lokalafdelinger : [];
    cachedKommuner = Array.isArray(data.kommuner) ? data.kommuner : [];
}

function fillSelect(selectEl, options, emptyLabel) {
    selectEl.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = emptyLabel;
    selectEl.appendChild(emptyOpt);
    options.forEach(opt => {
        const option = document.createElement('option');
        if (typeof opt === 'string') {
            option.value = opt;
            option.textContent = opt;
        } else {
            option.value = opt.id;
            option.textContent = opt.navn;
        }
        selectEl.appendChild(option);
    });
}

async function openUserModal(kode) {
    const modal = document.getElementById('adminUserModal');
    const status = document.getElementById('adminUserStatus');
    const kodeEl = document.getElementById('adminUserModalKode');
    const navnEl = document.getElementById('adminUserNavn');
    const afdelingEl = document.getElementById('adminUserAfdeling');
    const kommuneEl = document.getElementById('adminUserKommune');

    status.textContent = '';
    kodeEl.textContent = kode;
    navnEl.value = '';
    currentEditKode = kode;

    await ensureAfdelingerLoaded();
    fillSelect(afdelingEl, cachedAfdelinger, 'Ingen lokalafdeling');
    fillSelect(kommuneEl, cachedKommuner, 'Ingen kommune');

    try {
        const res = await fetch(`/api/admin/user_profile?kode=${encodeURIComponent(kode)}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            status.textContent = data.detail || 'Kunne ikke hente brugerdata.';
        } else {
            navnEl.value = data.user.navn || '';
            if (data.user.lokalafdeling) {
                afdelingEl.value = data.user.lokalafdeling;
            }
            if (data.user.kommune_id) {
                kommuneEl.value = data.user.kommune_id;
            } else if (data.user.kommune_navn) {
                const match = cachedKommuner.find(k => k.navn === data.user.kommune_navn);
                if (match) kommuneEl.value = match.id;
            }
        }
    } catch (e) {
        status.textContent = 'Kunne ikke hente brugerdata.';
    }

    modal.style.display = 'flex';
}

function closeUserModal() {
    const modal = document.getElementById('adminUserModal');
    modal.style.display = 'none';
    currentEditKode = null;
}

document.getElementById('addForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const kode = document.getElementById('addKode').value.trim();
    await fetch(`/api/add_obserkode?kode=${encodeURIComponent(kode)}`, { method: "POST" });
    document.getElementById('addKode').value = "";
    hentObserkoder();
});

async function hentGlobalFilter() {
    const res = await fetch('/api/get_filter');
    const data = await res.json();
    document.getElementById('globalFilter').value = data.filter || "";
}
document.getElementById('filterForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const filter = document.getElementById('globalFilter').value.trim();
    await fetch(`/api/set_filter?filter=${encodeURIComponent(filter)}`, { method: "POST" });
});

document.getElementById('syncAllBtn').onclick = async function() {
    const btn = this;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Synkroniserer alle...";
    try {
        const res = await fetch('/api/sync_all', { method: "POST" });
        const data = await res.json();
        btn.textContent = data.msg || "✓ Synkroniseret";
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
    } catch (e) {
        btn.textContent = "Fejl!";
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
    }
};

document.getElementById('updateLokationerBtn').onclick = async function() {
    const btn = this;
    const statusEl = document.getElementById('updateLokationerStatus');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Opdaterer lokationer...";
    if (statusEl) statusEl.textContent = "";
    try {
        const res = await fetch('/api/update_lokationer', { method: "POST" });
        const data = await res.json();
        btn.textContent = data.msg || "✓ Opdateret";
        if (statusEl) statusEl.textContent = data.msg || "✓ Opdateret";
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    } catch (e) {
        btn.textContent = "Fejl!";
        if (statusEl) statusEl.textContent = "Fejl ved opdatering.";
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    }
};

// Admin-login funktionalitet
async function checkAdmin() {
    const res = await fetch('/api/is_admin');
    const data = await res.json();
    if (!data.is_admin) {
        const loginDiv = document.getElementById('adminLogin');
        loginDiv.innerHTML = `
            <form id="adminLoginForm" style="margin:40px auto;max-width:300px">
                <h2>Admin login</h2>
                <input type="text" id="adminKode" placeholder="Superadmin obserkode" required style="width:100%;margin-bottom:8px">
                <input type="password" id="adminPw" placeholder="Adgangskode" required style="width:100%;margin-bottom:8px">
                <button style="width:100%">Login</button>
            </form>
        `;
        document.getElementById('admin-content').style.display = 'none';
        document.getElementById('adminLoginForm').onsubmit = async e => {
            e.preventDefault();
            const kode = document.getElementById('adminKode').value.trim();
            const pw = document.getElementById('adminPw').value;
            const resp = await fetch('/api/adminlogin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ obserkode: kode, password: pw })
            });
            if (resp.ok) {
                location.reload();
            } else {
                alert('Forkert adgangskode eller obserkode');
            }
        };
        return false;
    } else {
        document.getElementById('adminLogin').innerHTML = '';
        document.getElementById('admin-content').style.display = '';
    }
    return true;
}

async function hentGrupper() {
    const res = await fetch('/api/admin/grupper');
    const grupper = await res.json();
    const listDiv = document.getElementById('gruppeList');
    listDiv.innerHTML = '<h2>Grupper</h2>';
    grupper.forEach(g => {
        const card = document.createElement('div');
        card.className = 'card obserkode-card gruppe-card'; // Tilføj evt. gruppe-card for særskilt styling
        card.innerHTML = `
            <div class="card-top">
                <div class="left" style="display:flex;align-items:center;gap:10px;">
                    <span class="gruppe-ikon" title="Gruppe" style="font-size:1.5em; color:var(--primary);">👥</span>
                    <b>${g.navn}</b>
                </div>
                <div class="right admin-btn-wrap">
                    <button data-navn="${g.navn}" class="slet-gruppe" title="Slet gruppe">🗑️</button>
                </div>
            </div>
        `;
        listDiv.appendChild(card);
    });
    // Slet-knapper
    listDiv.querySelectorAll('button.slet-gruppe').forEach(btn => {
        btn.onclick = async () => {
            if (confirm(`Vil du slette gruppen '${btn.dataset.navn}'?`)) {
                await fetch('/api/admin/slet_gruppe', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ navn: btn.dataset.navn })
                });
                hentGrupper();
            }
        };
    });
}

// Hent aktuelt år fra serveren og sæt det i formularen
async function hentAktueltAar() {
    const res = await fetch('/api/get_year');
    const data = await res.json();
    if (data.year) {
        document.getElementById('syncYear').value = data.year;
    }
}

const adminUserModal = document.getElementById('adminUserModal');
const adminUserForm = document.getElementById('adminUserForm');
const adminUserCancel = document.getElementById('adminUserCancel');

if (adminUserModal) {
    adminUserModal.addEventListener('click', e => {
        if (e.target === adminUserModal) closeUserModal();
    });
}

if (adminUserCancel) {
    adminUserCancel.onclick = () => closeUserModal();
}

if (adminUserForm) {
    adminUserForm.addEventListener('submit', async e => {
        e.preventDefault();
        const status = document.getElementById('adminUserStatus');
        const navn = document.getElementById('adminUserNavn').value.trim();
        const lokalafdeling = document.getElementById('adminUserAfdeling').value;
        const kommune = document.getElementById('adminUserKommune').value;

        if (!currentEditKode) return;
        if (!navn) {
            status.textContent = 'Navn mangler.';
            return;
        }

        status.textContent = 'Gemmer...';
        try {
            const res = await fetch('/api/admin/update_user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    obserkode: currentEditKode,
                    navn,
                    lokalafdeling,
                    kommune
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                status.textContent = data.detail || 'Kunne ikke gemme.';
                return;
            }
            status.textContent = data.msg || 'Gemt.';
            await hentObserkoder();
            setTimeout(() => closeUserModal(), 600);
        } catch (err) {
            status.textContent = 'Kunne ikke gemme.';
        }
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    if (await checkAdmin()) {
        const saved = localStorage.getItem('theme');
        if (saved) document.documentElement.setAttribute('data-theme', saved);
        hentGlobalFilter();
        hentObserkoder();
        hentGrupper();
        await hentAktueltAar(); // <-- Hent aktuelt år fra serveren
    }
});

// Logout-knap (hvis du har en med id="adminLogout" i HTML)
const logoutBtn = document.getElementById('adminLogout');
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        await fetch('/api/admin_logout', { method: 'POST' });
        location.reload();
    };
}

// År-funktionalitet (valgfrit, hvis du vil kunne sætte år globalt)
document.getElementById('yearForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const year = document.getElementById('syncYear').value.trim();
    localStorage.setItem('syncYear', year);
    await fetch(`/api/set_year?year=${encodeURIComponent(year)}`, { method: "POST" });
    alert('År sat til ' + year + '. Synkroniserer alle koder...');
    await fetch('/api/sync_all', { method: "POST" });
    alert('Alle koder synkroniseret for år ' + year);
    await hentAktueltAar(); // Opdater feltet efter ændring
});