// Version: 1.11.2 - 2026-03-02 16.42.36
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

document.addEventListener('DOMContentLoaded', () => {
  const matrikelState = {
    matrikel1_perioder: [],
    matrikel2_perioder: []
  };
  let saveTimer = null;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizePeriods(periods) {
    return (Array.isArray(periods) ? periods : [])
      .map(period => ({
        name: String(period?.name || "").trim(),
        start_date: String(period?.start_date || "").trim(),
        end_date: String(period?.end_date || "").trim()
      }))
      .map(period => ({
        ...period,
        end_date: period.end_date || null
      }));
  }

  function readMatrikelRows(matrikelKey) {
    const container = document.getElementById(`rows-${matrikelKey}`);
    if (!container) return [];
    const rows = Array.from(container.querySelectorAll('.matrikel-row'));
    return rows.map(row => ({
      name: row.querySelector('.matrikel-name')?.value?.trim() || "",
      start_date: row.querySelector('.matrikel-start')?.value || "",
      end_date: row.querySelector('.matrikel-end')?.value || null
    }));
  }

  function scheduleSave(delayMs = 350) {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveAllPrefs();
    }, delayMs);
  }

  function renderMatrikelEditor() {
    const wrap = document.getElementById('matrikelSettings');
    if (!wrap) return;

    const renderSection = (key, title, helperText) => {
      const periods = matrikelState[key] || [];
      const rowsHtml = periods.map((period, index) => `
        <div class="matrikel-row" data-index="${index}" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:0.45em;margin-bottom:0.5em;align-items:center;">
          <input class="matrikel-name" type="text" placeholder="Navn/adresse" value="${escapeHtml(period.name || '')}">
          <input class="matrikel-start" type="date" value="${escapeHtml(period.start_date || '')}">
          <input class="matrikel-end" type="date" value="${escapeHtml(period.end_date || '')}">
          <button type="button" class="matrikel-remove" data-key="${key}" data-index="${index}" title="Fjern">✕</button>
        </div>
      `).join('');

      return `
        <div style="margin-top:1.15em;padding:0.85em;border:1px solid #e0e0e0;border-radius:10px;">
          <div style="font-weight:700;margin-bottom:0.3em;">${title}</div>
          <div style="font-size:0.9em;margin-bottom:0.65em;">${helperText}</div>
          <div id="rows-${key}">${rowsHtml}</div>
          <button type="button" class="matrikel-add" data-key="${key}">Tilføj periode</button>
        </div>
      `;
    };

    wrap.innerHTML = `
      <h3 style="margin:0.2em 0 0.5em 0;">Matrikler</h3>
      <div style="font-size:0.93em;margin-bottom:0.5em;">Matrikel 1 bruger grundtagget (fx #BB26). Matrikel 2 bruger tag + <b>-2</b> (fx #BB26-2).</div>
      ${renderSection('matrikel1_perioder', 'Matrikel 1 (scoreboards)', 'Bruges i grupper/ranglister. Ny periode nulstiller aktiv progress.')}
      ${renderSection('matrikel2_perioder', 'Matrikel 2 (privat)', 'Vises kun for dig på forsiden.')}
    `;

    wrap.querySelectorAll('.matrikel-add').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-key');
        const today = new Date().toISOString().slice(0, 10);
        const existing = normalizePeriods(readMatrikelRows(key));
        existing.push({ name: '', start_date: today, end_date: null });
        matrikelState[key] = existing;
        renderMatrikelEditor();
      });
    });

    wrap.querySelectorAll('.matrikel-remove').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-key');
        const index = Number(button.getAttribute('data-index'));
        const existing = normalizePeriods(readMatrikelRows(key));
        matrikelState[key] = existing.filter((_, rowIndex) => rowIndex !== index);
        renderMatrikelEditor();
        scheduleSave(150);
      });
    });

    wrap.querySelectorAll('.matrikel-name, .matrikel-start, .matrikel-end').forEach(input => {
      input.addEventListener('change', () => {
        ['matrikel1_perioder', 'matrikel2_perioder'].forEach(key => {
          matrikelState[key] = normalizePeriods(readMatrikelRows(key));
        });
        scheduleSave();
      });
    });
  }

  async function saveAllPrefs() {
    const lokalafdelingInput = document.getElementById('lokalafdeling');
    const kommuneInput = document.getElementById('kommune');
    ['matrikel1_perioder', 'matrikel2_perioder'].forEach(key => {
      matrikelState[key] = normalizePeriods(readMatrikelRows(key));
    });

    const status = document.getElementById('matrikelSaveStatus');
    if (status) status.textContent = 'Gemmer...';

    try {
      const response = await fetch('/api/set_afdeling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lokalafdeling: lokalafdelingInput ? lokalafdelingInput.value : '',
          kommune: kommuneInput ? kommuneInput.value : '',
          matrikel1_perioder: matrikelState.matrikel1_perioder,
          matrikel2_perioder: matrikelState.matrikel2_perioder
        })
      });
      if (!response.ok) throw new Error('Kunne ikke gemme indstillinger');
      if (status) status.textContent = 'Gemt';
    } catch (error) {
      if (status) status.textContent = 'Fejl ved gemning';
      console.error(error);
    }
  }

  const fullSyncBtn = document.getElementById('fullSyncBtn');
  const fullSyncStatus = document.getElementById('fullSyncStatus');
  if (fullSyncBtn) {
    fullSyncBtn.addEventListener('click', async () => {
      fullSyncBtn.disabled = true;
      if (fullSyncStatus) {
        fullSyncStatus.textContent = 'Starter fuld sync...';
      }
      try {
        const res = await fetch('/api/full_sync_me', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.detail || data.msg || 'Kunne ikke starte fuld sync');
        }
        if (fullSyncStatus) {
          fullSyncStatus.textContent = data.msg || 'Fuld sync er startet.';
        }
      } catch (err) {
        if (fullSyncStatus) {
          fullSyncStatus.textContent = `Fejl: ${err.message || err}`;
        }
      } finally {
        fullSyncBtn.disabled = false;
      }
    });
  }

  // Hent brugerdata og grupper fra server
  fetch('/api/get_userprefs')
    .then(res => res.json())
    .then(data => {
      const userInfo = document.getElementById('userInfo');
      if (userInfo) {
        userInfo.innerHTML =
          `<b>Navn:</b> ${data.navn || '-'}<br>
           <b>Obserkode:</b> ${data.obserkode || '-'}`;
        // Tjek admin og vis knap hvis admin
        fetch('/api/obser_is_admin')
          .then(res => res.json())
          .then(adminData => {
            if (adminData.is_admin) {
              const adminBtn = document.createElement('a');
              adminBtn.href = "/admin.html";
              adminBtn.textContent = "Admin";
              adminBtn.style = "display:inline-block;margin-top:1em;padding:0.5em 1.2em;background:#1976d2;color:#fff;border-radius:7px;text-decoration:none;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.07);";
              userInfo.appendChild(document.createElement('br'));
              userInfo.appendChild(adminBtn);
            }
          });
      }
      if (data.lokalafdeling && document.getElementById('lokalafdeling')) {
        document.getElementById('lokalafdeling').value = data.lokalafdeling;
      }
      // Sæt kommune-dropdown hvis værdi findes
      if (data.kommune && document.getElementById('kommune')) {
        document.getElementById('kommune').value = data.kommune;
      }
      matrikelState.matrikel1_perioder = normalizePeriods(data.matrikel1_perioder || []);
      matrikelState.matrikel2_perioder = normalizePeriods(data.matrikel2_perioder || []);
      renderMatrikelEditor();
    });

  // --------- Gruppefunktionalitet ---------
  function renderGrupper(grupper) {
    const grupperDiv = document.getElementById('grupper');
    if (!grupperDiv) return;
    grupperDiv.innerHTML = "";
    grupper.forEach((gruppe, idx) => {
      grupperDiv.innerHTML += `
        <div class="gruppe-card" style="background:#f7f7fa;border-radius:8px;padding:1em;margin-bottom:1em;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <form class="renameGruppeForm" data-idx="${idx}" style="display:flex;align-items:center;gap:0.5em;">
              <input type="text" value="${gruppe.navn.replace(/"/g, '&quot;')}" class="gruppenavnInput" style="font-weight:bold;width:120px;">
              <button type="submit" title="Omdøb" style="background:none;border:none;color:#1976d2;cursor:pointer;font-size:1.2em;">✎</button>
            </form>
            <button data-idx="${idx}" class="fjernGruppeBtn" style="background:none;border:none;color:#b71c1c;cursor:pointer;">✕</button>
          </div>
          <form class="addObserkodeForm" data-idx="${idx}" style="margin-top:1em;">
            <input type="text" placeholder="Tilføj obserkode" class="obserkodeInput" style="width:60%;margin-right:1em;">
            <button type="submit">Tilføj</button>
          </form>
          <div style="margin-top:0.7em;">
            <b>Obserkoder:</b>
            <ul style="margin:0.5em 0 0 1em;padding:0;">
              ${gruppe.obserkoder.map((kode, i) => `
                <li style="margin-bottom:0.2em;">
                  ${kode}
                  <button data-idx="${idx}" data-kodeidx="${i}" class="fjernKodeBtn" style="background:none;border:none;color:#b71c1c;cursor:pointer;font-size:1em;">✕</button>
                </li>
              `).join("")}
            </ul>
          </div>
          <div class="gruppeRenameError" style="color:#b71c1c;margin-top:0.5em"></div>
        </div>
      `;
    });

    // Fjern gruppe med regnestykke-bekræftelse
    document.querySelectorAll('.fjernGruppeBtn').forEach(btn => {
      btn.onclick = function() {
        const idx = this.dataset.idx;
        const a = Math.floor(Math.random() * 10) + 1;
        const b = Math.floor(Math.random() * 10) + 1;
        const svar = prompt(`Bekræft sletning af gruppen "${grupper[idx].navn}".\nHvad er ${a} + ${b}?`);
        if (svar !== null && Number(svar) === a + b) {
          fetch('/api/delete_gruppe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ navn: grupper[idx].navn })
          }).then(() => hentGrupper());
        }
      };
    });

    // Tilføj obserkode
    document.querySelectorAll('.addObserkodeForm').forEach(form => {
      form.onsubmit = function(e) {
        e.preventDefault();
        const idx = this.dataset.idx;
        const input = this.querySelector('.obserkodeInput');
        const kode = input.value.trim();
        if (kode && !grupper[idx].obserkoder.includes(kode)) {
          fetch('/api/add_gruppemedlem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ navn: grupper[idx].navn, obserkode: kode })
          }).then(() => hentGrupper());
        }
        input.value = "";
      };
    });

    // Fjern obserkode with regnestykke-bekræftelse
    document.querySelectorAll('.fjernKodeBtn').forEach(btn => {
      btn.onclick = function() {
        const idx = this.dataset.idx;
        const kodeidx = this.dataset.kodeidx;
        const kode = grupper[idx].obserkoder[kodeidx];
        const a = Math.floor(Math.random() * 10) + 1;
        const b = Math.floor(Math.random() * 10) + 1;
        const svar = prompt(`Bekræft sletning af medlemmet "${kode}".\nHvad er ${a} + ${b}?`);
        if (svar !== null && Number(svar) === a + b) {
          fetch('/api/remove_gruppemedlem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ navn: grupper[idx].navn, obserkode: kode })
          }).then(() => hentGrupper());
        }
      };
    });

    // Omdøb gruppe
    document.querySelectorAll('.renameGruppeForm').forEach(form => {
      form.onsubmit = function(e) {
        e.preventDefault();
        const idx = this.dataset.idx;
        const input = this.querySelector('.gruppenavnInput');
        const nytNavn = input.value.trim();
        const errorDiv = this.parentElement.parentElement.querySelector('.gruppeRenameError');
        if (!nytNavn) {
          errorDiv.textContent = "Gruppenavn må ikke være tomt.";
          return;
        }
        if (grupper.some((g, i) => g.navn === nytNavn && i !== Number(idx))) {
          errorDiv.textContent = "Der findes allerede en gruppe med det navn.";
          return;
        }
        fetch('/api/rename_gruppe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gammel_navn: grupper[idx].navn, nyt_navn: nytNavn })
        }).then(() => hentGrupper());
      };
    });
  }

  // Genindlæs grupper og opdater dropdowns
  function hentGrupper() {
    fetch('/api/get_grupper')
      .then(res => res.json())
      .then(grupper => {
        addGruppeLinks(grupper);
        renderGrupper(grupper);
      });
  }

  // Opret ny gruppe
  const gruppeForm = document.getElementById('gruppeForm');
  if (gruppeForm) {
    gruppeForm.onsubmit = function(e) {
      e.preventDefault();
      const navn = document.getElementById('gruppenavn').value.trim();
      const errorDiv = document.getElementById('gruppeError');
      if (!navn) {
        errorDiv.textContent = "Gruppenavn må ikke være tomt.";
        return;
      }
      fetch('/api/create_gruppe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ navn })
      })
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            hentGrupper();
            errorDiv.textContent = "";
          } else {
            errorDiv.textContent = data.msg || "Kunne ikke oprette gruppe";
          }
        });
      document.getElementById('gruppenavn').value = "";
    };
  }

  // HENT GRUPPER VED LOAD
  hentGrupper();

  // Hent afdelinger og kommuner og opret dropdowns
  fetch('/api/afdelinger')
    .then(res => res.json())
    .then(data => {
      const afdelingForm = document.getElementById('afdelingForm');
      if (afdelingForm) {
        afdelingForm.innerHTML = `
          <label for="lokalafdeling">Lokalafdeling:</label>
          <select id="lokalafdeling" name="lokalafdeling" style="width:100%;margin-bottom:1em;">
            <option value="">Vælg...</option>
            ${data.lokalafdelinger.map(navn => `<option value="${navn}">${navn}</option>`).join("")}
          </select>
          <label for="kommune">Kommune:</label>
          <select id="kommune" name="kommune" style="width:100%;">
            <option value="">Vælg...</option>
            ${data.kommuner.map(kommune => `<option value="${kommune.id}">${kommune.navn}</option>`).join("")}
          </select>
        `;
      }

      // Hent brugerpræferencer EFTER dropdowns er oprettet
      fetch('/api/get_userprefs')
        .then(res => res.json())
        .then(data => {
          if (data.lokalafdeling && document.getElementById('lokalafdeling')) {
            document.getElementById('lokalafdeling').value = data.lokalafdeling;
          }
          if (data.kommune && document.getElementById('kommune')) {
            document.getElementById('kommune').value = data.kommune;
          }
          matrikelState.matrikel1_perioder = normalizePeriods(data.matrikel1_perioder || []);
          matrikelState.matrikel2_perioder = normalizePeriods(data.matrikel2_perioder || []);
          renderMatrikelEditor();
        });

      // GEM VED ÆNDRING
      const lokalafdelingInput = document.getElementById('lokalafdeling');
      const kommuneInput = document.getElementById('kommune');
      const afdelingFormEl = document.getElementById('afdelingForm');
      function gemAfdelingKommune() {
        saveAllPrefs();
      }
      if (lokalafdelingInput) lokalafdelingInput.addEventListener('change', gemAfdelingKommune);
      if (kommuneInput) kommuneInput.addEventListener('change', gemAfdelingKommune);
      if (afdelingFormEl) {
        afdelingFormEl.addEventListener('submit', (event) => {
          event.preventDefault();
          saveAllPrefs();
        });
      }
    });
});