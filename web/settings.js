// Version: 1.10.0 - 2026-02-16 21.27.12
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
        });

      // GEM VED ÆNDRING
      const lokalafdelingInput = document.getElementById('lokalafdeling');
      const kommuneInput = document.getElementById('kommune');
      function gemAfdelingKommune() {
        fetch('/api/set_afdeling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lokalafdeling: lokalafdelingInput.value,
            kommune: kommuneInput.value
          })
        });
      }
      if (lokalafdelingInput) lokalafdelingInput.addEventListener('change', gemAfdelingKommune);
      if (kommuneInput) kommuneInput.addEventListener('change', gemAfdelingKommune);
    });
});