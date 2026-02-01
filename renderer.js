/* ==========================================================================
   Animedoro Pro - renderer.js (REWRITE LIMPO E ROBUSTO)
   ✅ FIX PRINCIPAL: "card pai não identificado"
      - Persistimos o parentId do menu de subcards em dataset (DOM) + globals
      - openUniversalMenu() sempre chama setCurrentParentId()
      - openUniversalCreateModal() sempre resgata parentId com getCurrentParentIdSafe()
      - confirmUniversalCreate() NÃO depende de variável que pode ter sido zerada
   ✅ Também corrige:
      - remove duplicação de openUniversalCreateModal (havia 2 funções com o mesmo nome)
      - mantém modal criar subcard topmost sempre
   ========================================================================== */

const fs = require("fs");
const path = require("path");

/* =========================
   DIRETÓRIO DE IMAGENS
========================= */
const imagesDir = path.join(".", "user_images");
if (!fs.existsSync(imagesDir)) {
  try { fs.mkdirSync(imagesDir); } catch (e) {}
}

/* =========================
   PATH RESOLVER (FORTIFICADO)
========================= */
function resolvePath(p) {
  if (!p) return null;
  if (typeof p === "string" && (p.startsWith("data:") || p.startsWith("http"))) return p;

  let clean = String(p).replace(/^file:\/\//i, "");
  let abs = path.resolve(clean);
  abs = abs.replace(/\\/g, "/");
  return `file://${abs}?t=${Date.now()}`;
}
window.resolvePath = resolvePath;

/* =========================
   PROCESSA IMAGEM (BASE64 -> arquivo)
========================= */
function processImage(data) {
  if (!data) return null;

  // já é caminho curto
  if (typeof data === "string" && data.length < 500 && !data.startsWith("data:")) return data;

  try {
    const matches = String(data).match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;

    const buffer = Buffer.from(matches[2], "base64");
    const filename = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
    const filePath = path.join(imagesDir, filename);

    fs.writeFileSync(filePath, buffer);
    return path.join("user_images", filename);
  } catch (e) {
    console.error("processImage() erro:", e);
    return null;
  }
}
window.processImage = processImage;

/* =========================
   ESTADO GLOBAL
========================= */
let timerInterval = null;
let endTime = null;
let remainingTimeMs = 0;
let isRunning = false;
let currentMode = "estudo";
let lastLoggedSecond = null;

let sessionTargetMinutes = 0;
let currentSessionMinutes = 0;

let currentSubject = null;
let currentSubcard = null;
let currentSubcardParent = null;

// ✅ parentId robusto (não perde)
let currentParentCardId = null;

let editContext = {
  type: "subject", // "subject" | "subcard"
  subjectId: null,
  parentModeId: null,
  parentType: "mode",
  subId: null,
};

let selectedDate = new Date();
let currentCalendarYear = new Date().getFullYear();

let tempCustomIcon = null;
let editingTimerId = null;
let tempSubjectImg = null;
let tempUniversalImg = null;
let tempCoverImg = null;

let isDown = false;
let startX = 0;
let scrollLeft = 0;

let editingAnimeId = null;
let currentMediaType = "Anime";
let currentRating = 0;

/* =========================
   DADOS (DEFAULT)
========================= */
let appData = {
  settings: {
    wallpaper: null,
    sound: null,
    darkMode: false,
    themeColor: "default",
    transparency: 0.9,
    timerBg: null,
    borderRadius: 10,
    autoSave: false,
  },
  modeDurations: {
    estudo: 50 * 60 * 1000,
    anime: 20 * 60 * 1000,
  },
  savedTimerState: {
    mode: "estudo",
    remaining: 50 * 60 * 1000,
    elapsed: 0,
  },
  customModes: [],
  modeConfigs: {},
  stats: { estudo: 0, anime: 0, episodes: 0, streak: 0, lastLogDate: null },
  logs: [],
  studySubjects: [{ id: 1, name: "Geral", icon: "📝", customImage: null, totalMinutes: 0, tags: [], currentTag: null, subItems: [] }],
  animeList: [],
};

/* =========================
   HELPERS / GETTERS
========================= */
function $(id) { return document.getElementById(id); }

function ensureArrays() {
  if (!appData.logs) appData.logs = [];
  if (!appData.customModes) appData.customModes = [];
  if (!appData.animeList) appData.animeList = [];
  if (!appData.modeConfigs) appData.modeConfigs = {};
  if (!appData.stats) appData.stats = { estudo: 0, anime: 0, episodes: 0, streak: 0, lastLogDate: null };
  if (!appData.studySubjects || !Array.isArray(appData.studySubjects) || appData.studySubjects.length === 0) {
    appData.studySubjects = [{ id: 1, name: "Geral", icon: "📝", customImage: null, totalMinutes: 0, tags: [], currentTag: null, subItems: [] }];
  }
  (appData.studySubjects || []).forEach(s => {
    if (!Array.isArray(s.subItems)) s.subItems = [];
  });
}

function getParentModeById(modeId) {
  return (appData.customModes || []).find(m => m.id === modeId) || null;
}

function buildParentKey(type, id) {
  return `${type}:${id}`;
}
window.buildParentKey = buildParentKey;

function parseParentKey(parentKey) {
  if (!parentKey) return null;
  const raw = String(parentKey);
  if (raw.includes(":")) {
    const [type, ...rest] = raw.split(":");
    return { type, id: rest.join(":") };
  }
  return { type: "mode", id: raw };
}

function getParentItemFromKey(parentKey) {
  const parsed = parseParentKey(parentKey);
  if (!parsed) return null;

  if (parsed.type === "subject") {
    return (appData.studySubjects || []).find(s => String(s.id) === String(parsed.id)) || null;
  }

  return (appData.customModes || []).find(m => String(m.id) === String(parsed.id)) || null;
}

function normalizeParentKey(parentKey, parentType = "mode") {
  if (!parentKey) return null;
  const raw = String(parentKey);
  if (raw.includes(":")) return raw;
  return buildParentKey(parentType, parentKey);
}

function ensureCustomSubItems(parentKey) {
  const parent = getParentItemFromKey(parentKey);
  if (!parent) return null;
  if (!Array.isArray(parent.subItems)) parent.subItems = [];
  return parent;
}

function findSubcard(parentKey, subId) {
  const parent = ensureCustomSubItems(parentKey);
  if (!parent) return null;
  return (parent.subItems || []).find(s => s.id === subId) || null;
}

/* =========================
   ✅ FIX: PARENT ID ROBUSTO (não perde)
   - guarda em global + window + dataset
========================= */
function setCurrentParentId(parentId) {
  const v = parentId != null ? String(parentId) : null;

  currentParentCardId = v;
  window.currentParentCardId = v;

  const menu = $("universal-menu-modal");
  if (menu) {
    if (v) menu.dataset.parentId = v;
    else delete menu.dataset.parentId;
  }

  const create = $("universal-create-modal");
  if (create) {
    if (v) create.dataset.parentId = v;
    else delete create.dataset.parentId;
  }
}

function getCurrentParentIdSafe() {
  if (currentParentCardId) return String(currentParentCardId);
  if (window.currentParentCardId) return String(window.currentParentCardId);

  const menu = $("universal-menu-modal");
  const ds1 = menu?.dataset?.parentId;
  if (ds1) return String(ds1);

  const create = $("universal-create-modal");
  const ds2 = create?.dataset?.parentId;
  if (ds2) return String(ds2);

  return null;
}

/* =========================
   LOAD / SAVE
========================= */
function loadData() {
  const d = localStorage.getItem("animedoroData");
  if (d) {
    try {
      appData = { ...appData, ...JSON.parse(d) };
    } catch (e) {
      console.error("loadData erro:", e);
    }
  }
  ensureArrays();
}

let saveTimeout = null;
let isSavingDisk = false;

function performAutoSave(force) {
  if (!appData.settings.autoSave && !force) return;
  if (isSavingDisk) return;
  isSavingDisk = true;

  const outPath = "./animedoro_data.json";
  fs.writeFile(outPath, JSON.stringify(appData, null, 2), (err) => {
    isSavingDisk = false;
    if (err) console.error("AutoSave disco erro:", err);
  });
}

function saveData(alertUser = false) {
  localStorage.setItem("animedoroData", JSON.stringify(appData));

  if (alertUser) {
    performAutoSave(true);
    if (typeof window.openAlert === "function") window.openAlert('<i class="fas fa-check-circle"></i> Salvo', "Dados salvos com sucesso!");
    else alert("Salvo!");
    return;
  }

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => performAutoSave(false), 2000);
}
window.saveData = saveData;

/* =========================
   MIGRAÇÃO (base64 antigo -> arquivo)
========================= */
function migrateOldData() {
  let changed = false;

  const migrateItem = (item, prop) => {
    if (item && item[prop] && typeof item[prop] === "string" && item[prop].startsWith("data:")) {
      item[prop] = processImage(item[prop]);
      return true;
    }
    return false;
  };

  (appData.customModes || []).forEach(m => { if (migrateItem(m, "customIcon")) changed = true; });
  Object.keys(appData.modeConfigs || {}).forEach(k => { if (migrateItem(appData.modeConfigs[k], "icon")) changed = true; });
  (appData.animeList || []).forEach(a => { if (migrateItem(a, "image")) changed = true; });

  if (migrateItem(appData.settings, "wallpaper")) changed = true;
  if (migrateItem(appData.settings, "timerBg")) changed = true;

  (appData.studySubjects || []).forEach(s => { if (migrateItem(s, "customImage")) changed = true; });

  (appData.customModes || []).forEach(cm => {
    (cm.subItems || []).forEach(sc => {
      if (migrateItem(sc, "customImage")) changed = true;
      if (migrateItem(sc, "icon")) changed = true;
    });
  });

  if (changed) saveData();
}

/* =========================
   UI HELPERS
========================= */
function updateDisplay(ms) {
  if (ms < 0) ms = 0;
  const m = Math.floor((ms / 1000) / 60);
  const s = Math.floor((ms / 1000) % 60);
  const t = $("timer");
  if (t) t.innerText = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function lockTabs(locked) {
  document.querySelectorAll(".pill-tab, .pill-tab-add").forEach(t => {
    if (locked) t.classList.add("disabled-tab");
    else t.classList.remove("disabled-tab");
  });
}

function getDurationForMode(mode) {
  if (appData.modeDurations && appData.modeDurations[mode]) return appData.modeDurations[mode];
  if (mode === "estudo") return 50 * 60 * 1000;
  if (mode === "anime") return 20 * 60 * 1000;
  return 30 * 60 * 1000;
}

function saveDurationForMode(mode, ms) {
  if (!appData.modeDurations) appData.modeDurations = {};
  appData.modeDurations[mode] = ms;
  saveData();
}

function saveTimerState() {
  appData.savedTimerState = {
    mode: currentMode,
    remaining: remainingTimeMs,
    elapsed: currentSessionMinutes,
  };
  saveData();
}

function setModeVisual(mode) {
  document.querySelectorAll(".pill-tab").forEach(b => {
    b.classList.remove("active");
    if (b.dataset.mode === mode) {
      b.classList.add("active");
      try { b.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch (e) {}
    }
  });
}

function formatTimeCompact(mins) {
  mins = parseInt(mins) || 0;
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/* =========================
   MODAIS TOPMOST
========================= */
function forceTopmostEditModal() {
  const modal = $("edit-subject-modal");
  if (!modal) return;
  document.body.appendChild(modal);
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.transform = "none";
  modal.style.filter = "none";
}

function forceTopmostConfirmModal() {
  const modal = $("confirm-modal");
  if (!modal) return;
  document.body.appendChild(modal);
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.transform = "none";
  modal.style.filter = "none";
}

function forceTopmostUniversalCreateModal() {
  const modal = $("universal-create-modal");
  if (!modal) return;

  document.body.appendChild(modal);
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.transform = "none";
  modal.style.filter = "none";
  modal.style.pointerEvents = "auto";
}

function openEditModal() {
  forceTopmostEditModal();
  const modal = $("edit-subject-modal");
  if (!modal) return;
  modal.style.display = "flex";
  requestAnimationFrame(forceTopmostEditModal);
}
window.openEditModal = openEditModal;

window.closeEditSubjectModal = function () {
  const m = $("edit-subject-modal");
  if (m) m.style.display = "none";
  editContext = { type: "subject", subjectId: null, parentModeId: null, subId: null };
};

/* =========================
   THEMES / SETTINGS
========================= */
function updateModeButtons() {
  const l = $("btn-mode-light");
  const d = $("btn-mode-dark");
  if (!l || !d) return;
  l.classList.remove("active");
  d.classList.remove("active");
  if (appData.settings.darkMode) d.classList.add("active");
  else l.classList.add("active");
}

function applyThemeClasses() {
  document.body.className = "";
  if (appData.settings.darkMode) document.body.classList.add("dark-mode");
  if (appData.settings.themeColor && appData.settings.themeColor !== "default") {
    document.body.classList.add("theme-" + appData.settings.themeColor);
  }
  updateModeButtons();
}

function updateTransparency(v) {
  document.documentElement.style.setProperty("--panel-alpha", v);
  appData.settings.transparency = parseFloat(v);
}
window.updateTransparency = updateTransparency;

function updateBorderRadius(v) {
  document.documentElement.style.setProperty("--radius-panel", `${v}px`);
  appData.settings.borderRadius = parseInt(v) || 10;
}
window.updateBorderRadius = updateBorderRadius;

function applySettings() {
  if (appData.settings.wallpaper) {
    document.body.style.backgroundImage = `url('${resolvePath(appData.settings.wallpaper)}')`;
  } else {
    document.body.style.backgroundImage = "";
  }

  applyThemeClasses();

  const tImg = $("timer-bg-img");
  if (tImg) {
    if (appData.settings.timerBg) {
      tImg.src = resolvePath(appData.settings.timerBg);
      tImg.style.display = "block";
    } else {
      tImg.style.display = "none";
    }
  }

  if (appData.settings.transparency != null) updateTransparency(appData.settings.transparency);
  if (appData.settings.borderRadius != null) updateBorderRadius(appData.settings.borderRadius);
}
window.applySettings = applySettings;

window.setTheme = function (name) {
  appData.settings.themeColor = name;
  applyThemeClasses();
  saveData();
};

window.setDarkMode = function (isDark) {
  appData.settings.darkMode = !!isDark;
  applyThemeClasses();
  saveData();
};

window.toggleDark = function () {
  window.setDarkMode(!appData.settings.darkMode);
};

window.clearTimerBg = function () {
  appData.settings.timerBg = null;
  applySettings();
  saveData();
};

/* =========================
   ALERT / CONFIRM
========================= */
window.openAlert = function (title, message) {
  const m = $("alert-modal");
  if (m && $("alert-title") && $("alert-msg")) {
    $("alert-title").innerHTML = title;
    $("alert-msg").innerText = message;
    m.style.display = "flex";
  } else {
    alert(message);
  }
};
window.closeAlert = function () { const m = $("alert-modal"); if (m) m.style.display = "none"; };

window.openConfirm = function(title, message, onYes) {
  const m = $("confirm-modal");
  if (m) {
    forceTopmostConfirmModal();
    $("confirm-title").innerHTML = title;
    $("confirm-msg").innerText = message;

    const bo = $("btn-confirm-action");
    const bn = bo.cloneNode(true);
    bo.parentNode.replaceChild(bn, bo);
    bn.onclick = () => { onYes(); window.closeConfirm(); };

    m.style.display = "flex";
    requestAnimationFrame(forceTopmostConfirmModal);
  } else if (confirm(message)) onYes();
};

window.closeConfirm = function () { const m = $("confirm-modal"); if (m) m.style.display = "none"; };

/* =========================
   STREAK (ROBUSTO)
========================= */
function updateStreak() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!appData.stats.lastLogDate) {
    appData.stats.streak = 1;
    appData.stats.lastLogDate = today.toDateString();
    return;
  }

  const last = new Date(appData.stats.lastLogDate);
  last.setHours(0, 0, 0, 0);

  const diffTime = today - last;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return;
  if (diffDays === 1) appData.stats.streak = (appData.stats.streak || 0) + 1;
  else appData.stats.streak = 1;

  appData.stats.lastLogDate = today.toDateString();

  const elStreak = $("stat-streak");
  if (elStreak) elStreak.innerText = appData.stats.streak || 0;
}

/* =========================
   SOM
========================= */
function playSound() {
  const a = $("alarm-sound");
  if (!a) return;
  a.src = appData.settings.sound || "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";
  a.play().catch(() => {});
}

/* =========================
   LOGS / STATS (COM META!)
========================= */
/**
 * meta exemplo:
 * { kind:'subject', subjectId: 123 }
 * { kind:'subcard', parentModeId:'leitura', subId: 999 }
 * { kind:'custom', modeId:'leitura' }
 * { kind:'anime' }
 */
function addLogEntry(mode, duration, meta = null) {
  if (!duration || duration <= 0) return;
  const now = new Date();
  const logItem = { id: Date.now(), date: now.toISOString(), mode, duration };

  if (meta && typeof meta === "object") logItem.meta = meta;

  appData.logs.unshift(logItem);
  saveData();
}

/* busca item pra ícone do histórico */

// ==========================================================================
// CORREÇÃO: ÍCONE NO HISTÓRICO
// ==========================================================================
// ==========================================================================
// 4. RECUPERAR ÍCONE DO SUBCARD PARA O LOG
// ==========================================================================
window.getIconHtmlForLog = function(log) {
    const fullName = log.mode || "";
    const baseName = fullName.split(" - ")[0].trim();

    // 1. TENTA VIA META (Se disponível)
    if (log.meta && log.meta.kind) {
        if (log.meta.kind === "subcard") {
            const parentType = log.meta.parentType || "mode";
            const parentId = log.meta.parentId || log.meta.parentModeId;
            const parentKey = parentId ? normalizeParentKey(parentId, parentType) : null;
            const sc = parentKey ? findSubcard(parentKey, log.meta.subId) : null;
            if (sc) return iconHtmlFromItem(sc, 24, true);
        }
        if (log.meta.kind === "subject") {
            const subj = (appData.studySubjects || []).find(s => s.id === log.meta.subjectId);
            if (subj) return iconHtmlFromItem(subj, 24, true);
        }
        // ... (anime/custom defaults)
    }

    // 2. BUSCA PROFUNDA POR NOME (Para garantir que ache o subcard)
    // Primeiro, varre todas as pastas procurando um subcard com esse nome
    if (appData.customModes) {
        for (const cm of appData.customModes) {
            if (cm.subItems) {
                const foundSub = cm.subItems.find(s => s.name.trim() === baseName);
                if (foundSub) return iconHtmlFromItem(foundSub, 24, true);
            }
        }
    }
    if (appData.studySubjects) {
        for (const subj of appData.studySubjects) {
            if (subj.subItems) {
                const foundSub = subj.subItems.find(s => s.name.trim() === baseName);
                if (foundSub) return iconHtmlFromItem(foundSub, 24, true);
            }
        }
    }

    // Depois procura na raiz (Estudo Total)
    const subjectFound = (appData.studySubjects || []).find(s => s.name === baseName);
    if (subjectFound) return iconHtmlFromItem(subjectFound, 24, true);

    // Por último, assume que é uma Pasta
    const customFound = (appData.customModes || []).find(m => m.name === baseName);
    if (customFound) {
        if (customFound.customIcon) return `<div class="log-icon"><img src="${resolvePath(customFound.customIcon)}" style="width:24px; height:24px; border-radius:6px; object-fit:cover;"></div>`;
        const v = getModeVisuals(customFound.id);
        return `<div class="log-icon" style="color:${v.color}"><i class="fas fa-${v.icon}"></i></div>`;
    }

    return `<div class="log-icon" style="color:#ccc"><i class="fas fa-clock"></i></div>`;
};

function iconHtmlFromItem(item, size = 24, round = true) {
  const imgSrc = item.customImage || item.icon;
  if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
    return `<div class="log-icon"><img src="${resolvePath(imgSrc)}" style="width:${size}px; height:${size}px; border-radius:${round ? "50%" : "6px"}; object-fit:cover;"></div>`;
  }
  return `<div class="log-icon" style="font-size:1.2rem;">${imgSrc || "📚"}</div>`;
}
window.renderLogs = function() {
    const list = document.getElementById("log-list");
    if (!list) return;
    list.innerHTML = "";

    const selStr = selectedDate.toDateString();
    let todaysLogs = (appData.logs || []).filter(log => new Date(log.date).toDateString() === selStr);
    todaysLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    // CHIPS (Mantém agrupamento pelo nome base, sem tag)
    const counts = {};
    todaysLogs.forEach(l => {
        const baseName = (l.mode || "").split(" - ")[0].trim();
        counts[baseName] = (counts[baseName] || 0) + 1;
    });
    // ... (código dos chips igual ao seu, mantido para economizar espaço) ...
    // Se precisar, me avise que mando o bloco dos chips também.

    // LISTA DE LOGS
    todaysLogs.forEach(log => {
        const d = new Date(log.date);
        const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const iconHtml = getIconHtmlForLog(log); // Pega ícone do subcard

        const li = document.createElement("li");
        li.className = "log-item-clean";
        li.innerHTML = `
            <div class="log-left">
                ${iconHtml}
                <div class="log-info">
                    <span class="log-time-stamp">${time}</span>
                    <span class="log-name">${log.mode}</span> 
                </div>
            </div>
            <div class="log-plus">+${log.duration} min</div>
        `;
        list.appendChild(li);
    });
};

function renderDynamicStats() {
  const container = $("stats-list-dynamic");
  if (!container) return;
  container.innerHTML = "";

  const elTotalEstudo = $("stat-total-estudo");
  const elTotalAnime = $("stat-total-anime");
  const elEpisodes = $("stat-episodes");
  const elStreak = $("stat-streak");

  if (elTotalEstudo) elTotalEstudo.innerText = formatTimeCompact(appData.stats.estudo || 0);
  if (elTotalAnime) elTotalAnime.innerText = formatTimeCompact(appData.stats.anime || 0);
  if (elEpisodes) elEpisodes.innerText = appData.stats.episodes || 0;
  if (elStreak) elStreak.innerText = appData.stats.streak || 0;

  const modesToRender = [
    { id: "estudo", name: "Estudo Total" },
    { id: "anime", name: "Anime" },
    ...(appData.customModes || []).map(m => ({ id: m.id, name: m.name, isCustom: true })),
  ];

  modesToRender.forEach(mode => {
    const minutes = appData.stats[mode.id] || 0;
    const timeDisplay = formatTimeCompact(minutes);
    const visuals = getModeVisuals(mode.id);

    const card = document.createElement("div");
    card.className = "rural-panel";
    card.style.cssText = `
      min-width:0; padding:8px 4px; text-align:center;
      display:flex; flex-direction:column; justify-content:center; align-items:center;
      cursor:pointer; transition:transform 0.2s;
      background:var(--bg-paper); border:1px solid var(--border-soft); border-radius:6px;
    `;
    card.onmouseover = () => card.style.transform = "translateY(-2px)";
    card.onmouseout = () => card.style.transform = "translateY(0)";

    let iconHtml = "";
    if (mode.id === "estudo") {
      iconHtml = `<div style="font-size:1.1rem; color:var(--primary-green); margin-bottom:4px;"><i class="fas fa-layer-group"></i></div>`;
      card.style.border = "1px solid var(--primary-green)";
      card.title = "Matérias";
      card.onclick = () => window.openStudyMenu();
    } else if (visuals.customImage) {
      iconHtml = `<img src="${resolvePath(visuals.customImage)}" style="width:22px; height:22px; border-radius:4px; object-fit:cover; margin-bottom:4px;">`;
      card.title = (mode.id === "anime") ? "Timer" : "Subcards";
    } else {
      iconHtml = `<div style="font-size:1.1rem; color:${visuals.color || "var(--text-gray)"}; margin-bottom:4px;"><i class="fas fa-${visuals.icon}"></i></div>`;
      card.title = (mode.id === "anime") ? "Timer" : "Subcards";
    }

    card.innerHTML = `
      ${iconHtml}
      <div style="font-size:0.75rem; font-weight:bold; color:var(--text-brown); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">${mode.name}</div>
      <div style="font-size:0.75rem; color:var(--text-gray);">${timeDisplay}</div>
    `;

    if (mode.id === "anime") {
      card.onclick = () => window.switchMode("anime");
    } else if (mode.id !== "estudo") {
      card.onclick = () => window.openUniversalMenu(mode.id);
      if (mode.isCustom) {
        card.oncontextmenu = (e) => {
          e.preventDefault();
          window.deleteCustomMode(mode.id);
        };
      }
    }

    container.appendChild(card);
  });
}

function refreshAllData() {
  renderLogs();
  renderDynamicStats();
  if (typeof window.renderAnimeList === "function") window.renderAnimeList();
}
window.refreshAllData = refreshAllData;

/* =========================
   INDICADOR TOPO (MATÉRIA / SUBCARD)
========================= */
function ensureIndicatorEl() {
  let label = $("subject-indicator");
  if (!label) {
    label = document.createElement("div");
    label.id = "subject-indicator";
    label.style.cssText = `
      background: var(--bg-paper);
      border: 1px solid var(--primary-green);
      color: var(--primary-green);
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9rem;
      font-weight: bold;
      margin-bottom: 10px;
      display: none;
      align-items: center;
      gap: 8px;
    `;
    const timerBody = document.querySelector(".timer-body");
    if (timerBody) timerBody.insertBefore(label, timerBody.firstChild);
  }
  return label;
}

function updateTimerIndicatorForItem(item) {
  const label = ensureIndicatorEl();
  if (!item) { label.style.display = "none"; return; }

  const imgSrc = item.customImage || item.icon;
  let iconHTML = "";
  if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
    iconHTML = `<img src="${resolvePath(imgSrc)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
  } else {
    iconHTML = `<span style="font-size:1.2rem;line-height:1;">${imgSrc || "📌"}</span>`;
  }

  const tagDisplay = item.currentTag ? ` - <small style="opacity:0.8">${item.currentTag}</small>` : "";
  label.innerHTML = `${iconHTML} <span>${item.name}${tagDisplay}</span>`;
  label.style.display = "inline-flex";
}

function updateSubcardIndicator(parentModeId, subcard) {
  updateTimerIndicatorForItem(subcard);
}
window.updateSubcardIndicator = updateSubcardIndicator;

/* =========================
   TIMER ENGINE (SEM DUPLA CONTAGEM) + LOG META
========================= */
// ==========================================================================
// CORREÇÃO: SALVAR SUBCARD E TAG NO HISTÓRICO
// ==========================================================================
// ==========================================================================
// 3. FINALIZAR TIMER (Salva o Nome/Tag Corretos)
// ==========================================================================
window.finishTimer = function() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;

    if(typeof playSound === 'function') playSound();
    updateStreak();

    let duration = sessionTargetMinutes > 0 ? sessionTargetMinutes : Math.floor(getDurationForMode(currentMode) / 60000);
    if (duration <= 0) duration = 1;

    if (!appData.stats) appData.stats = { estudo: 0, anime: 0, episodes: 0, streak: 0 };

    let logName = currentMode;
    let logMeta = null;

    // --- CAMINHO A: ANIME ---
    if (currentMode === "anime") {
        appData.stats.anime = (appData.stats.anime || 0) + duration;
        appData.stats.episodes = (appData.stats.episodes || 0) + 1;
        logName = "Anime";
        logMeta = { kind: "anime" };
    } 
    
    // --- CAMINHO B: ESTUDO TOTAL (RAIZ) ---
    else if (currentMode === "estudo") {
        appData.stats.estudo = (appData.stats.estudo || 0) + duration;
        
        if (currentSubject) {
            // Atualiza minutos
            const ref = (appData.studySubjects || []).find(s => s.id === currentSubject.id);
            if (ref) ref.totalMinutes = (ref.totalMinutes || 0) + duration;
            
            if (currentSubcard && currentSubcardParent?.type === "subject" && String(currentSubcardParent.id) === String(currentSubject.id)) {
                const subRef = ref?.subItems?.find(s => s.id === currentSubcard.id);
                if (subRef) subRef.totalMinutes = (subRef.totalMinutes || 0) + duration;

                const tagPart = currentSubcard.currentTag ? ` - ${currentSubcard.currentTag}` : "";
                logName = `${currentSubject.name} - ${currentSubcard.name}${tagPart}`;
                logMeta = { kind: "subcard", parentType: "subject", parentId: currentSubject.id, subId: currentSubcard.id };
            } else {
                // Define Nome e Tag
                const tagPart = currentSubject.currentTag ? ` - ${currentSubject.currentTag}` : "";
                logName = `${currentSubject.name}${tagPart}`;
                logMeta = { kind: "subject", subjectId: currentSubject.id };
            }
        } else {
            logName = "Estudo Geral";
        }
    } 
    
    // --- CAMINHO C: CARDS CUSTOMIZADOS (PASTAS) ---
    else {
        appData.stats[currentMode] = (appData.stats[currentMode] || 0) + duration;
        const parentObj = (appData.customModes || []).find(m => m.id === currentMode);
        
        // TENTA RECUPERAR SUBCARD DA MEMÓRIA SE NECESSÁRIO
        if (!currentSubcard && window.memSubcardId && window.memParentId === currentMode) {
            if (parentObj) currentSubcard = parentObj.subItems.find(s => s.id === window.memSubcardId);
        }

        if (currentSubcard && parentObj) {
            // Atualiza minutos do subcard
            const ref = parentObj.subItems.find(s => s.id === currentSubcard.id);
            if (ref) ref.totalMinutes = (ref.totalMinutes || 0) + duration;

            // Define Nome e Tag (AQUI É ONDE ESTAVA O ERRO ANTES)
            // Agora usamos o nome do SUBCARD, não do Pai.
            const tagPart = currentSubcard.currentTag ? ` - ${currentSubcard.currentTag}` : "";
            logName = `${currentSubcard.name}${tagPart}`;
            
            // Meta crucial para o ícone
            logMeta = { kind: "subcard", parentType: "mode", parentId: parentObj.id, parentModeId: parentObj.id, subId: currentSubcard.id };
        } else {
            // Se nenhum subcard foi escolhido, usa o nome da Pasta
            logName = parentObj ? parentObj.name : currentMode;
            logMeta = { kind: "custom", modeId: currentMode };
        }
    }

    addLogEntry(logName, duration, logMeta);

    // Reset UI
    sessionTargetMinutes = 0; currentSessionMinutes = 0;
    remainingTimeMs = getDurationForMode(currentMode);
    updateDisplay(remainingTimeMs);
    const btn = document.getElementById("start-btn"); if (btn) { btn.innerText = "Começar"; btn.classList.remove("paused"); }
    const timerEl = document.getElementById("timer"); if (timerEl) { timerEl.setAttribute("contenteditable", "true"); timerEl.style.opacity = "1"; timerEl.style.pointerEvents = "auto"; }
    lockTabs(false);
    saveData();
    refreshAllData();
};
window.toggleTimer = function () {
  const btn = $("start-btn");
  const timerEl = $("timer");
  if (!btn || !timerEl) return;

  if (isRunning) {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;

    btn.innerText = "Continuar";
    btn.classList.add("paused");
    lockTabs(false);

    timerEl.setAttribute("contenteditable", "true");
    timerEl.style.opacity = "1";
    timerEl.style.pointerEvents = "auto";

    remainingTimeMs = endTime - Date.now();
    if (remainingTimeMs < 0) remainingTimeMs = 0;

    saveTimerState();
    return;
  }

  isRunning = true;
  btn.innerText = "Pausar";
  btn.classList.remove("paused");
  lockTabs(true);

  timerEl.setAttribute("contenteditable", "false");
  timerEl.style.opacity = "0.7";
  timerEl.style.pointerEvents = "none";

  if (!sessionTargetMinutes || sessionTargetMinutes === 0) {
    const defaultTime = getDurationForMode(currentMode);
    if (Math.abs(remainingTimeMs - defaultTime) < 1000) {
      sessionTargetMinutes = Math.floor(defaultTime / 60000);
    } else {
      sessionTargetMinutes = Math.ceil(remainingTimeMs / 60000);
    }
  }

  if (remainingTimeMs <= 0) remainingTimeMs = getDurationForMode(currentMode);
  endTime = Date.now() + remainingTimeMs;

  timerInterval = setInterval(() => {
    const now = Date.now();
    const distance = endTime - now;

    if (distance <= 0) {
      finishTimer();
      return;
    }

    updateDisplay(distance);

    const sec = Math.floor(distance / 1000);
    if (sec > 0 && sec % 60 === 0 && sec !== lastLoggedSecond) {
      currentSessionMinutes++;
      lastLoggedSecond = sec;
      saveTimerState();
    }
  }, 100);
};

window.resetTimer = function () {
  clearInterval(timerInterval);
  timerInterval = null;
  isRunning = false;

  currentSessionMinutes = 0;
  sessionTargetMinutes = 0;
  lastLoggedSecond = null;

  const btn = $("start-btn");
  if (btn) {
    btn.innerText = "Começar";
    btn.classList.remove("paused");
  }

  lockTabs(false);

  const timerEl = $("timer");
  if (timerEl) {
    timerEl.setAttribute("contenteditable", "true");
    timerEl.style.opacity = "1";
    timerEl.style.pointerEvents = "auto";
  }

  remainingTimeMs = getDurationForMode(currentMode);
  updateDisplay(remainingTimeMs);
  saveTimerState();
};

window.adjustTime = function (minutes) {
  const ms = minutes * 60000;

  if (isRunning) {
    endTime += ms;
    const dist = endTime - Date.now();
    updateDisplay(dist > 0 ? dist : 0);
  } else {
    remainingTimeMs += ms;
    if (remainingTimeMs < 0) remainingTimeMs = 0;
    updateDisplay(remainingTimeMs);
    saveDurationForMode(currentMode, remainingTimeMs);
  }

  saveTimerState();
};

function setMode(mode) {
    currentMode = mode;

    // Se mudou para Estudo ou Anime, limpa o subcard ativo.
    // MAS, se mudou para um modo Customizado (pasta), MANTÉM o subcard ativo se ele pertencer a essa pasta.
    if (mode === "estudo" || mode === "anime") {
        const keepSubjectSubcard = mode === "estudo"
          && currentSubcard
          && currentSubcardParent?.type === "subject";

        if (!keepSubjectSubcard) {
            currentSubcard = null;
            currentSubcardParent = null;
            window.activeSubcardId = null;
        }
    } else {
        // Se estamos indo para uma pasta, verificamos se o subcard atual pertence a ela.
        // Se pertencer (ex: clicou no subcard), mantém. Se for troca de aba manual, limpa.
        if (currentSubcard && currentSubcardParent?.type === "mode" && String(currentSubcardParent.id) !== String(mode)) {
            currentSubcard = null;
            currentSubcardParent = null;
            window.activeSubcardId = null;
        }
    }
    
    if (mode !== "estudo") currentSubject = null;

    currentSessionMinutes = 0;
    lastLoggedSecond = null;
    sessionTargetMinutes = 0;

    remainingTimeMs = getDurationForMode(mode);
    updateDisplay(remainingTimeMs);
    setModeVisual(mode);
    saveTimerState();

    if (currentSubcard && currentSubcardParent?.type === "subject" && mode === "estudo") {
        updateTimerIndicatorForItem(currentSubcard);
    }
    else if (mode === "estudo" && currentSubject) {
        updateTimerIndicatorForItem(currentSubject);
    }
    else if (currentSubcard) updateTimerIndicatorForItem(currentSubcard); // Prioriza Subcard
    else updateTimerIndicatorForItem(null);
}

window.switchMode = function (mode) {
  if (isRunning) {
    window.openConfirm('<i class="fas fa-clock"></i> Timer Rodando', `Deseja parar o timer atual e trocar para ${String(mode).toUpperCase()}?`, () => {
      window.resetTimer();
      setMode(mode);
    });
  } else {
    setMode(mode);
  }
};

/* =========================
   TIMER EDIT (contenteditable)
========================= */
function setupTimerEdit() {
  const t = $("timer");
  if (!t) return;

  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      t.blur();
    }
  });

  t.addEventListener("blur", () => {
    const txt = t.innerText.trim();
    let m = 0, s = 0;

    if (txt.includes(":")) {
      const p = txt.split(":");
      m = parseInt(p[0]) || 0;
      s = parseInt(p[1]) || 0;
    } else {
      m = parseInt(txt) || 0;
    }

    if (m < 0) m = 0;
    if (s > 59) s = 59;

    remainingTimeMs = (m * 60 * 1000) + (s * 1000);
    sessionTargetMinutes = 0;

    updateDisplay(remainingTimeMs);
    saveDurationForMode(currentMode, remainingTimeMs);
    saveTimerState();
  });

  t.addEventListener("click", () => {
    if (isRunning) window.toggleTimer();
  });
}

/* =========================
   MODOS / ABAS
========================= */
function getModeVisuals(modeId) {
  const id = String(modeId || "").toLowerCase();

  if (appData.modeConfigs && appData.modeConfigs[id] && appData.modeConfigs[id].icon) {
    return { icon: "star", color: "#fdd835", customImage: appData.modeConfigs[id].icon };
  }

  const cm = (appData.customModes || []).find(m => m.id === id);
  if (cm) {
    if (cm.customIcon) return { icon: "star", color: "#ccc", customImage: cm.customIcon };
    return { icon: "star", color: "#fdd835" };
  }

  if (id === "estudo") return { icon: "book", color: "#4caf50" };
  if (id === "anime") return { icon: "tv", color: "#ff9800" };
  if (id.includes("leitura") || id.includes("ler")) return { icon: "book-open", color: "#00bcd4" };
  if (id.includes("anki") || id.includes("flash")) return { icon: "layer-group", color: "#9c27b0" };
  if (id.includes("code") || id.includes("prog")) return { icon: "code", color: "#3f51b5" };
  if (id.includes("treino") || id.includes("gym")) return { icon: "dumbbell", color: "#f44336" };
  if (id.includes("escrever") || id.includes("write")) return { icon: "pen-nib", color: "#795548" };
  if (id.includes("jogo") || id.includes("game")) return { icon: "gamepad", color: "#e91e63" };

  return { icon: "star", color: "#fdd835" };
}

function renderCustomTabs() {
  const w = $("tabs-wrapper");
  if (!w) return;

  const add = w.querySelector(".pill-tab-add");
  if (!add) return;

  w.querySelectorAll(".pill-tab").forEach(e => e.remove());

  const allModes = [
    { id: "estudo", name: "Estudo", isDefault: true },
    { id: "anime", name: "Anime", isDefault: true },
    ...(appData.customModes || []),
  ];

  allModes.forEach(m => {
    const b = document.createElement("button");
    b.className = "pill-tab";
    b.dataset.mode = m.id;

    let customImg = m.customIcon;
    if (!customImg && appData.modeConfigs?.[m.id]?.icon) customImg = appData.modeConfigs[m.id].icon;

    let iconHtml = "";
    if (customImg) {
      iconHtml = `<img src="${resolvePath(customImg)}" style="width:16px; height:16px; border-radius:3px; object-fit:cover; vertical-align:middle;">`;
    } else {
      const v = getModeVisuals(m.id);
      if (v.customImage) iconHtml = `<img src="${resolvePath(v.customImage)}" style="width:16px; height:16px; border-radius:3px; object-fit:cover; vertical-align:middle;">`;
      else iconHtml = `<i class="fas fa-${v.icon}" style="color:${v.color}"></i>`;
    }

    if (m.id === "estudo") {
      b.innerHTML = `<i class="fas fa-book"></i> Estudo Total`;
      b.onclick = () => window.openStudyMenu();
    } else {
      b.innerHTML = `${iconHtml} ${m.name}`;
      b.onclick = () => window.switchMode(m.id);
    }

    if (!m.isDefault) {
      const closeBtn = document.createElement("span");
      closeBtn.innerText = " ✕";
      closeBtn.style.fontSize = "10px";
      closeBtn.style.marginLeft = "5px";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        window.deleteCustomMode(m.id);
      };
      b.appendChild(closeBtn);
    }

    if (currentMode === m.id) b.classList.add("active");
    w.insertBefore(b, add);
  });
}

window.openModal = function () {
  const m = $("custom-modal");
  if (!m) return;
  m.style.display = "flex";
  const i = $("custom-name-input");
  if (i) i.focus();
};

window.closeModal = function () {
  const m = $("custom-modal");
  if (m) m.style.display = "none";
};

window.confirmCustomTimer = function () {
  const input = $("custom-name-input");
  if (!input) return;

  const n = input.value.trim();
  if (!n) return;

  const id = n.toLowerCase().replace(/\s/g, "_");

  if ((appData.customModes || []).find(c => c.id === id) || id === "estudo" || id === "anime") {
    window.openAlert("Erro", "Nome já existe!");
    return;
  }

  const finalIcon = processImage(tempCustomIcon);

  appData.customModes.push({
    name: n,
    id,
    customIcon: finalIcon,
    totalMinutes: 0,
    subItems: [],
  });

  saveDurationForMode(id, 30 * 60 * 1000);

  tempCustomIcon = null;
  const st = $("custom-icon-status");
  if (st) { st.innerText = "Nenhum"; st.style.color = ""; }
  input.value = "";

  saveData();
  window.closeModal();
  renderCustomTabs();
  refreshAllData();
  renderTimerManagement();
  window.switchMode(id);
};

window.deleteCustomMode = function (id) {
  const performDelete = () => {
    const modeObj = (appData.customModes || []).find(m => m.id === id);
    const nameToDelete = modeObj ? modeObj.name : null;

    appData.customModes = (appData.customModes || []).filter(m => m.id !== id);

    // remove logs por META (correto)
    appData.logs = (appData.logs || []).filter(l => {
      if (l.meta && l.meta.kind === "custom" && l.meta.modeId === id) return false;
      if (l.meta && l.meta.kind === "subcard") {
        if (String(l.meta.parentModeId) === String(id)) return false;
        if (l.meta.parentType === "mode" && String(l.meta.parentId) === String(id)) return false;
      }
      return true;
    });

    // fallback legado por texto (se tiver logs antigos)
    if (nameToDelete) {
      const re = new RegExp("^" + escapeRegExp(nameToDelete) + "(\\s-\\s|$)", "i");
      appData.logs = (appData.logs || []).filter(l => !re.test(String(l.mode || "")));
    }

    if (appData.stats[id]) delete appData.stats[id];

    if (currentMode === id) window.switchMode("estudo");

    saveData();
    renderCustomTabs();
    refreshAllData();
    renderTimerManagement();
  };

  window.openConfirm(
    '<i class="fas fa-trash-alt"></i> Excluir Card',
    "Isso apagará o card e TODO o histórico dele (incluindo tags e subcards). Continuar?",
    performDelete
  );
};

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================
   TIMER MANAGEMENT (SETTINGS)
========================= */
function renderTimerManagement() {
  const list = $("timers-management-list");
  if (!list) return;
  list.innerHTML = "";

  const createItem = (id, name, customIcon) => {
    const item = document.createElement("div");
    item.className = "timer-manage-item";

    let displayImg = customIcon;
    if (!displayImg && appData.modeConfigs?.[id]?.icon) displayImg = appData.modeConfigs[id].icon;

    const iconDisplay = displayImg
      ? `<img src="${resolvePath(displayImg)}" style="width:20px;height:20px;border-radius:3px;vertical-align:middle;object-fit:cover;">`
      : `<i class="fas fa-clock"></i>`;

    const isDefault = (id === "estudo" || id === "anime");
    const titleBtn = isDefault ? "" : `<button class="btn-rural small" onclick="editTimerTitle('${id}')">Título</button>`;

    item.innerHTML = `
      <span>${iconDisplay} <strong>${name}</strong></span>
      <div class="timer-manage-actions">
        <button class="btn-rural small" onclick="editTimerIcon('${id}')">Ícone</button>
        ${titleBtn}
      </div>
    `;
    list.appendChild(item);
  };

  createItem("estudo", "Estudo", null);
  createItem("anime", "Anime", null);
  (appData.customModes || []).forEach(m => createItem(m.id, m.name, m.customIcon));
}

window.openSettings = function () {
  const m = $("settings-modal");
  if (!m) return;
  m.style.display = "flex";
  renderTimerManagement();
};

window.closeSettings = function () {
  const m = $("settings-modal");
  if (m) m.style.display = "none";
};

window.editTimerIcon = function (id) {
  editingTimerId = id;
  const inp = $("file-edit-icon");
  if (inp) inp.click();
};

window.editTimerTitle = function (id) {
  const timer = (appData.customModes || []).find(m => m.id === id);
  if (!timer) return;
  const newName = prompt("Novo nome:", timer.name);
  if (newName && newName.trim() !== "") {
    timer.name = newName.trim();
    saveData();
    renderCustomTabs();
    renderTimerManagement();
    refreshAllData();
  }
};

/* =========================
   CALENDÁRIO / SEMANA
========================= */
function updateCalendarLabel() {
  const el = $("current-month-label");
  if (!el) return;
  const m = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  el.innerText = m.charAt(0).toUpperCase() + m.slice(1);
}

function renderWeekTabs() {
  const d = selectedDate.getDay();
  document.querySelectorAll(".week-day-btn").forEach(btn => {
    btn.classList.remove("active");
    if (parseInt(btn.dataset.day) === d) btn.classList.add("active");
  });
}

function selectDay(dayIndex) {
  const diff = dayIndex - selectedDate.getDay();
  selectedDate.setDate(selectedDate.getDate() + diff);
  renderWeekTabs();
  refreshAllData();
}
window.selectDay = selectDay;

function renderCalendarGrid() {
  const grid = document.querySelector(".cal-grid-months");
  if (!grid) return;
  grid.innerHTML = "";

  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const today = new Date();

  months.forEach((m, index) => {
    const btn = document.createElement("button");
    btn.className = "cal-month-btn";
    btn.innerText = m;

    if (index === selectedDate.getMonth() && currentCalendarYear === selectedDate.getFullYear()) {
      btn.classList.add("active");
    }

    btn.onclick = () => {
      if (index === today.getMonth() && currentCalendarYear === today.getFullYear()) {
        selectedDate = new Date();
      } else {
        selectedDate.setFullYear(currentCalendarYear);
        selectedDate.setMonth(index);
        selectedDate.setDate(1);
      }
      toggleCalendar(false);
      updateCalendarLabel();
      renderWeekTabs();
      selectDay(selectedDate.getDay());
      refreshAllData();
    };

    grid.appendChild(btn);
  });
}

function toggleCalendar(forceHide = true) {
  const popup = $("calendar-popup");
  if (!popup) return;
  if (forceHide) popup.style.display = "none";
  else popup.style.display = (popup.style.display === "none" ? "block" : "none");
}

function changeCalendarYear(delta) {
  currentCalendarYear += delta;
  const el = $("cal-year-display");
  if (el) el.innerText = currentCalendarYear;
  renderCalendarGrid();
}
window.changeCalendarYear = changeCalendarYear;

/* =========================
   MODAIS / CLICKS GLOBAIS
========================= */
function setupGlobalClicks() {
  window.addEventListener("click", (e) => {
    document.querySelectorAll(".modal-overlay").forEach(m => {
      if (e.target === m) m.style.display = "none";
    });

    const popup = $("calendar-popup");
    const btnMonth = $("btn-month-selector");
    if (popup && popup.style.display !== "none" && btnMonth && !btnMonth.contains(e.target)) {
      toggleCalendar(true);
    }
  });
}

function setupInputEnter() {
  const i = $("custom-name-input");
  if (!i) return;
  i.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.confirmCustomTimer();
  });
}

function setupDragScroll() {
  const s = $("tabs-wrapper");
  if (!s) return;

  s.addEventListener("mousedown", (e) => {
    isDown = true;
    startX = e.pageX - s.offsetLeft;
    scrollLeft = s.scrollLeft;
  });

  s.addEventListener("mouseleave", () => isDown = false);
  s.addEventListener("mouseup", () => isDown = false);

  s.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - s.offsetLeft;
    const w = (x - startX) * 2;
    s.scrollLeft = scrollLeft - w;
  });
}

/* =========================
   IMPORT / EXPORT
========================= */
window.exportData = function () {
  const a = document.createElement("a");
  a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
  a.download = "animedoro_data.json";
  a.click();
};

/* =========================
   TAGS UNIVERSAIS (1 ÚNICO SISTEMA)
========================= */
function getEditingItem() {
  if (editContext.type === "subject") {
    return (appData.studySubjects || []).find(s => s.id === editContext.subjectId) || null;
  }
  if (editContext.type === "subcard") {
    if (editContext.parentType === "subject") {
      const parent = (appData.studySubjects || []).find(s => String(s.id) === String(editContext.parentModeId));
      if (!parent || !Array.isArray(parent.subItems)) return null;
      return parent.subItems.find(s => s.id === editContext.subId) || null;
    }

    const parent = (appData.customModes || []).find(m => m.id === editContext.parentModeId);
    if (!parent || !Array.isArray(parent.subItems)) return null;
    return parent.subItems.find(s => s.id === editContext.subId) || null;
  }
  return null;
}

function renderTagsInModal() {
  const container = $("subject-tags-list");
  if (!container) return;

  container.innerHTML = "";
  const item = getEditingItem();

  if (!item) {
    container.innerHTML = `<span style="font-size:0.75rem;opacity:0.7;">Nenhum item selecionado.</span>`;
    return;
  }

  const tags = item.tags || [];
  if (tags.length === 0) {
    container.innerHTML = `<span style="font-size:0.75rem;opacity:0.7;">Sem tags ainda.</span>`;
    return;
  }

  tags.forEach(tag => {
    const safe = String(tag).replace(/'/g, "\\'");
    const div = document.createElement("div");
    div.className = `subject-tag-item ${item.currentTag === tag ? "active-tag" : ""}`;
    div.innerHTML = `
      <span onclick="selectTagForSubject('${safe}')">${tag}</span>
      <span class="delete-tag" onclick="removeTagFromSubject('${safe}', event)">×</span>
    `;
    container.appendChild(div);
  });
}
window.renderTagsInModal = renderTagsInModal;

window.addTagToSubject = function () {
  const input = $("new-tag-input");
  if (!input) return;

  const tagName = input.value.trim();
  if (!tagName) return;

  const item = getEditingItem();
  if (!item) return;

  if (!Array.isArray(item.tags)) item.tags = [];
  if (!item.tags.includes(tagName)) item.tags.push(tagName);

  input.value = "";
  saveData();
  renderTagsInModal();
};

window.selectTagForSubject = function (tag) {
  const item = getEditingItem();
  if (!item) return;

  item.currentTag = (item.currentTag === tag) ? null : tag;

  saveData();
  renderTagsInModal();

  if (editContext.type === "subject") {
    window.renderStudySubjects();
    if (currentSubject && currentSubject.id === item.id) updateTimerIndicatorForItem(item);
  } else {
    renderUniversalSubCards();
    if (currentSubcard && currentSubcard.id === item.id) updateTimerIndicatorForItem(item);
  }
};

window.removeTagFromSubject = function (tag, event) {
  if (event) event.stopPropagation();

  const item = getEditingItem();
  if (!item) return;

  item.tags = (item.tags || []).filter(t => t !== tag);
  if (item.currentTag === tag) item.currentTag = null;

  saveData();
  renderTagsInModal();

  if (editContext.type === "subject") {
    window.renderStudySubjects();
    if (currentSubject && currentSubject.id === item.id) updateTimerIndicatorForItem(item);
  } else {
    renderUniversalSubCards();
    if (currentSubcard && currentSubcard.id === item.id) updateTimerIndicatorForItem(item);
  }
};

// ✅ ENTER NO INPUT DE TAG (1x só — sem duplicar)
function setupTagEnter() {
  const modal = $("edit-subject-modal");
  if (!modal) return;

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.id === "new-tag-input") {
      e.preventDefault();
      window.addTagToSubject();
      e.target.focus();
    }
  });
}

// upload ícone no modal (matéria/subcard)
window.triggerImageUpload = function () {
  const input = $("file-subject-icon");
  if (!input) return;

  input.value = "";
  input.click();

  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    changeIconForEditingItem(file);
  };
};

function changeIconForEditingItem(file) {
  try {
    const id = Date.now();
    const sourcePath = file.path;

    const targetDir = "user_images";
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);

    const ext = path.extname(sourcePath) || ".png";
    const newName = `icon_${id}${ext}`;
    const destPath = path.join(targetDir, newName);

    fs.copyFileSync(sourcePath, destPath);

    const savedPath = path.join("user_images", newName);
    const item = getEditingItem();
    if (!item) return;

    item.customImage = savedPath;
    item.icon = savedPath;

    saveData();

    if (editContext.type === "subject") window.renderStudySubjects();
    else renderUniversalSubCards();

    if (currentSubject && editContext.type === "subject" && currentSubject.id === item.id) updateTimerIndicatorForItem(item);
    if (currentSubcard && editContext.type === "subcard" && currentSubcard.id === item.id) updateTimerIndicatorForItem(item);
  } catch (err) {
    console.error("changeIconForEditingItem erro:", err);
  }
}

/* =========================
   MATÉRIAS (STUDY MENU)
========================= */
window.openStudyMenu = function () {
  const modal = $("study-menu-modal");
  if (!modal) return;
  modal.style.display = "flex";
  window.renderStudySubjects();
};

window.closeStudyMenu = function () {
  const modal = $("study-menu-modal");
  if (modal) modal.style.display = "none";
};

window.openNewSubjectModal = function() {
    console.log("✨ Abrindo modal de criação...");
    
    // 1. Limpa os campos
    const nameInput = document.getElementById('new-subject-name');
    const emojiInput = document.getElementById('new-subject-emoji');
    if(nameInput) nameInput.value = '';
    if(emojiInput) emojiInput.value = '';
    
    const status = document.getElementById('subject-img-status');
    if(status) {
        status.innerText = "Nenhuma";
        status.style.color = "";
    }
    tempSubjectImg = null;

    // 2. Mostra o Modal
    const modal = document.getElementById('new-subject-modal');
    if(modal) {
        modal.style.display = 'flex';
        
        // --- A CORREÇÃO BRUTA ---
        // Procura o botão de confirmar dentro desse modal
        // Geralmente é o último botão ou tem a classe btn-rural
        const footer = modal.querySelector('.modal-footer');
        if (footer) {
            const confirmBtn = footer.querySelector('button');
            if (confirmBtn) {
                // Remove eventos antigos clonando o botão
                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
                
                // Adiciona o evento de clique explicitamente
                newBtn.onclick = function() {
                    console.log("🖱️ Botão Criar Clicado!");
                    window.confirmCreateSubject();
                };
                console.log("✅ Botão 'Criar' reconectado com sucesso.");
            }
        }
    }
};

window.confirmCreateSubject = function () {
  const name = ($("new-subject-name")?.value || "").trim();
  const emoji = ($("new-subject-emoji")?.value || "").trim();

  if (!name) { alert("Nome obrigatório!"); return; }

  let finalImg = null;
  if (tempSubjectImg) finalImg = processImage(tempSubjectImg);

  const finalIcon = emoji || "📘";

  appData.studySubjects.push({
    id: Date.now(),
    name,
    icon: finalIcon,
    customImage: finalImg,
    totalMinutes: 0,
    tags: [],
    currentTag: null,
  });

  saveData();
  const m = $("new-subject-modal");
  if (m) m.style.display = "none";
  window.renderStudySubjects();
};

window.deleteSubject = function (id, event) {
  if (event) event.stopPropagation();

  const subject = (appData.studySubjects || []).find(s => s.id === id);
  const nameToDelete = subject ? subject.name : null;

  if (confirm(`Deseja excluir "${nameToDelete}" e APAGAR todo o histórico dessa matéria (incluindo todas as tags)?`)) {
    appData.studySubjects = (appData.studySubjects || []).filter(s => s.id !== id);

    // ✅ remove logs por META (correto)
    appData.logs = (appData.logs || []).filter(l => {
      if (l.meta && l.meta.kind === "subject" && l.meta.subjectId === id) return false;
      if (l.meta && l.meta.kind === "subcard" && l.meta.parentType === "subject" && String(l.meta.parentId) === String(id)) return false;
      return true;
    });

    // fallback legado por nome
    if (nameToDelete) {
      const re = new RegExp("^" + escapeRegExp(nameToDelete) + "(\\s-\\s|$)", "i");
      appData.logs = (appData.logs || []).filter(l => !re.test(String(l.mode || "")));
    }

    if (currentSubject && currentSubject.id === id) currentSubject = null;

    saveData();
    window.renderStudySubjects();
    refreshAllData();
    updateTimerIndicatorForItem(null);
  }
};

window.changeSubjectIconReal = function (id, event) {
  if (event) event.stopPropagation();

  editContext = { type: "subject", subjectId: id, parentModeId: null, subId: null };
  const subject = (appData.studySubjects || []).find(s => s.id === id);
  if (!subject) return;

  forceTopmostEditModal();
  if ($("edit-modal-title")) $("edit-modal-title").innerText = "EDITAR: " + subject.name.toUpperCase();
  openEditModal();
  renderTagsInModal();

  setTimeout(() => {
    const input = $("new-tag-input");
    if (input) { input.value = ""; input.focus(); }
  }, 50);
};

// ==========================================================================
// 1. SELEÇÃO DO ESTUDO TOTAL (Original Restaurado)
// ==========================================================================
window.selectSubject = function (subject) {
    console.log("Selecionando Estudo Total:", subject.name);
    
    // Define variáveis
    currentSubject = subject;
    currentSubcard = null; // Limpa subcard para não confundir
    window.lastSelectedType = 'subject'; // Marca o tipo
    
    // Fecha janelas
    window.closeStudyMenu();
    
    // Força o modo 'estudo'
    if (currentMode !== "estudo") setMode("estudo");
    
    // Atualiza visual
    updateTimerIndicatorForItem(subject);
};

window.renderStudySubjects = function () {
  const grid = $("study-subjects-grid");
  const totalDisplay = $("total-study-time");
  if (!grid) return;

  grid.innerHTML = "";
  let totalTimeAll = 0;

  if (!appData.studySubjects || appData.studySubjects.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#888;font-size:0.8rem;padding:10px;">Nenhuma matéria.</div>`;
  } else {
    appData.studySubjects.forEach(subject => {
      const minutes = parseInt(subject.totalMinutes) || 0;
      totalTimeAll += minutes;

      const card = document.createElement("div");
      card.className = "subject-card rural-panel interactive";
      card.style.cssText = `
        position:relative; display:flex; flex-direction:column;
        align-items:center; justify-content:center; text-align:center;
        min-height:85px; padding:8px 4px;
        background:var(--bg-paper); border:1px solid var(--border-soft);
        border-radius:6px; cursor:pointer;
      `;

      const imgSrc = subject.customImage || subject.icon;
      let iconDisplay = "";
      if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
        iconDisplay = `<img src="${resolvePath(imgSrc)}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;margin-bottom:4px;display:block;">`;
      } else {
        iconDisplay = `<div style="font-size:1.4rem;margin-bottom:4px;line-height:1;">${imgSrc || "📚"}</div>`;
      }

      card.innerHTML = `
        <div onclick="deleteSubject(${subject.id}, event)" title="Excluir"
          style="position:absolute;top:3px;right:4px;color:#ff5252;font-size:11px;font-weight:bold;cursor:pointer;z-index:101;opacity:0.6;padding:2px;"
          onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</div>

        <div class="subject-edit-btn" onclick="changeSubjectIconReal(${subject.id}, event)" title="Editar"
          style="position:absolute;top:4px;left:4px;color:#2196F3;font-size:9px;cursor:pointer;z-index:101;background:rgba(255,255,255,0.9);width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <i class="fas fa-pencil-alt"></i>
        </div>

        ${iconDisplay}

        <div style="font-weight:bold;font-size:0.8rem;color:var(--text-brown);margin-bottom:3px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95%;">
          ${subject.name}
        </div>

        <div style="font-size:0.65rem;color:var(--text-gray);background:rgba(0,0,0,0.04);padding:1px 6px;border-radius:8px;">
          ${formatTimeCompact(minutes)}
        </div>
      `;

      card.onclick = (e) => {
        if (!e.target.closest(".subject-edit-btn") && e.target.innerText !== "✕") {
          window.selectSubject(subject);
        }
      };

      grid.appendChild(card);
    });
  }

  if (totalDisplay) totalDisplay.innerText = formatTimeCompact(totalTimeAll);
};

/* =========================
   SUBCARDS UNIVERSAIS (CUSTOM)
========================= */
window.openUniversalMenu = function (parentId, parentType = "mode") {
  // ✅ FIX: sempre setar e persistir
  const pid = normalizeParentKey(parentId, parentType);
  if (!pid) return;
  setCurrentParentId(pid);

  const modal = $("universal-menu-modal");
  if (!modal) {
    console.error("Faltou o HTML do #universal-menu-modal");
    return;
  }

  const parent = ensureCustomSubItems(pid);
  if (!parent) return;

  if ($("universal-menu-title")) $("universal-menu-title").innerText = `Subcards: ${parent.name}`;
  modal.style.display = "flex";

  setTimeout(() => {
    const input = $("universal-new-subcard-name");
    if (input) input.focus();
  }, 50);

  renderUniversalSubCards();
};

window.closeUniversalMenu = function () {
  const modal = $("universal-menu-modal");
  if (modal) modal.style.display = "none";
  // ✅ NÃO zera o parentId aqui, porque o usuário pode abrir o modal de criação
  // setCurrentParentId(null);
};

function renderUniversalSubCards() {
  const grid = $("universal-subcards-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const pid = getCurrentParentIdSafe();
  const parent = pid ? ensureCustomSubItems(pid) : null;
  if (!parent) return;

  (parent.subItems || []).forEach(sub => {
    const minutes = parseInt(sub.totalMinutes) || 0;

    const card = document.createElement("div");
    card.className = "subject-card rural-panel interactive";
    card.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 85px;
      padding: 8px 4px;
      background: var(--bg-paper);
      border: 1px solid var(--border-soft);
      border-radius: 6px;
      cursor: pointer;
    `;

    const imgSrc = sub.customImage || sub.icon;
    let mediaHtml = "";
    if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
      const resolved = resolvePath(imgSrc);
      mediaHtml = `
        <img src="${resolved}"
          style="width:30px;height:30px;object-fit:cover;border-radius:4px;margin-bottom:4px;display:block;"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <div style="display:none;font-size:1.4rem;margin-bottom:4px;">📌</div>
      `;
    } else {
      mediaHtml = `<div style="font-size:1.4rem;margin-bottom:4px;line-height:1;">${imgSrc || "📌"}</div>`;
    }

    card.innerHTML = `
      <div onclick="deleteUniversalSubcard(${sub.id}, event)" title="Excluir"
        style="position:absolute;top:3px;right:4px;color:#ff5252;font-size:11px;font-weight:bold;cursor:pointer;z-index:101;opacity:0.6;padding:2px;"
        onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</div>

      <div class="subject-edit-btn" onclick="openSubcardEdit(${sub.id}, event)" title="Editar"
        style="position:absolute;top:4px;left:4px;color:#2196F3;font-size:9px;cursor:pointer;z-index:101;background:rgba(255,255,255,0.9);width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <i class="fas fa-pencil-alt"></i>
      </div>

      ${mediaHtml}

      <div style="font-weight:bold;font-size:0.8rem;color:var(--text-brown);margin-bottom:3px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95%;">
        ${sub.name}
      </div>

      <div style="font-size:0.65rem;color:var(--text-gray);background:rgba(0,0,0,0.04);padding:1px 6px;border-radius:8px;">
        ${formatTimeCompact(minutes)}
      </div>
    `;

    card.onclick = (e) => {
      if (!e.target.closest(".subject-edit-btn") && e.target.innerText !== "✕") {
        window.selectUniversalSubcard(sub.id);
      }
    };

    grid.appendChild(card);
  });
}
window.renderUniversalSubCards = renderUniversalSubCards;

window.createUniversalSubcard = function () {
  const pid = getCurrentParentIdSafe();
  if (!pid) {
    window.openAlert("Erro", "Não consegui identificar o card pai. Feche e abra o menu novamente.");
    return;
  }

  const parent = ensureCustomSubItems(pid);
  if (!parent) return;

  const input = $("universal-new-subcard-name");
  if (!input) return;

  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const exists = (parent.subItems || []).some(s => (s.name || "").toLowerCase() === name.toLowerCase());
  if (exists) {
    window.openAlert("Ops", "Já existe um subcard com esse nome.");
    input.select();
    return;
  }

  parent.subItems.push({
    id: Date.now(),
    name,
    icon: "📌",
    customImage: null,
    totalMinutes: 0,
    tags: [],
    currentTag: null,
  });

  saveData();
  renderUniversalSubCards();
  input.value = "";
  input.focus();
};

window.deleteUniversalSubcard = function (subId, event) {
  if (event) event.stopPropagation();

  const pid = getCurrentParentIdSafe();
  const parentKey = pid ? normalizeParentKey(pid) : null;
  const parentInfo = parseParentKey(parentKey);
  const parent = parentKey ? ensureCustomSubItems(parentKey) : null;
  if (!parent) return;

  const sub = (parent.subItems || []).find(s => s.id === subId);
  if (!sub) return;

  const subName = sub.name;

  window.openConfirm(
    '<i class="fas fa-trash-alt"></i> Excluir Subcard',
    `Isso apagará o subcard "${subName}" e TODO o histórico dele (incluindo tags). Continuar?`,
    () => {
      // 1) remove subcard
      parent.subItems = (parent.subItems || []).filter(s => s.id !== subId);

      // 2) remove logs por META (correto, sem colisão)
      appData.logs = (appData.logs || []).filter(l => {
        if (l.meta && l.meta.kind === "subcard") {
          if (parentInfo?.type === "subject") {
            if (l.meta.parentType === "subject" && String(l.meta.parentId) === String(parentInfo.id) && l.meta.subId === subId) return false;
          } else if (String(l.meta.parentModeId) === String(parentInfo?.id) || (l.meta.parentType === "mode" && String(l.meta.parentId) === String(parentInfo?.id))) {
            if (l.meta.subId === subId) return false;
          }
        }
        return true;
      });

      // 3) fallback legado por nome (caso existam logs antigos sem meta)
      const re = new RegExp("^" + escapeRegExp(subName) + "(\\s-\\s|$)", "i");
      appData.logs = (appData.logs || []).filter(l => !re.test(String(l.mode || "")));

      // 4) se estava selecionado
      if (currentSubcard && currentSubcard.id === subId) {
        currentSubcard = null;
        currentSubcardParent = null;
        window.ACTIVE_SESSION = null;
        updateTimerIndicatorForItem(null);
      }

      saveData();
      renderUniversalSubCards();
      refreshAllData();
    }
  );
};

// ==========================================================================
// 2. SELEÇÃO DE SUBCARD CUSTOMIZADO (Com Memória)
// ==========================================================================
window.selectUniversalSubcard = function (subId) {
    const pid = typeof getCurrentParentIdSafe === 'function' ? getCurrentParentIdSafe() : window.currentParentCardId;
    const parentKey = pid ? normalizeParentKey(pid) : null;
    const parent = parentKey ? ensureCustomSubItems(parentKey) : null;
    if (!parent) return;

    const sub = (parent.subItems || []).find(s => s.id === subId);
    if (!sub) return;

    console.log("Selecionando Subcard:", sub.name);
    const parentInfo = parseParentKey(parentKey);

    // Define variáveis
    currentSubcard = sub;
    currentSubcardParent = parentInfo;
    if (parentInfo?.type === "subject") {
      currentSubject = parent;
    } else {
      currentSubject = null; // Limpa sujeito do Estudo Total
    }
    window.lastSelectedType = 'subcard'; // Marca o tipo
    
    // MEMÓRIA DE SEGURANÇA (Para o timer ler depois)
    window.memSubcardId = sub.id;
    window.memParentId = parent.id;
    window.memParentType = parentInfo?.type || "mode";
    window.ACTIVE_SESSION = { type: "subcard", parentId: parent.id, parentType: parentInfo?.type || "mode", subId: sub.id };

    // Fecha janelas
    window.closeUniversalMenu();

    // Define o modo (nome da pasta)
    if (parentInfo?.type === "subject") {
      setMode("estudo");
    } else {
      setMode(parent.id);
    }
    
    // FORÇA A ATUALIZAÇÃO VISUAL COM O SUBCARD (Sobrepondo o setMode)
    setTimeout(() => updateTimerIndicatorForItem(sub), 50);
};



window.openSubcardEdit = function(subId, event){
  if(event) event.stopPropagation();

  const pid = getCurrentParentIdSafe();
  if (!pid) return;
  const parentInfo = parseParentKey(pid);

  editContext = { type: "subcard", subjectId: null, parentModeId: parentInfo?.id || pid, parentType: parentInfo?.type || "mode", subId };

  const sub = findSubcard(pid, subId);
  if(!sub) return;

  if ($("edit-modal-title")) $("edit-modal-title").innerText = "EDITAR: " + (sub.name || "SUBCARD").toUpperCase();
  openEditModal();
  renderTagsInModal();

  setTimeout(() => {
    const input = $("new-tag-input");
    if(input){ input.value = ""; input.focus(); }
  }, 50);
};

/* =========================
   MODAL DE CRIAR SUBCARD COM IMAGEM (ÚNICO!)
   ✅ FIX: usa getCurrentParentIdSafe() + dataset
========================= */
window.openUniversalCreateModal = function () {
  const pid = getCurrentParentIdSafe();
  if (!pid) {
    window.openAlert("Erro", "Card pai não identificado. Abra os subcards do card e tente novamente.");
    return;
  }

  // garante persistência também no modal de criação
  setCurrentParentId(pid);

  forceTopmostUniversalCreateModal();

  if ($("universal-create-name")) $("universal-create-name").value = "";
  if ($("universal-create-img-status")) {
    $("universal-create-img-status").innerText = "Nenhuma";
    $("universal-create-img-status").style.color = "";
  }

  tempUniversalImg = null;

  const m = $("universal-create-modal");
  if (m) {
    m.style.display = "flex";
    requestAnimationFrame(forceTopmostUniversalCreateModal);
  }

  setTimeout(() => $("universal-create-name")?.focus(), 30);
};

window.closeUniversalCreateModal = function () {
  const m = $("universal-create-modal");
  if (m) m.style.display = "none";
};

window.triggerUniversalIconUpload = function () {
  const input = $("universal-create-icon");
  if (!input) return;

  input.value = "";
  input.click();

  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (ev) => {
      tempUniversalImg = ev.target.result;
      const st = $("universal-create-img-status");
      if (st) { st.innerText = "Imagem OK!"; st.style.color = "var(--primary-green)"; }
    };
    r.readAsDataURL(file);
  };
};

window.confirmUniversalCreate = function () {
  const name = ($("universal-create-name")?.value || "").trim();
  if (!name) return;

  const pid = getCurrentParentIdSafe();
  if (!pid) {
    window.openAlert("Erro", "Card pai não identificado. Abra os subcards do card e tente novamente.");
    return;
  }

  const parent = ensureCustomSubItems(pid);
  if (!parent) return;

  const exists = (parent.subItems || []).some(s => (s.name || "").toLowerCase() === name.toLowerCase());
  if (exists) { window.openAlert("Ops", "Já existe um subcard com esse nome."); return; }

  let finalImg = null;
  if (tempUniversalImg) finalImg = processImage(tempUniversalImg);

  parent.subItems.push({
    id: Date.now(),
    name,
    icon: finalImg ? finalImg : "📌",
    customImage: finalImg,
    totalMinutes: 0,
    tags: [],
    currentTag: null,
  });

  saveData();
  window.closeUniversalCreateModal();
  renderUniversalSubCards();
};

/* =========================
   TRACKER (ANIME/MANGÁ/SÉRIE)
   (seu código original daqui pra baixo foi mantido)
========================= */
window.toggleContentWindow = function () {
  const modal = $("content-window-overlay");
  if (!modal) return;

  if (modal.style.display === "flex") modal.style.display = "none";
  else {
    modal.style.display = "flex";
    window.renderAnimeList();
  }
};

window.openAnimeForm = function (editItem = null) {
  const modal = $("anime-form-modal");
  if (!modal) return;

  if ($("anime-name")) $("anime-name").value = "";
  if ($("anime-total-eps")) $("anime-total-eps").value = "";
  if ($("anime-cover-preview")) $("anime-cover-preview").style.display = "none";
  if ($("anime-cover-placeholder")) $("anime-cover-placeholder").style.display = "flex";

  tempCoverImg = null;
  currentRating = 0;
  renderStars(0);
  editingAnimeId = null;

  if (editItem) {
    if ($("anime-form-title")) $("anime-form-title").innerText = "Editar Item";
    if ($("anime-name")) $("anime-name").value = editItem.name || "";
    if ($("anime-total-eps")) $("anime-total-eps").value = editItem.totalEps || 0;

    editingAnimeId = editItem.id;
    currentMediaType = editItem.type || "Anime";
    currentRating = editItem.rating || 0;
    renderStars(currentRating);

    if (editItem.image && $("anime-cover-preview")) {
      tempCoverImg = editItem.image;
      $("anime-cover-preview").src = resolvePath(editItem.image);
      $("anime-cover-preview").style.display = "block";
      if ($("anime-cover-placeholder")) $("anime-cover-placeholder").style.display = "none";
    }
  } else {
    if ($("anime-form-title")) $("anime-form-title").innerText = "Novo Item";
  }

  modal.style.display = "flex";
};

window.closeAnimeForm = function () {
  const modal = $("anime-form-modal");
  if (modal) modal.style.display = "none";
};

window.saveAnimeItem = function () {
  const name = ($("anime-name")?.value || "").trim();
  if (!name) { alert("Nome é obrigatório!"); return; }

  const totalEps = parseInt($("anime-total-eps")?.value || "0") || 0;

  if (editingAnimeId) {
    const item = (appData.animeList || []).find(i => i.id === editingAnimeId);
    if (item) {
      item.name = name;
      item.totalEps = totalEps;
      item.type = currentMediaType;
      item.rating = currentRating;
      if (tempCoverImg) item.image = tempCoverImg;
    }
  } else {
    appData.animeList.push({
      id: Date.now(),
      name,
      totalEps,
      currentEp: 0,
      type: currentMediaType,
      rating: currentRating,
      image: tempCoverImg,
      status: "watching",
    });
  }

  saveData();
  window.closeAnimeForm();
  window.renderAnimeList();
};

window.setMediaType = function (type) {
  currentMediaType = type;
  ["type-anime", "type-manga", "type-serie"].forEach(id => $(id)?.classList.remove("active"));
  if (type === "Anime") $("type-anime")?.classList.add("active");
  if (type === "Mangá") $("type-manga")?.classList.add("active");
  if (type === "Série") $("type-serie")?.classList.add("active");
};

window.setRating = function (r) {
  currentRating = r;
  renderStars(r);
};

function renderStars(r) {
  document.querySelectorAll("#anime-rating i").forEach((s, idx) => {
    if (idx < r) {
      s.className = "fas fa-star active";
      s.style.color = "#ffca28";
    } else {
      s.className = "far fa-star";
      s.style.color = "var(--border-soft)";
    }
  });
}

window.renderAnimeList = function () {
  const list = $("anime-list-ul");
  if (!list) return;
  list.innerHTML = "";

  const totalEl = $("stat-total-animes");
  if (totalEl) totalEl.innerText = (appData.animeList || []).length;

  if (!appData.animeList || appData.animeList.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:gray;padding:20px;">Nenhum item ainda.</div>`;
    return;
  }

  appData.animeList.forEach(item => {
    const li = document.createElement("li");
    li.className = "anime-item";

    const progressPercent = item.totalEps > 0 ? (item.currentEp / item.totalEps) * 100 : 0;

    let imgHtml = "";
    if (item.image) {
      imgHtml = `<img src="${resolvePath(item.image)}" style="width:40px;height:50px;object-fit:cover;border-radius:4px;margin-right:10px;">`;
    } else {
      imgHtml = `<div style="width:40px;height:50px;background:#eee;border-radius:4px;margin-right:10px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-tv" style="color:#ccc;"></i></div>`;
    }

    li.innerHTML = `
      <div class="anime-header" style="display:flex;justify-content:space-between;align-items:center;padding:10px;">
        <div style="display:flex;align-items:center;">
          ${imgHtml}
          <div>
            <div style="font-weight:bold;font-size:0.9rem;">${item.name}</div>
            <div style="font-size:0.75rem;color:gray;">${item.currentEp} / ${item.totalEps || "?"} eps</div>
            <div style="width:100px;height:4px;background:#eee;margin-top:4px;border-radius:2px;">
              <div style="width:${progressPercent}%;height:100%;background:var(--primary-green);border-radius:2px;"></div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn-rural small" onclick="updateEp(${item.id}, 1)">+</button>
          <button class="btn-rural small danger" onclick="deleteAnime(${item.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;

    list.appendChild(li);
  });
};

window.updateEp = function (id, amount) {
  const item = (appData.animeList || []).find(i => i.id === id);
  if (!item) return;
  item.currentEp = (item.currentEp || 0) + amount;
  if (item.currentEp < 0) item.currentEp = 0;
  saveData();
  window.renderAnimeList();
};

window.deleteAnime = function (id) {
  if (!confirm("Apagar item?")) return;
  appData.animeList = (appData.animeList || []).filter(i => i.id !== id);
  saveData();
  window.renderAnimeList();
};

/* =========================
   DEV INJECTION (CSS/HTML/JS)
========================= */
window.updateLineNumbers = function (type) {
  const textarea = $("custom-" + type + "-area");
  const linesDiv = $("lines-" + type);
  if (!textarea || !linesDiv) return;

  const lineCount = (textarea.value || "").split("\n").length;
  linesDiv.innerHTML = Array.from({ length: lineCount }, (_, i) => i + 1).join("<br>");
};

window.syncScroll = function (type) {
  const textarea = $("custom-" + type + "-area");
  const linesDiv = $("lines-" + type);
  if (!textarea || !linesDiv) return;
  linesDiv.scrollTop = textarea.scrollTop;
};

window.switchDevTab = function (type) {
  $("wrapper-css") && ($("wrapper-css").style.display = "none");
  $("wrapper-html") && ($("wrapper-html").style.display = "none");
  $("wrapper-js") && ($("wrapper-js").style.display = "none");

  $("tab-css-btn")?.classList.remove("active");
  $("tab-html-btn")?.classList.remove("active");
  $("tab-js-btn")?.classList.remove("active");

  const activeWrapper = $("wrapper-" + type);
  if (activeWrapper) {
    activeWrapper.style.display = "flex";
    window.updateLineNumbers(type);
    window.syncScroll(type);
  }

  $("tab-" + type + "-btn")?.classList.add("active");
};

window.openDevModal = function () {
  const modal = $("dev-modal");
  if (!modal) { alert("Erro: HTML do modal não encontrado!"); return; }

  $("custom-css-area") && ($("custom-css-area").value = localStorage.getItem("custom_user_css") || "");
  $("custom-html-area") && ($("custom-html-area").value = localStorage.getItem("custom_user_html") || "");
  $("custom-js-area") && ($("custom-js-area").value = localStorage.getItem("custom_user_js") || "");

  modal.style.display = "flex";

  setTimeout(() => {
    window.updateLineNumbers("css");
    window.updateLineNumbers("html");
    window.updateLineNumbers("js");
    window.switchDevTab("css");
  }, 50);
};

window.closeDevModal = function () {
  const modal = $("dev-modal");
  if (modal) modal.style.display = "none";
};

window.saveAndInjectCode = function () {
  const css = $("custom-css-area")?.value ?? "";
  const html = $("custom-html-area")?.value ?? "";
  const js = $("custom-js-area")?.value ?? "";

  localStorage.setItem("custom_user_css", css);
  localStorage.setItem("custom_user_html", html);
  localStorage.setItem("custom_user_js", js);

  if (confirm("Salvo! Recarregar agora para aplicar as mudanças?")) location.reload();
};

/* =========================
   DOMContentLoaded (ÚNICO)
========================= */
window.addEventListener("DOMContentLoaded", () => {
  loadData();
  migrateOldData();

  if (appData.savedTimerState?.mode) {
    currentMode = appData.savedTimerState.mode;
    remainingTimeMs = appData.savedTimerState.remaining ?? getDurationForMode(currentMode);
    currentSessionMinutes = appData.savedTimerState.elapsed ?? 0;
  } else {
    currentMode = "estudo";
    remainingTimeMs = getDurationForMode("estudo");
  }

  updateDisplay(remainingTimeMs);
  setModeVisual(currentMode);

  const rangeTransp = $("range-transparency");
  if (rangeTransp) {
    rangeTransp.value = appData.settings.transparency ?? 0.9;
    rangeTransp.oninput = (e) => updateTransparency(e.target.value);
  }
  const rangeRadius = $("range-radius");
  if (rangeRadius) {
    rangeRadius.value = appData.settings.borderRadius ?? 10;
    rangeRadius.oninput = (e) => updateBorderRadius(e.target.value);
  }

  const btnMonth = $("btn-month-selector");
  if (btnMonth) {
    btnMonth.onclick = (e) => {
      e.stopPropagation();
      const popup = $("calendar-popup");
      if (!popup) return;
      popup.style.display = (popup.style.display === "none" ? "block" : "none");
      renderCalendarGrid();
    };

    // botão criar subcard (abre modal)
    (() => {
      const btn =
        $("btn-open-universal-create") ||
        $("universal-create-btn") ||
        document.querySelector("[data-action='open-universal-create']") ||
        document.querySelector(".btn-open-universal-create");

      if (btn) {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.openUniversalCreateModal();
        };
      }
    })();
  }

  $("btn-cal-prev") && ($("btn-cal-prev").onclick = () => changeCalendarYear(-1));
  $("btn-cal-next") && ($("btn-cal-next").onclick = () => changeCalendarYear(+1));

  const importBtn = $("btn-import");
  const importInput = $("file-import");
  if (importBtn && importInput) {
    importBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          appData = { ...appData, ...JSON.parse(ev.target.result) };
          ensureArrays();
          saveData(true);
          location.reload();
        } catch (err) {
          console.error(err);
          alert("Arquivo inválido.");
        }
      };
      r.readAsText(f);
    });
  }

  const fileCustomIcon = $("file-custom-icon");
  if (fileCustomIcon) {
    fileCustomIcon.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        tempCustomIcon = ev.target.result;
        const st = $("custom-icon-status");
        if (st) { st.innerText = "OK"; st.style.color = "var(--primary-green)"; }
      };
      r.readAsDataURL(f);
    });
  }

  const fileEditIcon = $("file-edit-icon");
  if (fileEditIcon) {
    fileEditIcon.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f || !editingTimerId) return;

      const r = new FileReader();
      r.onload = (ev) => {
        const newIconPath = processImage(ev.target.result);

        const customTimer = (appData.customModes || []).find(m => m.id === editingTimerId);
        if (customTimer) customTimer.customIcon = newIconPath;
        else {
          if (!appData.modeConfigs) appData.modeConfigs = {};
          if (!appData.modeConfigs[editingTimerId]) appData.modeConfigs[editingTimerId] = {};
          appData.modeConfigs[editingTimerId].icon = newIconPath;
        }

        saveData(true);
        setTimeout(() => {
          renderCustomTabs();
          renderTimerManagement();
          refreshAllData();
        }, 100);

        editingTimerId = null;
      };
      r.readAsDataURL(f);
    });
  }

  const fileBg = $("file-bg");
  if (fileBg) {
    fileBg.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        appData.settings.wallpaper = processImage(ev.target.result);
        applySettings();
        saveData();
      };
      r.readAsDataURL(f);
    });
  }

  const fileTimerBg = $("file-timer-bg");
  if (fileTimerBg) {
    fileTimerBg.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        appData.settings.timerBg = processImage(ev.target.result);
        applySettings();
        saveData();
      };
      r.readAsDataURL(f);
    });
  }

  const fileSound = $("file-sound");
  if (fileSound) {
    fileSound.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        appData.settings.sound = ev.target.result;
        saveData();
        alert("Som!");
      };
      r.readAsDataURL(f);
    });
  }

  const fileSubj = $("file-subject-icon");
  if (fileSubj) {
    fileSubj.addEventListener("change", (e) => {
      if (!e.target.files || !e.target.files[0]) return;
      const r = new FileReader();
      r.onload = (ev) => {
        tempSubjectImg = ev.target.result;
        const st = $("subject-img-status");
        if (st) { st.innerText = "Imagem OK!"; st.style.color = "var(--primary-green)"; }
        if ($("new-subject-emoji")) $("new-subject-emoji").value = "";
      };
      r.readAsDataURL(e.target.files[0]);
    });
  }

  const coverInput = $("anime-cover-input");
  if (coverInput) {
    coverInput.addEventListener("change", (e) => {
      if (!e.target.files || !e.target.files[0]) return;
      const r = new FileReader();
      r.onload = (ev) => {
        const img = $("anime-cover-preview");
        if (img) {
          img.src = ev.target.result;
          img.style.display = "block";
        }
        $("anime-cover-placeholder") && ($("anime-cover-placeholder").style.display = "none");
        tempCoverImg = processImage(ev.target.result);
      };
      r.readAsDataURL(e.target.files[0]);
    });
  }

  // Enter no input de criar subcard rápido (no menu)
  document.addEventListener("keydown", (e) => {
    const modal = $("universal-menu-modal");
    if (!modal || modal.style.display !== "flex") return;

    if (e.key === "Enter") {
      const input = $("universal-new-subcard-name");
      if (input && document.activeElement === input) {
        e.preventDefault();
        window.createUniversalSubcard();
      }
    }
  });

  const contentOverlay = $("content-window-overlay");
  if (contentOverlay) {
    contentOverlay.addEventListener("click", (e) => {
      if (e.target === contentOverlay) contentOverlay.style.display = "none";
    });
  }

  const chk = $("chk-autosave");
  if (chk) {
    chk.checked = !!appData.settings.autoSave;
    chk.onchange = (e) => {
      appData.settings.autoSave = !!e.target.checked;
      saveData();
    };
  }

  setupGlobalClicks();
  setupInputEnter();
  setupTimerEdit();
  setupDragScroll();
  setupTagEnter();
  forceTopmostEditModal();

  updateCalendarLabel();
  renderWeekTabs();

  renderCustomTabs();
  refreshAllData();
  applySettings();

  updateTimerIndicatorForItem(null);

  const realtime = $("header-realtime");
  if (realtime) {
    const tick = () => {
      const now = new Date();
      realtime.innerText = now.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  // injeção custom
  const savedCSS = localStorage.getItem("custom_user_css");
  if (savedCSS) {
    const style = document.createElement("style");
    style.id = "injected-css";
    style.innerHTML = savedCSS;
    document.head.appendChild(style);
  }

  const savedHTML = localStorage.getItem("custom_user_html");
  if (savedHTML) {
    const container = document.createElement("div");
    container.id = "user-custom-html-container";
    container.innerHTML = savedHTML;
    document.body.appendChild(container);
  }

  const savedJS = localStorage.getItem("custom_user_js");
  if (savedJS) {
    try {
      const script = document.createElement("script");
      script.id = "injected-js";
      script.text = savedJS;
      document.body.appendChild(script);
    } catch (e) {
      console.error("Erro no JS customizado:", e);
    }
  }
});
// --- FUNÇÃO CORRIGIDA: GARANTE QUE A LISTA EXISTA ---
function getActiveList() {
    // Se estiver no Estudo Total
    if (currentContextId === 'estudo') {
        if (!appData.studySubjects) appData.studySubjects = [];
        return appData.studySubjects;
    } 
    // Se estiver em um Card Customizado (Ex: Leitura)
    else {
        const parent = appData.customModes.find(m => m.id === currentContextId);
        
        if (parent) {
            // A CORREÇÃO ESTÁ AQUI: 
            // Se a lista 'subItems' não existir, cria ela como um array vazio []
            // Isso impede que o .push() falhe e o botão pare de funcionar
            if (!Array.isArray(parent.subItems)) {
                parent.subItems = [];
            }
            return parent.subItems;
        }
        
        // Se deu algo muito errado, salva na raiz para não perder dados
        return appData.studySubjects; 
    }
}
// --- FUNÇÃO CORRIGIDA: SALVAR NO LUGAR CERTO ---
window.confirmCreateSubject = function() {
    // 1. Pega os valores dos campos
    const nameInput = document.getElementById('new-subject-name');
    const emojiInput = document.getElementById('new-subject-emoji');
    
    const name = nameInput.value.trim();
    const emoji = emojiInput.value.trim();
    
    // Validação básica
    if (!name) { 
        alert("O nome é obrigatório!"); 
        return; 
    }
    
    // 2. Processa a imagem (se houver)
    let finalImg = null;
    if (typeof tempSubjectImg !== 'undefined' && tempSubjectImg) { 
        finalImg = window.processImage(tempSubjectImg); 
    }
    
    // Ícone padrão se não escolher nada
    const finalIcon = emoji || '📘';

    // 3. Cria o objeto do novo card
    const newSub = { 
        id: Date.now(), 
        name: name, 
        icon: finalIcon, 
        customImage: finalImg, 
        totalMinutes: 0, 
        tags: [], 
        tagData: [], // Garante que array de tags exista
        currentTag: null 
    };
    
    // 4. A MÁGICA: Pega a lista ativa e adiciona o item
    const targetList = getActiveList();
    targetList.push(newSub);
    
    // 5. Salva e Atualiza
    saveData();
    
    // Fecha o modal
    document.getElementById('new-subject-modal').style.display = 'none';
    
    // Limpa os campos para a próxima vez
    nameInput.value = '';
    emojiInput.value = '';
    tempSubjectImg = null;
    document.getElementById('subject-img-status').innerText = "Nenhuma";
    
    // Atualiza a tela para mostrar o card novo
    renderStudySubjects();
};

// ==========================================================================
// ▼ PATCH UNIVERSAL (COLE NO FINAL DO ARQUIVO ORIGINAL) ▼
// Transforma os cards customizados em Pastas sem quebrar o resto do app.
// ==========================================================================

console.log("🚀 Aplicando Patch Universal de Pastas...");

// 1. ESTADO GLOBAL DE NAVEGAÇÃO
// 'estudo' = Raiz. Outro ID = Pasta Customizada.
window.currentParentContext = 'estudo'; 

// 2. FUNÇÃO QUE DECIDE QUAL LISTA USAR
// O segredo: se não for 'estudo', ele busca a lista dentro do modo customizado.
window.getActiveList = function() {
    if (window.currentParentContext === 'estudo') {
        if (!appData.studySubjects) appData.studySubjects = [];
        return appData.studySubjects;
    } else {
        const parent = appData.customModes.find(m => m.id === window.currentParentContext);
        if (parent) {
            if (!Array.isArray(parent.subItems)) parent.subItems = [];
            return parent.subItems;
        }
        return [];
    }
};

// 3. SOBRESCRITA: RENDERIZAR ABAS (BOTÕES DO TOPO)
// Mudamos o clique: agora abre o menu em vez de iniciar o timer direto.
window.renderCustomTabs = function() {
    const w = document.getElementById('tabs-wrapper');
    const add = w.querySelector('.pill-tab-add');
    w.querySelectorAll('.pill-tab').forEach(e => e.remove());

    const allModes = [
        { id: 'estudo', name: 'Estudo Total', isDefault: true },
        { id: 'anime', name: 'Anime', isDefault: true },
        ...(appData.customModes || [])
    ];

    allModes.forEach(m => {
        const b = document.createElement('button');
        b.className = 'pill-tab';
        b.dataset.mode = m.id;
        
        // Ícone (Lógica original preservada)
        let customImg = m.customIcon || (appData.modeConfigs && appData.modeConfigs[m.id] ? appData.modeConfigs[m.id].icon : null);
        let iconHtml = '';
        if (customImg && typeof resolvePath === 'function') {
            iconHtml = `<img src="${resolvePath(customImg)}" style="width:16px; height:16px; border-radius:3px; object-fit:cover; vertical-align: middle;">`;
        } else {
            const v = (typeof getModeVisuals === 'function') ? getModeVisuals(m.id) : {icon:'circle', color:'#ccc'};
            if(v.customImage) iconHtml = `<img src="${resolvePath(v.customImage)}" style="width:16px; height:16px; border-radius:3px; object-fit:cover; vertical-align: middle;">`;
            else iconHtml = `<i class="fas fa-${v.icon}" style="color:${v.color}"></i>`;
        }

        b.innerHTML = `${iconHtml} ${m.name}`;

        // --- AQUI ESTÁ A MUDANÇA ---
        if (m.id === 'anime') {
            b.onclick = () => switchMode(m.id); // Anime continua igual
        } else if (m.id === 'estudo') {
            b.onclick = () => window.openStudyMenu();
        } else {
            // Customs abrem a Janela de Subcards
            b.onclick = () => window.openUniversalMenu(m.id, "mode");
        }

        if (!m.isDefault) {
            const span = document.createElement('span');
            span.innerText = ' ✕';
            span.style.fontSize = '10px';
            span.style.marginLeft = '5px';
            span.onclick = (e) => { e.stopPropagation(); deleteCustomMode(m.id); };
            b.appendChild(span);
        }

        if(currentMode === m.id) b.classList.add('active');
        w.insertBefore(b, add);
    });
};

// 4. NOVA FUNÇÃO: ABRIR MENU (UNIVERSAL)
window.openUniversalMenu = function(parentId, parentType = "mode") {
    const pid = normalizeParentKey(parentId, parentType);
    if (!pid) return;

    setCurrentParentId(pid);

    const modal = document.getElementById('universal-menu-modal');
    if (!modal) return;

    const parent = ensureCustomSubItems(pid);
    if (!parent) return;

    if (document.getElementById('universal-menu-title')) {
        document.getElementById('universal-menu-title').innerText = `Subcards: ${parent.name}`;
    }

    modal.style.display = 'flex';
    renderUniversalSubCards();
};
// Redireciona a chamada antiga
window.openStudyMenu = function() {
    window.currentParentContext = "estudo";
    const modal = document.getElementById('study-menu-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderStudySubjects();
};

// 5. SOBRESCRITA: RENDERIZAR CARDS (USA A LISTA ATIVA)
window.renderStudySubjects = function() {
    const grid = document.getElementById('study-subjects-grid');
    const totalDisplay = document.getElementById('total-study-time');
    if(!grid) return;
    grid.innerHTML = '';
    
    // --- USA A LISTA DINÂMICA ---
    const list = window.getActiveList();
    
    let totalTimeAll = 0;
    const formatTime = (val) => {
        let mins = parseInt(val); if (isNaN(mins)) return "0m";
        const h = Math.floor(mins/60); const m = mins%60;
        return h>0 ? `${h}h${m.toString().padStart(2,'0')}m` : `${m}m`;
    };

    if (!list || list.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#888; font-size:0.8rem; padding:20px;">Nenhum item criado aqui.</div>';
    } else {
        list.forEach(subject => {
            const minutes = parseInt(subject.totalMinutes) || 0;
            totalTimeAll += minutes;

            const card = document.createElement('div');
            card.className = 'subject-card rural-panel interactive';
            // CSS Visual Original
            card.style.cssText = `position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 85px; padding: 8px 4px; background: var(--bg-paper); border: 1px solid var(--border-soft); border-radius: 6px; cursor: pointer;`;

            // Mídia
            let mediaHtml = '';
            const imgSrc = subject.customImage || subject.icon;
            if (imgSrc && (String(imgSrc).includes('/') || String(imgSrc).length > 20)) {
                mediaHtml = `<img src="${resolvePath(imgSrc)}" style="width:30px; height:30px; object-fit:cover; border-radius:4px; margin-bottom:4px; display:block;">`;
            } else {
                mediaHtml = `<div style="font-size:1.4rem; margin-bottom:4px; line-height:1;">${subject.icon || '📝'}</div>`;
            }

            // Tags
            let tagHtml = '';
            if (subject.currentTag) tagHtml = ` - <small style="color:var(--primary-green);">${subject.currentTag}</small>`;

            card.innerHTML = `
                <div onclick="event.stopPropagation(); deleteSubject('${subject.id}')" title="Excluir" style="position: absolute; top: 3px; right: 4px; color: #ff5252; font-size: 11px; font-weight: bold; cursor: pointer; z-index: 101; opacity: 0.6; padding: 2px;">✕</div>
                <div class="subject-edit-btn" onclick="event.stopPropagation(); changeSubjectIconReal('${subject.id}')" title="Editar" style="position: absolute; top: 4px; left: 4px; color: #2196F3; font-size: 9px; cursor: pointer; z-index: 101; background:rgba(255,255,255,0.9); width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"><i class="fas fa-pencil-alt"></i></div>
                <div class="subject-subcards-btn" onclick="event.stopPropagation(); openUniversalMenu('${buildParentKey("subject", subject.id)}', 'subject')" title="Subcards" style="position: absolute; bottom: 4px; right: 4px; color: var(--text-gray); font-size: 10px; cursor: pointer; z-index: 101; background: rgba(255,255,255,0.9); width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <i class="fas fa-layer-group"></i>
                </div>
                ${mediaHtml}
                <div style="font-weight:bold; font-size:0.8rem; color:var(--text-brown); margin-bottom: 3px; line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:95%;">${subject.name}${tagHtml}</div>
                <div style="font-size:0.65rem; color:var(--text-gray); background: rgba(0,0,0,0.04); padding: 1px 6px; border-radius: 8px;">${formatTime(minutes)}</div>
            `;
            
            // Clique para selecionar
            card.onclick = (e) => {
                if (e.target.closest(".subject-edit-btn") || e.target.closest(".subject-subcards-btn") || e.target.innerText === "✕") return;
                window.selectUniversalSubject(subject);
            };
            grid.appendChild(card);
        });
    }
    if(totalDisplay) totalDisplay.innerText = formatTime(totalTimeAll);
};

// 6. SOBRESCRITA: CRIAR CARD (Salva na lista certa)
window.confirmCreateSubject = function() {
    const name = document.getElementById('new-subject-name').value.trim();
    const emoji = document.getElementById('new-subject-emoji').value.trim();
    if(!name) { alert("Nome obrigatório!"); return; }
    
    let finalImg = null;
    if (typeof tempSubjectImg !== 'undefined' && tempSubjectImg) finalImg = window.processImage(tempSubjectImg);
    const finalIcon = emoji || '📘';

    const newSub = { 
        id: Date.now(), name: name, icon: finalIcon, 
        customImage: finalImg, totalMinutes: 0, 
        tags: [], tagData: [], currentTag: null, subItems: []
    };
    
    // --- USA A LISTA ATIVA ---
    window.getActiveList().push(newSub);
    
    saveData();
    document.getElementById('new-subject-modal').style.display = 'none';
    renderStudySubjects();
};

// 7. SOBRESCRITA: SELECIONAR (Configura o timer com o contexto do Pai)
window.selectUniversalSubject = function(subject) {
    currentSubject = subject;
    currentSubcard = null;
    currentSubcardParent = null;
    window.ACTIVE_SESSION = null;
    document.getElementById('study-menu-modal').style.display = 'none';
    
    // Timer assume o modo da PASTA (Estudo ou Custom)
    currentMode = window.currentParentContext;
    if(typeof setMode === 'function') setMode(currentMode);
    
    // Atualiza indicador
    updateTimerIndicatorForItem(subject);
};
// Redireciona a função antiga
window.selectSubject = window.selectUniversalSubject;

// 8. SOBRESCRITA: DELETAR (Busca na lista certa)
window.deleteSubject = function(id, event) {
    if(event) event.stopPropagation();
    const list = window.getActiveList();
    const idx = list.findIndex(s => s.id == id);
    if(idx > -1 && confirm("Excluir item e histórico?")) {
        const name = list[idx].name;
        list.splice(idx, 1);
        if(appData.logs) {
            appData.logs = appData.logs.filter(l => {
                if (l.meta && l.meta.kind === "subject" && String(l.meta.subjectId) === String(id)) return false;
                if (l.meta && l.meta.kind === "subcard" && l.meta.parentType === "subject" && String(l.meta.parentId) === String(id)) return false;
                return !String(l.mode || "").startsWith(name);
            });
        }
        
        if(currentSubject && currentSubject.id == id) {
            currentSubject = null;
            updateTimerIndicatorForItem(null);
        }
        if (currentSubcard && currentSubcardParent?.type === "subject" && String(currentSubcardParent.id) === String(id)) {
            currentSubcard = null;
            currentSubcardParent = null;
            updateTimerIndicatorForItem(null);
        }
        saveData();
        renderStudySubjects();
        if(typeof refreshAllData === 'function') refreshAllData();
    }
};

// 9. SOBRESCRITA: EDITAR (Para Tags funcionarem)
window.changeSubjectIconReal = function(id, event) {
    if(event) event.stopPropagation();
    window.idSubjectBeingEdited = id;
    
    const list = window.getActiveList();
    const subject = list.find(s => s.id == id);
    if(!subject) return;

    if(document.getElementById('edit-modal-title')) document.getElementById('edit-modal-title').innerText = "Editar: " + subject.name;
    const m = document.getElementById('edit-subject-modal');
    if(m) m.style.display = 'flex';
    
    // Renderiza tags se a função existir
    if(typeof renderTagsInModal === 'function') renderTagsInModal();
};

// ATIVAÇÃO IMEDIATA
setTimeout(() => {
    window.renderCustomTabs(); // Atualiza abas para usar o novo clique
    // Garante estrutura
    if(appData.customModes) appData.customModes.forEach(m => { if(!m.subItems) m.subItems = []; });
    console.log("✅ Patch Universal Aplicado!");
}, 500);

// ==========================================================================
// ▼ KIT DE REPARO: SISTEMA DE TAGS & SUBCARDS (VISUAL + LÓGICA) ▼
// Cole no final do arquivo. Ele conserta o HTML e o CSS automaticamente.
// ==========================================================================

(function autoFixTagsAndVisuals() {
    console.log("🎨 Iniciando Reparo Visual de Tags e Subcards...");

    // 1. INJETAR CSS (Estilos das Tags e do Popup de Notas)
    const styleId = 'fix-tags-style';
    if (!document.getElementById(styleId)) {
        const css = `
            /* Estilo da Lista de Tags */
            #subject-tags-list {
                display: flex; flex-wrap: wrap; gap: 6px; 
                max-height: 120px; overflow-y: auto; 
                padding: 8px; background: rgba(0,0,0,0.03); 
                border-radius: 6px; border: 1px solid var(--border-soft);
                margin-top: 10px;
            }
            /* A Etiqueta (Tag) */
            .subject-tag-item {
                background: var(--bg-paper); border: 1px solid #ccc;
                padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
                cursor: pointer; display: flex; align-items: center; gap: 6px;
                transition: all 0.2s; user-select: none;
            }
            .subject-tag-item:hover { border-color: var(--primary-green); background: rgba(76, 175, 80, 0.1); }
            .subject-tag-item.active-tag { background: var(--primary-green); color: white; border-color: var(--primary-green); }
            
            /* Botão de Fechar da Tag */
            .subject-tag-item .delete-tag { 
                color: #ff5252; font-weight: bold; margin-left: 2px; font-size:1.1em; line-height:0.5;
            }
            .subject-tag-item.active-tag .delete-tag { color: white; }
            
            /* Popup de Nota (Ao passar o mouse) */
            #tag-note-popup {
                display: none; position: fixed; 
                background: var(--bg-paper); border: 1px solid var(--primary-green); 
                padding: 12px; border-radius: 8px; 
                box-shadow: 0 4px 20px rgba(0,0,0,0.25); 
                z-index: 2147483647; max-width: 250px; 
                font-size: 0.85rem; color: var(--text-dark); 
                pointer-events: none; animation: popIn 0.2s ease-out;
            }
            @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // 2. INJETAR HTML (Campos de Input no Modal de Edição)
    // Isso garante que você tenha onde digitar a tag e a nota.
    const modal = document.getElementById('edit-subject-modal');
    if (modal) {
        // Tenta achar o corpo do modal
        const modalBody = modal.querySelector('.modal-body');
        // Se não tiver a div de tags, criamos agora
        if (modalBody && !document.getElementById('new-tag-input')) {
            const tagSection = document.createElement('div');
            tagSection.className = 'setting-block';
            tagSection.style.marginTop = '15px';
            tagSection.innerHTML = `
                <label class="setting-title" style="display:block; margin-bottom:5px; font-weight:bold; font-size:0.85rem;">
                    <i class="fas fa-tags"></i> Tags & Notas
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <input type="text" id="new-tag-input" placeholder="Nome da Tag (Ex: Crase)" 
                           style="padding: 8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                    
                    <textarea id="new-tag-content" placeholder="Nota/Dica rápida (aparece ao passar o mouse)" 
                              style="padding: 8px; height: 50px; resize: none; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; font-size: 0.8rem; width:100%;"></textarea>
                    
                    <button class="btn-rural small" onclick="addTagToSubject()" style="width: 100%; padding:6px; cursor:pointer;">
                        Adicionar Tag (+)
                    </button>
                </div>
                <div id="subject-tags-list"></div>
                <p style="font-size: 0.7rem; color: #888; margin-top: 5px; text-align:right;">
                    * Clique na tag para ativar. Passe o mouse para ver a nota.
                </p>
            `;
            modalBody.appendChild(tagSection);
            console.log("✅ Interface de Tags Injetada!");
        }
    }
})();

// ==========================================================================
// 3. LÓGICA DE TAGS (Reforçada)
// ==========================================================================

// Adicionar
window.addTagToSubject = function() {
    const input = document.getElementById('new-tag-input');
    const content = document.getElementById('new-tag-content');
    if(!input) return;
    
    const tagName = input.value.trim();
    const tagNote = content ? content.value.trim() : "";

    if(!tagName) return;

    // Usa a função getActiveList() do seu código principal
    const list = window.getActiveList(); 
    const subject = list.find(s => s.id == window.idSubjectBeingEdited);
    
    if(subject) {
        if(!subject.tagData) subject.tagData = [];
        
        // Remove duplicata para atualizar
        subject.tagData = subject.tagData.filter(t => t.name !== tagName);
        // Adiciona nova
        subject.tagData.push({ name: tagName, content: tagNote });

        // Compatibilidade com array simples
        if(!subject.tags) subject.tags = [];
        if(!subject.tags.includes(tagName)) subject.tags.push(tagName);

        saveData();
        renderTagsInModal(); // Atualiza a lista visualmente
        renderStudySubjects(); // Atualiza o card atrás
        
        input.value = '';
        if(content) content.value = '';
        input.focus();
    }
};

// Renderizar lista dentro do modal
window.renderTagsInModal = function() {
    const container = document.getElementById('subject-tags-list');
    if(!container) return;
    container.innerHTML = '';
    
    const list = window.getActiveList();
    const subject = list.find(s => s.id == window.idSubjectBeingEdited);
    
    if(subject && subject.tagData) {
        subject.tagData.forEach(tagObj => {
            const div = document.createElement('div');
            const isActive = subject.currentTag === tagObj.name;
            const hasNote = tagObj.content && tagObj.content.length > 0;
            const noteIcon = hasNote ? ' <span style="font-size:0.7rem">📝</span>' : '';

            div.className = `subject-tag-item ${isActive ? 'active-tag' : ''}`;
            div.innerHTML = `
                <span onclick="selectTag('${tagObj.name}')" 
                      onmouseenter="showTagNote(event, '${tagObj.name}')" 
                      onmouseleave="hideTagNote()">
                      ${tagObj.name}${noteIcon}
                </span>
                <span class="delete-tag" onclick="removeTag('${tagObj.name}', event)">×</span>
            `;
            container.appendChild(div);
        });
    }
};

// Selecionar (Ativar)
window.selectTag = function(tagName) {
    const list = window.getActiveList();
    const subject = list.find(s => s.id == window.idSubjectBeingEdited);
    if(subject) {
        // Toggle (se já tá ativa, desativa)
        subject.currentTag = (subject.currentTag === tagName) ? null : tagName;
        saveData();
        renderTagsInModal();
        renderStudySubjects();
        
        // Se este card estiver no timer agora, atualiza o título lá em cima
        if (currentSubject && currentSubject.id == subject.id) {
             // Atualiza indicador
            let label = document.getElementById('subject-indicator');
            if(label) {
                const tagSpan = label.querySelector('small');
                if(tagSpan) tagSpan.innerText = subject.currentTag || "";
                else if(subject.currentTag) label.querySelector('span').innerHTML += ` - <small style="opacity:0.8">${subject.currentTag}</small>`;
            }
        }
    }
};

// Remover
window.removeTag = function(tagName, e) {
    if(e) e.stopPropagation();
    const list = window.getActiveList();
    const subject = list.find(s => s.id == window.idSubjectBeingEdited);
    if(subject) {
        subject.tagData = subject.tagData.filter(t => t.name !== tagName);
        subject.tags = subject.tags.filter(t => t !== tagName);
        if(subject.currentTag === tagName) subject.currentTag = null;
        saveData();
        renderTagsInModal();
        renderStudySubjects();
    }
};

// Tooltip (Nota)
window.showTagNote = function(event, tagName) {
    const list = window.getActiveList();
    const subject = list.find(s => s.id == window.idSubjectBeingEdited);
    if(!subject || !subject.tagData) return;
    const tagInfo = subject.tagData.find(t => t.name === tagName);
    if(!tagInfo || !tagInfo.content) return;

    let popup = document.getElementById('tag-note-popup');
    if(!popup) {
        popup = document.createElement('div');
        popup.id = 'tag-note-popup';
        document.body.appendChild(popup);
    }
    
    popup.innerText = tagInfo.content;
    popup.style.display = 'block';
    popup.style.left = (event.pageX + 15) + 'px';
    popup.style.top = (event.pageY + 10) + 'px';
};

window.hideTagNote = function() {
    const p = document.getElementById('tag-note-popup');
    if(p) p.style.display = 'none';
};

// ==========================================================================
// ▼ MÓDULO EXTRAÍDO: SISTEMA DE TAGS & SUBCARDS (VISUAL + LÓGICA) ▼
// Cole no final do arquivo. Ele conserta o HTML/CSS e ativa as funções.
// ==========================================================================

(function autoFixTagsAndVisuals() {
    console.log("🎨 Injetando Estética de Tags e Inputs...");

    // 1. INJETAR CSS (Estilos das Tags e do Popup de Notas)
    const styleId = 'fix-tags-style';
    if (!document.getElementById(styleId)) {
        const css = `
            /* Estilo da Lista de Tags */
            #subject-tags-list {
                display: flex; flex-wrap: wrap; gap: 6px; 
                max-height: 120px; overflow-y: auto; 
                padding: 8px; background: rgba(0,0,0,0.03); 
                border-radius: 6px; border: 1px solid var(--border-soft);
                margin-top: 10px;
            }
            /* A Etiqueta (Tag) */
            .subject-tag-item {
                background: var(--bg-paper); border: 1px solid #ccc;
                padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
                cursor: pointer; display: flex; align-items: center; gap: 6px;
                transition: all 0.2s; user-select: none;
            }
            .subject-tag-item:hover { border-color: var(--primary-green); background: rgba(76, 175, 80, 0.1); }
            .subject-tag-item.active-tag { background: var(--primary-green); color: white; border-color: var(--primary-green); }
            
            /* Botão de Fechar da Tag */
            .subject-tag-item .delete-tag { 
                color: #ff5252; font-weight: bold; margin-left: 2px; font-size:1.1em; line-height:0.5;
            }
            .subject-tag-item.active-tag .delete-tag { color: white; }
            
            /* Popup de Nota (Ao passar o mouse) */
            #tag-note-popup {
                display: none; position: fixed; 
                background: var(--bg-paper); border: 1px solid var(--primary-green); 
                padding: 12px; border-radius: 8px; 
                box-shadow: 0 4px 20px rgba(0,0,0,0.25); 
                z-index: 2147483647; max-width: 250px; 
                font-size: 0.85rem; color: var(--text-dark); 
                pointer-events: none; animation: popIn 0.2s ease-out;
            }
            @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // 2. INJETAR HTML (Campos de Input no Modal de Edição)
    // Isso cria a área de digitar tags se ela não existir
    const modal = document.getElementById('edit-subject-modal');
    if (modal) {
        const modalBody = modal.querySelector('.modal-body');
        // Se já não tiver o input, cria agora
        if (modalBody && !document.getElementById('new-tag-input')) {
            const tagSection = document.createElement('div');
            tagSection.className = 'setting-block';
            tagSection.style.marginTop = '15px';
            tagSection.innerHTML = `
                <label class="setting-title" style="display:block; margin-bottom:5px; font-weight:bold; font-size:0.85rem;">
                    <i class="fas fa-tags"></i> Tags & Notas
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <input type="text" id="new-tag-input" placeholder="Nome da Tag (Ex: Crase)" 
                           style="padding: 8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                    
                    <textarea id="new-tag-content" placeholder="Nota/Dica rápida (aparece ao passar o mouse)" 
                              style="padding: 8px; height: 50px; resize: none; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; font-size: 0.8rem; width:100%;"></textarea>
                    
                    <button class="btn-rural small" onclick="addTagToSubject()" style="width: 100%; padding:6px; cursor:pointer;">
                        Adicionar Tag (+)
                    </button>
                </div>
                <div id="subject-tags-list"></div>
                <p style="font-size: 0.7rem; color: #888; margin-top: 5px; text-align:right;">
                    * Clique na tag para ativar. Passe o mouse para ver a nota.
                </p>
            `;
            modalBody.appendChild(tagSection);
        }
    }
})();

// ==========================================================================
// 3. LÓGICA DE TAGS (Conectada ao getEditingItem do seu código)
// ==========================================================================

window.addTagToSubject = function() {
    const input = document.getElementById('new-tag-input');
    const content = document.getElementById('new-tag-content');
    if(!input) return;
    
    const tagName = input.value.trim();
    const tagNote = content ? content.value.trim() : "";

    if(!tagName) return;

    // Usa a sua função existente para saber quem estamos editando
    const item = typeof getEditingItem === 'function' ? getEditingItem() : null;
    
    if(item) {
        if(!item.tagData) item.tagData = [];
        
        // Remove duplicata para atualizar
        item.tagData = item.tagData.filter(t => t.name !== tagName);
        // Adiciona nova
        item.tagData.push({ name: tagName, content: tagNote });

        // Compatibilidade com array simples
        if(!item.tags) item.tags = [];
        if(!item.tags.includes(tagName)) item.tags.push(tagName);

        saveData();
        renderTagsInModal(); // Atualiza a lista visualmente
        
        // Atualiza o visual dos cards no fundo
        if (typeof renderStudySubjects === 'function') renderStudySubjects();
        if (typeof renderUniversalSubCards === 'function') renderUniversalSubCards();
        
        input.value = '';
        if(content) content.value = '';
        input.focus();
    }
};

window.renderTagsInModal = function() {
    const container = document.getElementById('subject-tags-list');
    if(!container) return;
    container.innerHTML = '';
    
    const item = typeof getEditingItem === 'function' ? getEditingItem() : null;
    
    if(item && item.tagData) {
        item.tagData.forEach(tagObj => {
            const div = document.createElement('div');
            const isActive = item.currentTag === tagObj.name;
            const hasNote = tagObj.content && tagObj.content.length > 0;
            const noteIcon = hasNote ? ' <span style="font-size:0.7rem">📝</span>' : '';

            div.className = `subject-tag-item ${isActive ? 'active-tag' : ''}`;
            div.innerHTML = `
                <span onclick="selectTagForSubject('${tagObj.name}')" 
                      onmouseenter="showTagNote(event, '${tagObj.name}')" 
                      onmouseleave="hideTagNote()">
                      ${tagObj.name}${noteIcon}
                </span>
                <span class="delete-tag" onclick="removeTagFromSubject('${tagObj.name}', event)">×</span>
            `;
            container.appendChild(div);
        });
    }
};

// Funções de Hover para Nota
window.showTagNote = function(event, tagName) {
    const item = typeof getEditingItem === 'function' ? getEditingItem() : null;
    if(!item || !item.tagData) return;
    const tagInfo = item.tagData.find(t => t.name === tagName);
    if(!tagInfo || !tagInfo.content) return;

    let popup = document.getElementById('tag-note-popup');
    if(!popup) {
        popup = document.createElement('div');
        popup.id = 'tag-note-popup';
        document.body.appendChild(popup);
    }
    
    popup.innerText = tagInfo.content;
    popup.style.display = 'block';
    popup.style.left = (event.pageX + 15) + 'px';
    popup.style.top = (event.pageY + 10) + 'px';
};

window.hideTagNote = function() {
    const p = document.getElementById('tag-note-popup');
    if(p) p.style.display = 'none';
};

// ==========================================================================
// 4. FUNÇÃO DE SUBCARDS (Atualizada para mostrar as Tags)
// ==========================================================================

window.renderUniversalSubCards = function() {
    const grid = document.getElementById("universal-subcards-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const pid = typeof getCurrentParentIdSafe === 'function' ? getCurrentParentIdSafe() : null;
    const parent = pid ? ensureCustomSubItems(pid) : null;
    if (!parent) return;

    (parent.subItems || []).forEach(sub => {
        const minutes = parseInt(sub.totalMinutes) || 0;
        
        // Formata tempo (ex: 1h 30m)
        const h = Math.floor(minutes / 60); const m = minutes % 60;
        const timeStr = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;

        const card = document.createElement("div");
        card.className = "subject-card rural-panel interactive";
        card.style.cssText = `
            position: relative; display: flex; flex-direction: column;
            align-items: center; justify-content: center; text-align: center;
            min-height: 85px; padding: 8px 4px;
            background: var(--bg-paper); border: 1px solid var(--border-soft);
            border-radius: 6px; cursor: pointer;
        `;

        const imgSrc = sub.customImage || sub.icon;
        let mediaHtml = "";
        if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
            const resolved = resolvePath(imgSrc);
            mediaHtml = `<img src="${resolved}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;margin-bottom:4px;display:block;">`;
        } else {
            mediaHtml = `<div style="font-size:1.4rem;margin-bottom:4px;line-height:1;">${imgSrc || "📌"}</div>`;
        }

        // --- EXIBIÇÃO DA TAG NO CARD (NOVIDADE) ---
        let tagHtml = '';
        if (sub.currentTag) {
            tagHtml = ` - <small style="color:var(--primary-green);">${sub.currentTag}</small>`;
        }

        card.innerHTML = `
            <div onclick="deleteUniversalSubcard(${sub.id}, event)" title="Excluir"
                style="position:absolute;top:3px;right:4px;color:#ff5252;font-size:11px;font-weight:bold;cursor:pointer;z-index:101;opacity:0.6;padding:2px;"
                onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</div>

            <div class="subject-edit-btn" onclick="openSubcardEdit(${sub.id}, event)" title="Editar"
                style="position:absolute;top:4px;left:4px;color:#2196F3;font-size:9px;cursor:pointer;z-index:101;background:rgba(255,255,255,0.9);width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <i class="fas fa-pencil-alt"></i>
            </div>

            ${mediaHtml}

            <div style="font-weight:bold;font-size:0.8rem;color:var(--text-brown);margin-bottom:3px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95%;">
                ${sub.name}${tagHtml} </div>

            <div style="font-size:0.65rem;color:var(--text-gray);background:rgba(0,0,0,0.04);padding:1px 6px;border-radius:8px;">
                ${timeStr}
            </div>
        `;

        card.onclick = (e) => {
            if (!e.target.closest(".subject-edit-btn") && e.target.innerText !== "✕") {
                window.selectUniversalSubcard(sub.id);
            }
        };

        grid.appendChild(card);
    });
};

// ==========================================================================
// ▼ KIT DE REPARO: TAGS & SUBCARDS (VISUAL + LÓGICA) ▼
// Cole no final do arquivo. Ele injeta o CSS, cria os inputs e ativa os subcards.
// ==========================================================================

(function autoInjectStylesAndInputs() {
    console.log("🎨 Injetando Estética de Tags e Inputs...");

    // 1. INJETAR CSS (Estilos das Tags e do Popup de Notas)
    const styleId = 'fix-tags-style';
    if (!document.getElementById(styleId)) {
        const css = `
            /* Estilo da Lista de Tags */
            #subject-tags-list {
                display: flex; flex-wrap: wrap; gap: 6px; 
                max-height: 120px; overflow-y: auto; 
                padding: 8px; background: rgba(0,0,0,0.03); 
                border-radius: 6px; border: 1px solid var(--border-soft);
                margin-top: 10px;
            }
            /* A Etiqueta (Tag) */
            .subject-tag-item {
                background: var(--bg-paper); border: 1px solid #ccc;
                padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
                cursor: pointer; display: flex; align-items: center; gap: 6px;
                transition: all 0.2s; user-select: none;
            }
            .subject-tag-item:hover { border-color: var(--primary-green); background: rgba(76, 175, 80, 0.1); }
            .subject-tag-item.active-tag { background: var(--primary-green); color: white; border-color: var(--primary-green); }
            
            /* Botão de Fechar da Tag */
            .subject-tag-item .delete-tag { 
                color: #ff5252; font-weight: bold; margin-left: 2px; font-size:1.1em; line-height:0.5;
            }
            .subject-tag-item.active-tag .delete-tag { color: white; }
            
            /* Popup de Nota (Ao passar o mouse) */
            #tag-note-popup {
                display: none; position: fixed; 
                background: var(--bg-paper); border: 1px solid var(--primary-green); 
                padding: 12px; border-radius: 8px; 
                box-shadow: 0 4px 20px rgba(0,0,0,0.25); 
                z-index: 2147483647; max-width: 250px; 
                font-size: 0.85rem; color: var(--text-dark); 
                pointer-events: none; animation: popIn 0.2s ease-out;
            }
            @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = css;
        document.head.appendChild(style);
    }
})();

// ==========================================================================
// 2. FUNÇÃO DE RENDERIZAR TAGS (Com Auto-Reparo do HTML)
// ==========================================================================
window.renderTagsInModal = function() {
    // A. AUTO-REPARO: Se os campos não existirem no modal, CRIA ELES AGORA.
    const modalBody = document.querySelector('#edit-subject-modal .modal-body');
    if (modalBody && !document.getElementById('new-tag-input')) {
        const div = document.createElement('div');
        div.className = 'setting-block';
        div.style.marginTop = '15px';
        div.innerHTML = `
            <label class="setting-title" style="display:block; margin-bottom:5px; font-weight:bold; font-size:0.85rem;">
                <i class="fas fa-tags"></i> Tags & Notas
            </label>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <input type="text" id="new-tag-input" placeholder="Nome da Tag (Ex: Crase)" 
                       style="padding: 8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                
                <textarea id="new-tag-content" placeholder="Nota/Dica rápida (aparece ao passar o mouse)" 
                          style="padding: 8px; height: 50px; resize: none; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; font-size: 0.8rem; width:100%;"></textarea>
                
                <button class="btn-rural small" onclick="addTagToSubject()" style="width: 100%; padding:6px; cursor:pointer;">
                    Adicionar Tag (+)
                </button>
            </div>
            <div id="subject-tags-list"></div> <p style="font-size: 0.7rem; color: #888; margin-top: 5px; text-align:right;">
                * Clique na tag para ativar. Passe o mouse para ver a nota.
            </p>
        `;
        modalBody.appendChild(div);
        
        // Reconecta o Enter
        const inp = document.getElementById('new-tag-input');
        if(inp) inp.onkeydown = (e) => { if(e.key === 'Enter') window.addTagToSubject(); };
    }

    // B. RENDERIZAÇÃO DA LISTA
    const container = document.getElementById('subject-tags-list');
    if(!container) return;
    container.innerHTML = '';
    
    // Usa sua função 'getEditingItem' existente
    const item = (typeof getEditingItem === 'function') ? getEditingItem() : null;
    
    if(item && item.tagData) {
        item.tagData.forEach(tagObj => {
            const div = document.createElement('div');
            const isActive = item.currentTag === tagObj.name;
            const hasNote = tagObj.content && tagObj.content.length > 0;
            const noteIcon = hasNote ? ' <span style="font-size:0.7rem">📝</span>' : '';

            div.className = `subject-tag-item ${isActive ? 'active-tag' : ''}`;
            div.innerHTML = `
                <span onclick="selectTagForSubject('${tagObj.name}')" 
                      onmouseenter="showTagNote(event, '${tagObj.name}')" 
                      onmouseleave="hideTagNote()">
                      ${tagObj.name}${noteIcon}
                </span>
                <span class="delete-tag" onclick="removeTagFromSubject('${tagObj.name}', event)">×</span>
            `;
            container.appendChild(div);
        });
    }
};

// ==========================================================================
// 3. LÓGICA DE ADICIONAR TAG (Reforçada)
// ==========================================================================
window.addTagToSubject = function() {
    const input = document.getElementById('new-tag-input');
    const content = document.getElementById('new-tag-content');
    if(!input) return; // Se não achou o input, renderTagsInModal vai criar na prox vez
    
    const tagName = input.value.trim();
    const tagNote = content ? content.value.trim() : "";

    if(!tagName) return;

    const item = (typeof getEditingItem === 'function') ? getEditingItem() : null;
    
    if(item) {
        if(!item.tagData) item.tagData = [];
        
        // Remove duplicata para atualizar
        item.tagData = item.tagData.filter(t => t.name !== tagName);
        // Adiciona nova
        item.tagData.push({ name: tagName, content: tagNote });

        // Compatibilidade com array simples
        if(!item.tags) item.tags = [];
        if(!item.tags.includes(tagName)) item.tags.push(tagName);

        saveData();
        renderTagsInModal(); // Atualiza a lista visualmente
        
        // Tenta atualizar o fundo (seja matéria ou subcard)
        if (typeof renderStudySubjects === 'function') renderStudySubjects();
        if (typeof renderUniversalSubCards === 'function') renderUniversalSubCards();
        
        input.value = '';
        if(content) content.value = '';
        input.focus();
    }
};

// ==========================================================================
// 4. FUNÇÃO DE RENDERIZAR SUBCARDS (Com a Tag Visível)
// ==========================================================================
window.renderUniversalSubCards = function() {
    const grid = document.getElementById("universal-subcards-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const pid = typeof getCurrentParentIdSafe === 'function' ? getCurrentParentIdSafe() : null;
    const parent = pid ? ensureCustomSubItems(pid) : null;
    if (!parent) return;

    (parent.subItems || []).forEach(sub => {
        const minutes = parseInt(sub.totalMinutes) || 0;
        
        // Formata tempo
        const h = Math.floor(minutes / 60); const m = minutes % 60;
        const timeStr = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;

        const card = document.createElement("div");
        card.className = "subject-card rural-panel interactive";
        card.style.cssText = `
            position: relative; display: flex; flex-direction: column;
            align-items: center; justify-content: center; text-align: center;
            min-height: 85px; padding: 8px 4px;
            background: var(--bg-paper); border: 1px solid var(--border-soft);
            border-radius: 6px; cursor: pointer;
        `;

        const imgSrc = sub.customImage || sub.icon;
        let mediaHtml = "";
        if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
            const resolved = resolvePath(imgSrc);
            mediaHtml = `<img src="${resolved}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;margin-bottom:4px;display:block;">`;
        } else {
            mediaHtml = `<div style="font-size:1.4rem;margin-bottom:4px;line-height:1;">${imgSrc || "📌"}</div>`;
        }

        // --- EXIBIÇÃO DA TAG NO CARD (NOVIDADE) ---
        let tagHtml = '';
        if (sub.currentTag) {
            tagHtml = ` - <small style="color:var(--primary-green); font-weight:bold;">${sub.currentTag}</small>`;
        }

        card.innerHTML = `
            <div onclick="deleteUniversalSubcard(${sub.id}, event)" title="Excluir"
                style="position:absolute;top:3px;right:4px;color:#ff5252;font-size:11px;font-weight:bold;cursor:pointer;z-index:101;opacity:0.6;padding:2px;"
                onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</div>

            <div class="subject-edit-btn" onclick="openSubcardEdit(${sub.id}, event)" title="Editar"
                style="position:absolute;top:4px;left:4px;color:#2196F3;font-size:9px;cursor:pointer;z-index:101;background:rgba(255,255,255,0.9);width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <i class="fas fa-pencil-alt"></i>
            </div>

            ${mediaHtml}

            <div style="font-weight:bold;font-size:0.8rem;color:var(--text-brown);margin-bottom:3px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95%;">
                ${sub.name}${tagHtml}
            </div>

            <div style="font-size:0.65rem;color:var(--text-gray);background:rgba(0,0,0,0.04);padding:1px 6px;border-radius:8px;">
                ${timeStr}
            </div>
        `;

        card.onclick = (e) => {
            if (!e.target.closest(".subject-edit-btn") && e.target.innerText !== "✕") {
                window.selectUniversalSubcard(sub.id);
            }
        };

        grid.appendChild(card);
    });
};

// ==========================================================================
// 5. TOOLTIPS (Para mostrar a nota ao passar o mouse)
// ==========================================================================
window.showTagNote = function(event, tagName) {
    const item = (typeof getEditingItem === 'function') ? getEditingItem() : null;
    if(!item || !item.tagData) return;
    const tagInfo = item.tagData.find(t => t.name === tagName);
    if(!tagInfo || !tagInfo.content) return;

    let popup = document.getElementById('tag-note-popup');
    if(!popup) {
        popup = document.createElement('div');
        popup.id = 'tag-note-popup';
        document.body.appendChild(popup);
    }
    
    popup.innerText = tagInfo.content;
    popup.style.display = 'block';
    popup.style.left = (event.pageX + 15) + 'px';
    popup.style.top = (event.pageY + 10) + 'px';
};

window.hideTagNote = function() {
    const p = document.getElementById('tag-note-popup');
    if(p) p.style.display = 'none';
};
/* ==========================================================================
   ▼ MÓDULO DE REPARO VISUAL E FUNCIONAL (TAGS + SUBCARDS) ▼
   Cole no final. Ele cria o CSS, os Inputs de Tag e atualiza os Subcards.
   ========================================================================== */

(function autoFixVisuals() {
    console.log("🎨 Injetando Estilos de Tags...");
    // 1. INJETAR CSS (Estética)
    if (!document.getElementById('fix-tags-style')) {
        const css = `
            #subject-tags-list {
                display: flex; flex-wrap: wrap; gap: 6px; 
                max-height: 120px; overflow-y: auto; 
                padding: 8px; background: rgba(0,0,0,0.03); 
                border-radius: 6px; border: 1px solid var(--border-soft); margin-top: 10px;
            }
            .subject-tag-item {
                background: var(--bg-paper); border: 1px solid #ccc;
                padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
                cursor: pointer; display: flex; align-items: center; gap: 6px;
                transition: all 0.2s; user-select: none;
            }
            .subject-tag-item:hover { border-color: var(--primary-green); background: rgba(76, 175, 80, 0.1); }
            .subject-tag-item.active-tag { background: var(--primary-green); color: white; border-color: var(--primary-green); }
            .subject-tag-item .delete-tag { color: #ff5252; font-weight: bold; margin-left: 2px; }
            .subject-tag-item.active-tag .delete-tag { color: white; }
            
            /* Popup de Nota */
            #tag-note-popup {
                display: none; position: fixed; background: var(--bg-paper); 
                border: 1px solid var(--primary-green); padding: 12px; border-radius: 8px; 
                box-shadow: 0 4px 20px rgba(0,0,0,0.25); z-index: 2147483647; 
                max-width: 250px; font-size: 0.85rem; color: var(--text-dark); pointer-events: none;
            }
        `;
        const style = document.createElement('style');
        style.id = 'fix-tags-style';
        style.innerHTML = css;
        document.head.appendChild(style);
    }
})();

// ==========================================================================
// 2. FUNÇÃO QUE RENDERIZA AS TAGS (COM AUTO-CRIAÇÃO DOS CAMPOS)
// ==========================================================================
window.renderTagsInModal = function() {
    const modal = document.getElementById('edit-subject-modal');
    if (!modal) return;

    // A. AUTO-REPARO: Cria os campos de input se eles não existirem
    if (!document.getElementById('new-tag-input')) {
        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            const div = document.createElement('div');
            div.className = 'setting-block';
            div.style.marginTop = '15px';
            div.innerHTML = `
                <label class="setting-title" style="display:block; margin-bottom:5px; font-weight:bold; font-size:0.85rem;">
                    <i class="fas fa-tags"></i> Tags & Notas
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <input type="text" id="new-tag-input" placeholder="Nome da Tag (Ex: Capítulo 1)" 
                           style="padding: 8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                    <textarea id="new-tag-content" placeholder="Nota/Dica (aparece ao passar o mouse)" 
                              style="padding: 8px; height: 50px; resize: none; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; font-size: 0.8rem; width:100%;"></textarea>
                    <button class="btn-rural small" onclick="addTagToSubject()" style="width: 100%; padding:6px; cursor:pointer;">
                        Adicionar Tag (+)
                    </button>
                </div>
                <div id="subject-tags-list"></div>
                <p style="font-size: 0.7rem; color: #888; margin-top: 5px; text-align:right;">
                    * Clique na tag para ativar/desativar.
                </p>
            `;
            modalBody.appendChild(div);
            // Reconecta o Enter
            setTimeout(() => {
                const i = document.getElementById('new-tag-input');
                if(i) i.onkeydown = (e) => { if(e.key==='Enter') window.addTagToSubject(); };
            }, 100);
        }
    }

    // B. RENDERIZA A LISTA
    const container = document.getElementById('subject-tags-list');
    if (!container) return;
    container.innerHTML = '';

    // Usa sua função existente para pegar o item
    const item = typeof getEditingItem === 'function' ? getEditingItem() : null;

    if (item && item.tags) {
        // Normaliza tagData se não existir
        if(!item.tagData) item.tagData = [];
        
        item.tags.forEach(tagName => {
            const tData = item.tagData.find(t => t.name === tagName);
            const hasNote = tData && tData.content ? ' 📝' : '';
            const isActive = item.currentTag === tagName;

            const div = document.createElement('div');
            div.className = `subject-tag-item ${isActive ? 'active-tag' : ''}`;
            div.innerHTML = `
                <span onclick="selectTagForSubject('${tagName}')" 
                      onmouseenter="showTagNote(event, '${tagName}')" 
                      onmouseleave="hideTagNote()">
                      ${tagName}${hasNote}
                </span>
                <span class="delete-tag" onclick="removeTagFromSubject('${tagName}', event)">×</span>
            `;
            container.appendChild(div);
        });
    }
};

// ==========================================================================
// 3. FUNÇÃO DE RENDERIZAR SUBCARDS (ATUALIZADA PARA MOSTRAR A TAG)
// ==========================================================================
window.renderUniversalSubCards = function() {
    const grid = document.getElementById("universal-subcards-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const pid = typeof getCurrentParentIdSafe === 'function' ? getCurrentParentIdSafe() : null;
    const parent = pid ? ensureCustomSubItems(pid) : null;
    if (!parent) return;

    (parent.subItems || []).forEach(sub => {
        const minutes = parseInt(sub.totalMinutes) || 0;
        const h = Math.floor(minutes / 60); const m = minutes % 60;
        const timeStr = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;

        const card = document.createElement("div");
        card.className = "subject-card rural-panel interactive";
        
        // CSS Estético
        card.style.cssText = `
            position: relative; display: flex; flex-direction: column;
            align-items: center; justify-content: center; text-align: center;
            min-height: 85px; padding: 8px 4px;
            background: var(--bg-paper); border: 1px solid var(--border-soft);
            border-radius: 6px; cursor: pointer;
        `;

        const imgSrc = sub.customImage || sub.icon;
        let mediaHtml = "";
        if (imgSrc && (String(imgSrc).includes("/") || String(imgSrc).length > 20)) {
            const resolved = (typeof resolvePath === 'function') ? resolvePath(imgSrc) : imgSrc;
            mediaHtml = `<img src="${resolved}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;margin-bottom:4px;display:block;">`;
        } else {
            mediaHtml = `<div style="font-size:1.4rem;margin-bottom:4px;line-height:1;">${imgSrc || "📌"}</div>`;
        }

        // --- AQUI: MOSTRAR A TAG NO CARD ---
        let tagHtml = '';
        if (sub.currentTag) {
            tagHtml = ` - <small style="color:var(--primary-green); font-weight:bold;">${sub.currentTag}</small>`;
        }

        card.innerHTML = `
            <div onclick="deleteUniversalSubcard(${sub.id}, event)" title="Excluir"
                style="position:absolute;top:3px;right:4px;color:#ff5252;font-size:11px;font-weight:bold;cursor:pointer;z-index:101;opacity:0.6;padding:2px;"
                onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</div>

            <div class="subject-edit-btn" onclick="openSubcardEdit(${sub.id}, event)" title="Editar"
                style="position:absolute;top:4px;left:4px;color:#2196F3;font-size:9px;cursor:pointer;z-index:101;background:rgba(255,255,255,0.9);width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <i class="fas fa-pencil-alt"></i>
            </div>

            ${mediaHtml}

            <div style="font-weight:bold;font-size:0.8rem;color:var(--text-brown);margin-bottom:3px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95%;">
                ${sub.name}${tagHtml}
            </div>

            <div style="font-size:0.65rem;color:var(--text-gray);background:rgba(0,0,0,0.04);padding:1px 6px;border-radius:8px;">
                ${timeStr}
            </div>
        `;

        card.onclick = (e) => {
            if (!e.target.closest(".subject-edit-btn") && e.target.innerText !== "✕") {
                window.selectUniversalSubcard(sub.id);
            }
        };

        grid.appendChild(card);
    });
};

// ==========================================================================
// 4. LÓGICA DE NOTAS (HOVER)
// ==========================================================================
window.showTagNote = function(event, tagName) {
    const item = typeof getEditingItem === 'function' ? getEditingItem() : null;
    if(!item || !item.tagData) return;
    const tagInfo = item.tagData.find(t => t.name === tagName);
    if(!tagInfo || !tagInfo.content) return;

    let popup = document.getElementById('tag-note-popup');
    if(!popup) {
        popup = document.createElement('div');
        popup.id = 'tag-note-popup';
        document.body.appendChild(popup);
    }
    popup.innerText = tagInfo.content;
    popup.style.display = 'block';
    popup.style.left = (event.pageX + 15) + 'px';
    popup.style.top = (event.pageY + 10) + 'px';
};

window.hideTagNote = function() {
    const p = document.getElementById('tag-note-popup');
    if(p) p.style.display = 'none';
};

// ==========================================================================
// ▼ MÓDULO DE REPARO: SISTEMA DE TAGS UNIVERSAL (Visual + Lógica) ▼
// Cole no final do arquivo. Ele ativa as tags para TODOS os tipos de cards.
// ==========================================================================

// 1. INJEÇÃO DE ESTILOS (CSS)
(function injectTagStyles() {
    const styleId = 'fix-tags-style';
    if (document.getElementById(styleId)) return;
    
    const css = `
        /* Área da lista de tags */
        #subject-tags-list {
            display: flex; flex-wrap: wrap; gap: 6px; 
            max-height: 100px; overflow-y: auto; 
            padding: 8px; background: rgba(0,0,0,0.03); 
            border-radius: 6px; border: 1px solid var(--border-soft);
            margin-top: 10px;
        }
        /* A etiqueta visual */
        .subject-tag-item {
            background: var(--bg-paper); border: 1px solid #ccc;
            padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
            cursor: pointer; display: flex; align-items: center; gap: 6px;
            transition: all 0.2s; user-select: none; color: var(--text-main);
        }
        .subject-tag-item:hover { border-color: var(--primary-green); background: rgba(76, 175, 80, 0.1); }
        .subject-tag-item.active-tag { background: var(--primary-green); color: white; border-color: var(--primary-green); }
        
        /* Botão X */
        .subject-tag-item .delete-tag { color: #ff5252; font-weight: bold; margin-left: 2px; }
        .subject-tag-item.active-tag .delete-tag { color: white; }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = css;
    document.head.appendChild(style);
})();

// 2. FUNÇÃO HELPER: ENCONTRAR O CARD (Universal)
// Procura o card pelo ID seja na raiz ou dentro de pastas
function findItemUniversal(id) {
    // 1. Procura na Raiz (Estudo)
    let item = appData.studySubjects.find(s => s.id == id);
    if (item) return item;

    // 2. Procura nas Pastas Customizadas
    if (appData.customModes) {
        for (let mode of appData.customModes) {
            if (mode.subItems) {
                item = mode.subItems.find(s => s.id == id);
                if (item) return item;
            }
        }
    }
    return null;
}

// 3. SOBRESCRITA: ABRIR MODAL (Injeta os campos de Input)
const oldChangeIcon = window.changeSubjectIconReal;
window.changeSubjectIconReal = function(id, event) {
    if(event) event.stopPropagation();
    window.idSubjectBeingEdited = id; // Salva o ID globalmente

    const item = findItemUniversal(id);
    if(!item) return;

    // Abre o modal existente
    const modal = document.getElementById('edit-subject-modal');
    if(!modal) return;
    
    document.getElementById('edit-modal-title').innerText = "Editar: " + item.name;
    modal.style.display = 'flex';

    // --- AQUI ESTÁ O TRUQUE: INJETA O HTML SE NÃO EXISTIR ---
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody && !document.getElementById('new-tag-input')) {
        const div = document.createElement('div');
        div.className = 'setting-block';
        div.style.marginTop = '15px';
        div.innerHTML = `
            <label class="setting-title" style="display:block; margin-bottom:5px; font-weight:bold; font-size:0.85rem;">
                <i class="fas fa-tags"></i> Tags
            </label>
            <div style="display: flex; gap: 5px;">
                <input type="text" id="new-tag-input" placeholder="Nova Tag (ex: Revisão)" 
                       style="flex:1; padding: 8px; border:1px solid #ccc; border-radius:4px;">
                <button class="btn-rural small" onclick="addTagToSubject()" style="cursor:pointer;">+</button>
            </div>
            <div id="subject-tags-list"></div>
            <p style="font-size: 0.7rem; color: #888; margin-top: 5px; text-align:right;">
                * Clique na tag para ativar/desativar.
            </p>
        `;
        modalBody.appendChild(div);

        // Configura o Enter
        setTimeout(() => {
            const inp = document.getElementById('new-tag-input');
            if(inp) {
                inp.focus();
                inp.onkeydown = (e) => { if(e.key === 'Enter') window.addTagToSubject(); };
            }
        }, 100);
    } else {
        // Se já existe, só foca e limpa
        const inp = document.getElementById('new-tag-input');
        if(inp) { inp.value = ''; inp.focus(); }
    }

    renderTagsInModal();
};

// 4. FUNÇÃO: ADICIONAR TAG (Lógica Universal)
window.addTagToSubject = function() {
    const input = document.getElementById('new-tag-input');
    if(!input) return;
    
    const tagName = input.value.trim();
    if(!tagName) return;

    const item = findItemUniversal(window.idSubjectBeingEdited);
    if(item) {
        if(!item.tags) item.tags = [];
        
        // Evita duplicatas
        if(!item.tags.includes(tagName)) {
            item.tags.push(tagName);
            saveData();
            renderTagsInModal();
            input.value = '';
            input.focus();
        } else {
            alert("Essa tag já existe!");
        }
    }
};

// 5. FUNÇÃO: RENDERIZAR LISTA DE TAGS
window.renderTagsInModal = function() {
    const container = document.getElementById('subject-tags-list');
    if(!container) return;
    container.innerHTML = '';

    const item = findItemUniversal(window.idSubjectBeingEdited);
    if(item && item.tags) {
        item.tags.forEach(tag => {
            const div = document.createElement('div');
            const isActive = item.currentTag === tag;
            
            div.className = `subject-tag-item ${isActive ? 'active-tag' : ''}`;
            div.innerHTML = `
                <span onclick="selectTag('${tag}')">${tag}</span>
                <span class="delete-tag" onclick="removeTag('${tag}', event)">×</span>
            `;
            container.appendChild(div);
        });
    }
};

// 6. FUNÇÃO: SELECIONAR TAG
window.selectTag = function(tag) {
    const item = findItemUniversal(window.idSubjectBeingEdited);
    if(item) {
        // Toggle: se clicar na ativa, desativa. Se não, ativa.
        item.currentTag = (item.currentTag === tag) ? null : tag;
        saveData();
        renderTagsInModal();
        
        // Atualiza a tela de fundo (Cards)
        if(typeof renderStudySubjects === 'function') renderStudySubjects();
        if(typeof renderUniversalSubCards === 'function') renderUniversalSubCards();
        
        // Se esse item estiver no timer agora, atualiza o topo
        if (currentSubject && currentSubject.id == item.id) {
             if(typeof updateTimerIndicatorForItem === 'function') updateTimerIndicatorForItem(item);
             else if(typeof updateTimerIndicator === 'function') updateTimerIndicator(item);
        }
    }
};
// Compatibilidade com seu código antigo
window.selectTagForSubject = window.selectTag;

// 7. FUNÇÃO: REMOVER TAG
window.removeTag = function(tag, event) {
    if(event) event.stopPropagation();
    const item = findItemUniversal(window.idSubjectBeingEdited);
    if(item) {
        item.tags = item.tags.filter(t => t !== tag);
        if(item.currentTag === tag) item.currentTag = null;
        saveData();
        renderTagsInModal();
    }
};
// Compatibilidade
window.removeTagFromSubject = window.removeTag;

console.log("✅ Sistema de Tags Universal Ativado!");

// ==========================================================================
// ▼ CORREÇÃO DE HISTÓRICO: FORÇAR NOME DO SUBCARD ▼
// Cole no final. Garante que o histórico mostre "Subcard - Tag" e o ícone certo.
// ==========================================================================

console.log("🚀 Aplicando Correção de Histórico de Subcards...");

// 1. SELECIONAR SUBCARD (Com Trava de Segurança)
// Salva o subcard numa variável que não se perde ao trocar de aba.

// 2. SALVAR NO HISTÓRICO (Lógica Prioritária)
// Obriga o salvamento a usar os dados do subcard travado.



// 4. SEGURANÇA NA TROCA DE ABA
// Impede que trocar de aba limpe a seleção se for a aba certa
window.setMode = function(mode) {
    currentMode = mode;

    // Se o usuário clicar manualmente nas abas "Estudo" ou "Anime", limpamos a sessão do subcard.
    // Mas se o modo for igual ao pai da sessão ativa, MANTEMOS a sessão.
    if (mode === 'estudo' || mode === 'anime') {
        const keepSubjectSubcard = mode === "estudo"
          && currentSubcard
          && currentSubcardParent?.type === "subject";

        if (!keepSubjectSubcard) {
            window.ACTIVE_SESSION = null;
            currentSubcard = null;
            currentSubcardParent = null;
            if (mode === "estudo" || mode === "anime") currentSubject = null;
        }
    }
    // Se trocou de uma pasta customizada para outra manualmente
    else if ((window.ACTIVE_SESSION && window.ACTIVE_SESSION.parentId !== mode)
      || (currentSubcard && currentSubcardParent?.type === "mode" && String(currentSubcardParent.id) !== String(mode))) {
        window.ACTIVE_SESSION = null;
        currentSubcard = null;
        currentSubcardParent = null;
    }

    currentSessionMinutes = 0;
    lastLoggedSecond = null;
    sessionTargetMinutes = 0;

    remainingTimeMs = getDurationForMode(mode);
    updateDisplay(remainingTimeMs);
    setModeVisual(mode);
    saveTimerState();

    // Atualiza o indicador visual do topo
    if (window.ACTIVE_SESSION && window.ACTIVE_SESSION.type === 'subcard') {
        // Tenta recuperar o objeto real para mostrar ícone
        const parentKey = normalizeParentKey(window.ACTIVE_SESSION.parentId, window.ACTIVE_SESSION.parentType || "mode");
        const p = ensureCustomSubItems(parentKey);
        const s = p ? p.subItems.find(x => x.id === window.ACTIVE_SESSION.subId) : null;
        if (s) updateTimerIndicatorForItem(s);
    }
    else if (currentSubcard && currentSubcardParent?.type === "subject" && mode === "estudo") {
        updateTimerIndicatorForItem(currentSubcard);
    }
    else if (currentSubject) {
        updateTimerIndicatorForItem(currentSubject);
    } 
    else {
        updateTimerIndicatorForItem(null);
    }
};
