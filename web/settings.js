// Version: 1.12.16 - 2026-03-03 01.23.22
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
    periodMap: {},
    availableKeys: []
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
      }))
      .sort((left, right) => {
        const leftStart = left.start_date || "9999-12-31";
        const rightStart = right.start_date || "9999-12-31";
        if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);

        const leftEnd = left.end_date || "9999-12-31";
        const rightEnd = right.end_date || "9999-12-31";
        return leftEnd.localeCompare(rightEnd);
      });
  }

  function matrikelIndexFromKey(key) {
    const match = String(key || '').toLowerCase().match(/^matrikel\s*(\d+)$/);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  }

  function matrikelKey(index) {
    return `matrikel${index}`;
  }

  function normalizePeriodMap(periodMap) {
    const result = {};
    Object.entries(periodMap || {}).forEach(([rawKey, rawPeriods]) => {
      const index = matrikelIndexFromKey(rawKey);
      if (!index) return;
      result[matrikelKey(index)] = normalizePeriods(rawPeriods || []);
    });
    return result;
  }

  function addOneDay(dateStr) {
    if (!dateStr) return new Date().toISOString().slice(0, 10);
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function nextSuggestedStartDate(periods) {
    const normalized = normalizePeriods(periods);
    let latestEnd = "";
    normalized.forEach(period => {
      if (period.end_date && period.end_date > latestEnd) {
        latestEnd = period.end_date;
      }
    });
    return latestEnd ? addOneDay(latestEnd) : new Date().toISOString().slice(0, 10);
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

  function getMultiSelectValues(selectEl, maxCount) {
    if (!selectEl) return [];
    const selected = Array.from(selectEl.selectedOptions || []).map(option => option.value).filter(Boolean);
    return selected.slice(0, maxCount);
  }

  function enforceMultiSelectLimit(selectEl, maxCount, statusEl) {
    if (!selectEl) return;
    const selected = Array.from(selectEl.selectedOptions || []);
    if (selected.length <= maxCount) return;
    selected.slice(maxCount).forEach(option => {
      option.selected = false;
    });
    if (statusEl) {
      statusEl.textContent = `Du kan højst vælge ${maxCount}.`;
      setTimeout(() => {
        if (statusEl.textContent === `Du kan højst vælge ${maxCount}.`) statusEl.textContent = '';
      }, 2200);
    }
  }

  function getSelectedValues(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions || []).map(option => String(option.value)).filter(Boolean);
  }

  function setSelectedValues(selectEl, values) {
    if (!selectEl) return;
    const selectedSet = new Set((Array.isArray(values) ? values : []).map(value => String(value)));
    Array.from(selectEl.options || []).forEach(option => {
      option.selected = selectedSet.has(String(option.value));
    });
  }

  function updateOptInSummary(selectEl, targetId, emptyText) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const labels = getSelectedValues(selectEl)
      .map(value => Array.from(selectEl?.options || []).find(option => String(option.value) === String(value))?.textContent || '')
      .filter(Boolean);
    target.textContent = labels.length ? labels.join(', ') : emptyText;
  }

  function ensurePrimaryKommuneSelected() {
    const kommuneInput = document.getElementById('kommune');
    const kommunerOptInInput = document.getElementById('kommunerOptIn');
    if (!kommuneInput || !kommunerOptInInput) return;
    const primary = String(kommuneInput.value || '').trim();
    if (!primary) return;
    const selected = new Set(getSelectedValues(kommunerOptInInput));
    if (!selected.has(primary)) {
      selected.add(primary);
      setSelectedValues(kommunerOptInInput, Array.from(selected).slice(0, 5));
    }
  }

  function ensureOptInModal() {
    if (document.getElementById('optInModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="optInModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1200;align-items:center;justify-content:center;padding:1em;">
        <div style="background:var(--card-bg);color:var(--text-main);width:min(520px,100%);max-height:85vh;border-radius:12px;box-shadow:var(--card-shadow);padding:1em;display:flex;flex-direction:column;">
          <h3 id="optInModalTitle" style="margin-top:0;"></h3>
          <div id="optInModalHelper" class="muted" style="margin-bottom:0.6em;"></div>
          <div id="optInModalList" style="display:flex;flex-direction:column;gap:0.45em;overflow:auto;max-height:52vh;padding-right:0.2em;"></div>
          <div id="optInModalStatus" class="muted" style="margin-top:0.7em;min-height:1.2em;"></div>
          <div style="display:flex;gap:0.6em;justify-content:flex-end;margin-top:0.9em;padding-top:0.6em;border-top:1px solid var(--border);">
            <button type="button" id="optInModalCancel">Annuller</button>
            <button type="button" id="optInModalSave">Gem valg</button>
          </div>
        </div>
      </div>
    `);
  }

  function openOptInModal(config) {
    ensureOptInModal();
    const modal = document.getElementById('optInModal');
    const title = document.getElementById('optInModalTitle');
    const helper = document.getElementById('optInModalHelper');
    const list = document.getElementById('optInModalList');
    const status = document.getElementById('optInModalStatus');
    const cancelBtn = document.getElementById('optInModalCancel');
    const saveBtn = document.getElementById('optInModalSave');
    const sourceSelect = document.getElementById(config.selectId);
    if (!modal || !title || !helper || !list || !status || !cancelBtn || !saveBtn || !sourceSelect) return;

    title.textContent = config.title;
    helper.textContent = `Vælg op til ${config.maxCount}.`;

    const initialSelected = new Set(getSelectedValues(sourceSelect));
    const primaryValue = String(config.primaryValue || '').trim();
    if (config.lockPrimary && primaryValue) initialSelected.add(primaryValue);

    const options = Array.from(sourceSelect.options || []).filter(option => option.value);
    list.innerHTML = options.map(option => {
      const value = String(option.value);
      const isLockedPrimary = Boolean(config.lockPrimary && primaryValue && value === primaryValue);
      const checked = initialSelected.has(value) ? 'checked' : '';
      const disabled = isLockedPrimary ? 'disabled' : '';
      const primaryTag = isLockedPrimary ? ' <span class="muted">(primær)</span>' : '';
      return `
        <label style="display:flex;gap:0.55em;align-items:flex-start;padding:0.35em 0;">
          <input type="checkbox" data-value="${value}" ${checked} ${disabled}>
          <span>${option.textContent || value}${primaryTag}</span>
        </label>
      `;
    }).join('');

    const enforceLimit = () => {
      const checkedBoxes = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'));
      if (checkedBoxes.length <= config.maxCount) {
        status.textContent = '';
        return true;
      }
      status.textContent = `Du kan højst vælge ${config.maxCount}.`;
      return false;
    };

    list.querySelectorAll('input[type="checkbox"]').forEach(box => {
      box.addEventListener('change', () => {
        if (!enforceLimit()) box.checked = false;
      });
    });

    const close = () => {
      modal.style.display = 'none';
      list.innerHTML = '';
      status.textContent = '';
      cancelBtn.onclick = null;
      saveBtn.onclick = null;
      modal.onclick = null;
    };

    cancelBtn.onclick = () => close();
    modal.onclick = (event) => {
      if (event.target === modal) close();
    };
    saveBtn.onclick = () => {
      const selectedValues = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(box => String(box.getAttribute('data-value')));
      if (config.lockPrimary && primaryValue && !selectedValues.includes(primaryValue)) selectedValues.unshift(primaryValue);
      const normalized = selectedValues.slice(0, config.maxCount);
      setSelectedValues(sourceSelect, normalized);
      updateOptInSummary(sourceSelect, config.summaryId, config.emptyText);
      sourceSelect.dispatchEvent(new Event('change'));
      close();
    };

    modal.style.display = 'flex';
  }

  function renderMatrikelEditor() {
    const wrap = document.getElementById('matrikelSettings');
    if (!wrap) return;

    const availableKeys = [...(matrikelState.availableKeys || [])]
      .filter(key => matrikelIndexFromKey(key))
      .sort((left, right) => (matrikelIndexFromKey(left) || 0) - (matrikelIndexFromKey(right) || 0));

    if (!availableKeys.length) {
      wrap.innerHTML = `
        <h3 style="margin:0.2em 0 0.5em 0;">Matrikler</h3>
        <div class="muted">Ingen matrikel-tags fundet i dine observationsdata endnu.</div>
      `;
      return;
    }

    const renderSection = (key) => {
      const index = matrikelIndexFromKey(key);
      const periods = matrikelState.periodMap[key] || [];
      const title = index === 1 ? 'Matrikel 1 (scoreboards)' : `Matrikel ${index} (privat)`;
      const helperText = index === 1
        ? 'Bruges i grupper/ranglister. Ny periode nulstiller aktiv progress.'
        : 'Vises kun for dig.';
      const rowsHtml = periods.length
        ? periods.map((period, index) => `
          <div class="matrikel-row" data-index="${index}" style="display:flex;flex-direction:column;gap:0.45em;margin-bottom:0.65em;padding:0.65em;border:1px solid #ececec;border-radius:8px;box-sizing:border-box;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.6em;">
              <div style="font-weight:600;font-size:0.95em;">Periode ${index + 1}</div>
              <button type="button" class="matrikel-remove" data-key="${key}" data-index="${index}" title="Fjern" style="padding:0.25em 0.55em;line-height:1;">✕</button>
            </div>
            <label style="font-size:0.85em;font-weight:600;">Navn / adresse</label>
            <input class="matrikel-name" type="text" placeholder="Navn/adresse" value="${escapeHtml(period.name || '')}" style="width:100%;box-sizing:border-box;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.45em;">
              <div style="min-width:0;">
                <label style="font-size:0.85em;font-weight:600;display:block;">Startdato</label>
                <input class="matrikel-start" type="date" value="${escapeHtml(period.start_date || '')}" style="width:100%;box-sizing:border-box;">
              </div>
              <div style="min-width:0;">
                <label style="font-size:0.85em;font-weight:600;display:block;">Slutdato</label>
                <input class="matrikel-end" type="date" value="${escapeHtml(period.end_date || '')}" style="width:100%;box-sizing:border-box;">
              </div>
            </div>
          </div>
        `).join('')
        : `<div class="muted" style="margin-bottom:0.65em;">Ingen perioder endnu.</div>`;

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
      <div style="font-size:0.93em;margin-bottom:0.5em;">Kun matrikler, der findes i dine observationsdata, vises her.</div>
      ${availableKeys.map(key => renderSection(key)).join('')}
    `;

    wrap.querySelectorAll('.matrikel-add').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-key');
        const existing = normalizePeriods(readMatrikelRows(key));
        const suggestedStart = nextSuggestedStartDate(existing);
        existing.push({ name: '', start_date: suggestedStart, end_date: null });
        matrikelState.periodMap[key] = existing;
        renderMatrikelEditor();
      });
    });

    wrap.querySelectorAll('.matrikel-remove').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-key');
        const index = Number(button.getAttribute('data-index'));
        const existing = normalizePeriods(readMatrikelRows(key));
        matrikelState.periodMap[key] = existing.filter((_, rowIndex) => rowIndex !== index);
        renderMatrikelEditor();
        scheduleSave(150);
      });
    });

    wrap.querySelectorAll('.matrikel-name, .matrikel-start, .matrikel-end').forEach(input => {
      input.addEventListener('change', () => {
        availableKeys.forEach(key => {
          matrikelState.periodMap[key] = normalizePeriods(readMatrikelRows(key));
        });
        renderMatrikelEditor();
        scheduleSave();
      });
    });
  }

  async function saveAllPrefs() {
    const lokalafdelingInput = document.getElementById('lokalafdeling');
    const kommuneInput = document.getElementById('kommune');
    const lokalafdelingerOptInInput = document.getElementById('lokalafdelingerOptIn');
    const kommunerOptInInput = document.getElementById('kommunerOptIn');
    const availableKeys = [...(matrikelState.availableKeys || [])]
      .filter(key => matrikelIndexFromKey(key));
    availableKeys.forEach(key => {
      matrikelState.periodMap[key] = normalizePeriods(readMatrikelRows(key));
    });

    const payloadPeriodMap = {};
    availableKeys.forEach(key => {
      payloadPeriodMap[key] = normalizePeriods(matrikelState.periodMap[key] || []);
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
          lokalafdelinger: getMultiSelectValues(lokalafdelingerOptInInput, 3),
          kommuner: getMultiSelectValues(kommunerOptInInput, 5),
          matrikel_perioder: payloadPeriodMap
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
      const fallbackIndexes = Object.keys(data.matrikel_perioder || {})
        .map(key => matrikelIndexFromKey(key))
        .filter(index => Number.isFinite(index));
      const available = Array.isArray(data.available_matrikler) ? data.available_matrikler : fallbackIndexes;
      matrikelState.availableKeys = available
        .map(index => matrikelKey(index))
        .filter(key => matrikelIndexFromKey(key));
      matrikelState.periodMap = normalizePeriodMap(data.matrikel_perioder || {
        matrikel1: data.matrikel1_perioder || [],
        matrikel2: data.matrikel2_perioder || []
      });
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
          <select id="kommune" name="kommune" style="width:100%;margin-bottom:1em;">
            <option value="">Vælg...</option>
            ${data.kommuner.map(kommune => `<option value="${kommune.id}">${kommune.navn}</option>`).join("")}
          </select>
          <label style="font-weight:600;">Opt-in lokalafdelinger (max 3):</label>
          <button type="button" id="openLokalOptInModal" style="width:100%;margin:0.35em 0 0.35em 0;">Vælg lokalafdelinger</button>
          <div id="lokalafdelingerOptInSummary" class="muted" style="margin-bottom:0.45em;font-size:0.9em;">Ingen valgt</div>
          <select id="lokalafdelingerOptIn" name="lokalafdelingerOptIn" multiple size="6" style="display:none;">
            ${data.lokalafdelinger.map(navn => `<option value="${navn}">${navn}</option>`).join("")}
          </select>
          <div class="muted" style="margin-bottom:0.8em;font-size:0.9em;">Vælg hvilke lokalafdelinger du vil optræde på scoreboards i.</div>

          <label style="font-weight:600;">Opt-in kommuner (max 5):</label>
          <button type="button" id="openKommuneOptInModal" style="width:100%;margin:0.35em 0 0.35em 0;">Vælg kommuner</button>
          <div id="kommunerOptInSummary" class="muted" style="margin-bottom:0.45em;font-size:0.9em;">Ingen valgt</div>
          <select id="kommunerOptIn" name="kommunerOptIn" multiple size="8" style="display:none;">
            ${data.kommuner.map(kommune => `<option value="${kommune.id}">${kommune.navn}</option>`).join("")}
          </select>
          <div class="muted" style="margin-bottom:0.8em;font-size:0.9em;">Vælg hvilke kommuner du vil optræde på scoreboards i.</div>
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
          const lokalOpt = document.getElementById('lokalafdelingerOptIn');
          if (lokalOpt) {
            const selectedLokal = Array.isArray(data.lokalafdelinger) ? data.lokalafdelinger : [];
            Array.from(lokalOpt.options).forEach(option => {
              option.selected = selectedLokal.includes(option.value);
            });
            updateOptInSummary(lokalOpt, 'lokalafdelingerOptInSummary', 'Ingen valgt');
          }
          const kommuneOpt = document.getElementById('kommunerOptIn');
          if (kommuneOpt) {
            const selectedKommuner = Array.isArray(data.kommuner) ? data.kommuner.map(v => String(v)) : [];
            Array.from(kommuneOpt.options).forEach(option => {
              option.selected = selectedKommuner.includes(String(option.value));
            });
            ensurePrimaryKommuneSelected();
            updateOptInSummary(kommuneOpt, 'kommunerOptInSummary', 'Ingen valgt');
          }
          const fallbackIndexes = Object.keys(data.matrikel_perioder || {})
            .map(key => matrikelIndexFromKey(key))
            .filter(index => Number.isFinite(index));
          const available = Array.isArray(data.available_matrikler) ? data.available_matrikler : fallbackIndexes;
          matrikelState.availableKeys = available
            .map(index => matrikelKey(index))
            .filter(key => matrikelIndexFromKey(key));
          matrikelState.periodMap = normalizePeriodMap(data.matrikel_perioder || {
            matrikel1: data.matrikel1_perioder || [],
            matrikel2: data.matrikel2_perioder || []
          });
          renderMatrikelEditor();
        });

      // GEM VED ÆNDRING
      const lokalafdelingInput = document.getElementById('lokalafdeling');
      const kommuneInput = document.getElementById('kommune');
      const lokalafdelingerOptInInput = document.getElementById('lokalafdelingerOptIn');
      const kommunerOptInInput = document.getElementById('kommunerOptIn');
      const openLokalOptInModalBtn = document.getElementById('openLokalOptInModal');
      const openKommuneOptInModalBtn = document.getElementById('openKommuneOptInModal');
      const afdelingFormEl = document.getElementById('afdelingForm');
      function gemAfdelingKommune() {
        saveAllPrefs();
      }
      if (lokalafdelingInput) lokalafdelingInput.addEventListener('change', gemAfdelingKommune);
      if (kommuneInput) {
        kommuneInput.addEventListener('change', () => {
          ensurePrimaryKommuneSelected();
          updateOptInSummary(kommunerOptInInput, 'kommunerOptInSummary', 'Ingen valgt');
          gemAfdelingKommune();
        });
      }

      if (openLokalOptInModalBtn) {
        openLokalOptInModalBtn.addEventListener('click', () => {
          openOptInModal({
            selectId: 'lokalafdelingerOptIn',
            title: 'Opt-in lokalafdelinger',
            summaryId: 'lokalafdelingerOptInSummary',
            maxCount: 3,
            emptyText: 'Ingen valgt',
            lockPrimary: false,
            primaryValue: null
          });
        });
      }

      if (openKommuneOptInModalBtn) {
        openKommuneOptInModalBtn.addEventListener('click', () => {
          openOptInModal({
            selectId: 'kommunerOptIn',
            title: 'Opt-in kommuner',
            summaryId: 'kommunerOptInSummary',
            maxCount: 5,
            emptyText: 'Ingen valgt',
            lockPrimary: true,
            primaryValue: kommuneInput ? kommuneInput.value : ''
          });
        });
      }

      if (lokalafdelingerOptInInput) {
        lokalafdelingerOptInInput.addEventListener('change', () => {
          enforceMultiSelectLimit(lokalafdelingerOptInInput, 3, document.getElementById('matrikelSaveStatus'));
          updateOptInSummary(lokalafdelingerOptInInput, 'lokalafdelingerOptInSummary', 'Ingen valgt');
          gemAfdelingKommune();
        });
      }
      if (kommunerOptInInput) {
        kommunerOptInInput.addEventListener('change', () => {
          enforceMultiSelectLimit(kommunerOptInInput, 5, document.getElementById('matrikelSaveStatus'));
          ensurePrimaryKommuneSelected();
          updateOptInSummary(kommunerOptInInput, 'kommunerOptInSummary', 'Ingen valgt');
          gemAfdelingKommune();
        });
      }
      if (afdelingFormEl) {
        afdelingFormEl.addEventListener('submit', (event) => {
          event.preventDefault();
          saveAllPrefs();
        });
      }
    });
});