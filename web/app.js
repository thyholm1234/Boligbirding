// Version: 1.10.15 - 2026-02-17 01.21.48
// © Christian Vemmelund Helligsø

import { renderNavbar, initNavbar, initMobileNavbar, addGruppeLinks } from './navbar.js';

renderNavbar();
initNavbar();
initMobileNavbar();

fetch('/api/get_grupper')
  .then(res => res.json())
  .then(grupper => {
    addGruppeLinks(grupper);
  });

fetch('/api/is_logged_in').then(r => r.json()).then(data => {
  if (!data.ok) window.location.href = "/login.html";
});


// Ved resize/orientation ændres offset
window.addEventListener('resize', () => {
  const tableEl = document.querySelector('.matrix-table');
  if (tableEl) updateStickyOffsets(tableEl);
});
window.addEventListener('orientationchange', () => {
  const tableEl = document.querySelector('.matrix-table');
  if (tableEl) updateStickyOffsets(tableEl);
});

// Synkroniser-knap funktionalitet
const syncBtn = document.getElementById('sync-btn');
if (syncBtn) {
  syncBtn.onclick = async function() {
    const btn = this;
    btn.disabled = true;
    btn.textContent = "Synkroniserer...";
    try {
      const res = await fetch('/api/sync_mine_observationer', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (data.ok) {
        btn.textContent = "✅ Synkroniseret!";
        await hentStats();
      } else {
        btn.textContent = "Fejl i sync";
        alert(data.msg || "Der opstod en fejl under synkronisering.");
      }
    } catch (e) {
      btn.textContent = "Fejl i sync";
      alert("Der opstod en fejl under synkronisering.");
    }
    setTimeout(() => {
      btn.textContent = "🔄 Synkronisér observationer";
      btn.disabled = false;
    }, 1800);
  };
}

// Hent og vis brugerens stats
export async function hentStats() {
  const res = await fetch('/api/user_scoreboard', { credentials: 'include' });
  const data = await res.json();
  let html = "";

  // Grupper øverst
  if (data.grupper && data.grupper.length) {
    for (const g of data.grupper) {
      html += `
        <div class="card obserkode-card" style="margin-bottom:1.5em;padding:1.2em 1em;width:100%;">
          <div style="font-weight:bold;font-size:1.15em;margin-bottom:0.5em;display:flex;align-items:baseline;gap:0.4em;">
            <span style="font-size:1.3em;">👥</span> ${g.navn}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a class="card obserkode-card" href="/scoreboard.html?scope=gruppe_alle&gruppe=${encodeURIComponent(g.navn)}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
              <div>Alle: <b>${g.alle?.antal_arter ?? '-'}</b> arter</div>
              <div>Placering <b>#${g.alle?.placering ?? '-'}</b></div>
            </a>
            <a class="card obserkode-card" href="/scoreboard.html?scope=gruppe_matrikel&gruppe=${encodeURIComponent(g.navn)}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
              <div>Matrikel: <b>${g.matrikel?.antal_arter ?? '-'}</b> arter</div>
              <div>Placering <b>#${g.matrikel?.placering ?? '-'}</b></div>
            </a>
          </div>
          <div style="color:var(--text-muted);font-size:0.98em;margin-top:0.3em;">
            Seneste art: <span style="font-weight:500;">${g.alle?.sidste_art ?? '-'}</span> (${g.alle?.sidste_dato ?? '-'})
          </div>
        </div>
      `;
    }
  }

  // Nationalt
  html += `
    <div class="card obserkode-card" style="margin-bottom:1.5em;padding:1.2em 1em;width:100%;">
      <div style="font-weight:bold;font-size:1.15em;margin-bottom:0.5em;display:flex;align-items:baseline;gap:0.4em;">
        <span style="font-size:1.3em;">🇩🇰</span> Nationalt
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <a class="card obserkode-card" href="/scoreboard.html?scope=global_alle" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
          <div>Alle: <b>${data.national_alle?.antal_arter ?? '-'}</b> arter</div>
          <div>Placering <b>#${data.national_alle?.placering ?? '-'}</b></div>
        </a>
        <a class="card obserkode-card" href="/scoreboard.html?scope=global_matrikel" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
          <div>Matrikel: <b>${data.national_matrikel?.antal_arter ?? '-'}</b> arter</div>
          <div>Placering <b>#${data.national_matrikel?.placering ?? '-'}</b></div>
        </a>
      </div>
      <div style="color:var(--text-muted);font-size:0.98em;margin-top:0.3em;">
        Seneste art: <span style="font-weight:500;">${data.national_alle?.sidste_art ?? '-'}</span> (${data.national_alle?.sidste_dato ?? '-'})
      </div>
    </div>
  `;

  // Lokalafdeling
  let lokalafdelingNavn = data.lokalafdeling_alle?.navn;

  // Hvis ikke navnet findes i scoreboard-data, hent fra brugerpræferencer
  if (!lokalafdelingNavn) {
    try {
      const prefsRes = await fetch('/api/get_userprefs', { credentials: 'include' });
      if (prefsRes.ok) {
        const prefs = await prefsRes.json();
        lokalafdelingNavn = prefs.lokalafdeling || "Lokalafdeling";
      } else {
        lokalafdelingNavn = "Lokalafdeling";
      }
    } catch {
      lokalafdelingNavn = "Lokalafdeling";
    }
  }

  html += `
  <div class="card obserkode-card" style="padding:1.2em 1em;width:100%;">
    <div style="font-weight:bold;font-size:1.15em;margin-bottom:0.5em;display:flex;align-items:baseline;gap:0.4em;">
      <span style="font-size:1.3em;">🏘️</span> ${lokalafdelingNavn}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <a class="card obserkode-card" href="/scoreboard.html?scope=lokal_alle&afdeling=${encodeURIComponent(lokalafdelingNavn)}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
        <div>Alle: <b>${data.lokalafdeling_alle?.antal_arter ?? '-'}</b> arter</div>
        <div>Placering <b>#${data.lokalafdeling_alle?.placering ?? '-'}</b></div>
      </a>
      <a class="card obserkode-card" href="/scoreboard.html?scope=lokal_matrikel&afdeling=${encodeURIComponent(lokalafdelingNavn)}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
        <div>Matrikel: <b>${data.lokalafdeling_matrikel?.antal_arter ?? '-'}</b> arter</div>
        <div>Placering <b>#${data.lokalafdeling_matrikel?.placering ?? '-'}</b></div>
      </a>
    </div>
    <div style="color:var(--text-muted);font-size:0.98em;margin-top:0.3em;">
      Seneste art: <span style="font-weight:500;">${data.lokalafdeling_alle?.sidste_art ?? '-'}</span> (${data.lokalafdeling_alle?.sidste_dato ?? '-'})
    </div>
  </div>
  `;

  // Kommune
  let kommuneId = data.kommune_id;
  let kommuneNavn = data.kommune_navn;

  if (!kommuneId || !kommuneNavn) {
    try {
      const prefsRes = await fetch('/api/get_userprefs', { credentials: 'include' });
      if (prefsRes.ok) {
        const prefs = await prefsRes.json();
        kommuneId = kommuneId || prefs.kommune;
      }
    } catch {
      // ignore
    }
  }

  if (kommuneId && !kommuneNavn) {
    try {
      const kommunerRes = await fetch('/api/afdelinger');
      if (kommunerRes.ok) {
        const kommunerData = await kommunerRes.json();
        const match = (kommunerData.kommuner || []).find(k => k.id === String(kommuneId));
        kommuneNavn = match ? match.navn : "Kommune";
      }
    } catch {
      kommuneNavn = "Kommune";
    }
  }

  if (kommuneId) {
    html += `
    <div class="card obserkode-card" style="padding:1.2em 1em;width:100%;margin-top:1.5em;">
      <div style="font-weight:bold;font-size:1.15em;margin-bottom:0.5em;display:flex;align-items:baseline;gap:0.4em;">
        <span style="font-size:1.3em;">🏠</span> ${kommuneNavn || "Kommune"}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <a class="card obserkode-card" href="/scoreboard.html?scope=kommune_alle&kommune=${encodeURIComponent(kommuneId)}&kommune_navn=${encodeURIComponent(kommuneNavn || "Kommune")}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
          <div>Alle: <b>${data.kommune_alle?.antal_arter ?? '-'}</b> arter</div>
          <div>Placering <b>#${data.kommune_alle?.placering ?? '-'}</b></div>
        </a>
        <a class="card obserkode-card" href="/scoreboard.html?scope=kommune_matrikel&kommune=${encodeURIComponent(kommuneId)}&kommune_navn=${encodeURIComponent(kommuneNavn || "Kommune")}" style="min-width:120px;text-decoration:none;box-shadow:none;margin:0;">
          <div>Matrikel: <b>${data.kommune_matrikel?.antal_arter ?? '-'}</b> arter</div>
          <div>Placering <b>#${data.kommune_matrikel?.placering ?? '-'}</b></div>
        </a>
      </div>
      <div style="color:var(--text-muted);font-size:0.98em;margin-top:0.3em;">
        Seneste art: <span style="font-weight:500;">${data.kommune_alle?.sidste_art ?? '-'}</span> (${data.kommune_alle?.sidste_dato ?? '-'})
      </div>
    </div>
    `;
  }

  const feedEl = document.getElementById('feed');
  if (feedEl) feedEl.innerHTML = html;
}

// Kør hentStats ved load
if (document.getElementById('feed')) {
  hentStats();
}

