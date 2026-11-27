// ==UserScript==
// @name         Danonane Client 8 (BETA)
// @namespace    https://survev.io/
// @version      2.1.0
// @description  Clean, customizable QoL client for survev.io / resurviv.biz: Real ping + FPS, HP & Adrenaline, Spectator Stats Card, Theme Glow, Kill Sound, Live Ping in Server Dropdown, Vanilla Replays Menu in Main Lobby, Music Search, Embedded YouTube Player & Visualizer, Crosshair Code Import, gun caliber borders, 0ms CPS, and Replay System. Menu: Right Shift.
// @author       Dzidekus
// @match        *://survev.io/*
// @match        *://*.survev.io/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__pinklineLoaded) return;
  window.__pinklineLoaded = true;

  const VERSION = '2.1.0';
  const STORE_KEY = 'pinkline.settings.v6';
  const FINDGAME_CACHE_KEY = 'pinkline.findgame.v2cache';
  const REPLAY_BOOKMARK_CODE = 'KeyH';
  const REPLAY_CINEMA_CODE = 'KeyJ';
  const NativeWS = window.WebSocket;
  const NativeFetch = window.fetch;

  /* =====================================================================
   *  Diagnostics & Logging
   * ===================================================================== */
  const debugLogs = [];
  const ui = {};
  function renderDebugLog() {
    const el = ui.debugLogEl;
    if (!el) return;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    el.textContent = '';
    for (const line of debugLogs.length ? debugLogs : ['Waiting for log entries…']) {
      const row = document.createElement('div');
      const lvl = /\[(WARN|ERROR)\]/.exec(line);
      row.className = 'log-line' + (lvl ? ' ' + lvl[1].toLowerCase() : '');
      row.textContent = line;
      el.appendChild(row);
    }
    if (stick) el.scrollTop = el.scrollHeight;
  }
  function addDebugLog(msg, level = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] [${level.toUpperCase()}] ${msg}`;
    debugLogs.push(entry);
    if (debugLogs.length > 100) debugLogs.shift();
    if (ui.debugLogEl) renderDebugLog();
  }

  window.addEventListener('error', (e) => {
    addDebugLog(`Uncaught Error: ${e.message} at ${e.filename}:${e.lineno}`, 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    addDebugLog(`Unhandled Promise: ${e.reason}`, 'error');
  });

  /* =====================================================================
   *  Region Mapping & Weapon Calibers (Guns Only)
   * ===================================================================== */
  const REGION_SERVERS = {
    eu: 'wss://eur.mathsiscoolfun.com:8001/ptc',
    na: 'wss://usr.mathsiscoolfun.com:8001/ptc',
    ru: 'wss://russia.mathsiscoolfun.com:8001/ptc',
    asia: 'wss://asr.mathsiscoolfun.com:8001/ptc',
    sa: 'wss://sa.mathsiscoolfun.com:8001/ptc',
  };

  const WEAPON_COLORS = {
    // 9mm (Amber Yellow)
    'MP5': '#FFAE00', 'MAC-10': '#FFAE00', 'UMP9': '#FFAE00', 'Vector': '#FFAE00',
    'CZ-3A1': '#FFAE00', 'VSS': '#FFAE00', 'M9': '#FFAE00', 'Dual M9': '#FFAE00',
    'M93R': '#FFAE00', 'Dual M93R': '#FFAE00', 'G18C': '#FFAE00', 'Dual G18C': '#FFAE00',
    'P30L': '#FFAE00', 'Dual P30L': '#FFAE00',

    // 5.56mm (Forest Green)
    'FAMAS': '#039E00', 'M416': '#039E00', 'M4A1-S': '#039E00', 'Mk 12 SPR': '#039E00',
    'L86A2': '#039E00', 'M249': '#039E00', 'QBB-97': '#039E00', 'Scout Elite': '#039E00',
    'IMD-2': '#039E00',

    // 7.62mm (Cobalt Blue)
    'AK-47': '#0066FF', 'SCAR-H': '#0066FF', 'AN-94': '#0066FF', 'Groza': '#0066FF',
    'Groza-S': '#0066FF', 'DP-28': '#0066FF', 'BAR M1918': '#0066FF', 'PKP Pecheneg': '#0066FF',
    'BLR 81': '#0066FF', 'Mosin-Nagant': '#0066FF', 'SV-98': '#0066FF', 'M39 EMR': '#0066FF',
    'SVD-63': '#0066FF', 'M1 Garand': '#0066FF', 'OT-38': '#0066FF', 'Dual OT-38': '#0066FF',
    'OTs-38': '#0066FF', 'Dual OTs-38': '#0066FF',

    // 12 Gauge (Crimson Red)
    'M870': '#FF0000', 'M1100': '#FF0000', 'MP220': '#FF0000', 'Saiga-12': '#FF0000',
    'SPAS-12': '#FF0000', 'SPAS-16': '#FF0000', 'M1014': '#FF0000', 'USAS-12': '#FF0000',
    'Super 90': '#FF0000',

    // .45 ACP (Purple)
    'Model 94': '#9D00FF', 'Mk45G': '#9D00FF', 'Peacemaker': '#9D00FF',
    'Dual Peacemaker': '#9D00FF', 'M1911': '#9D00FF', 'Dual M1911': '#9D00FF',
    'M1A1': '#9D00FF',

    // .308 Subsonic (Cyan)
    'AWM-S': '#00FFFF', 'SCAR-SSR': '#00FFFF',

    // .50 AE / Heavy (Silver)
    'DEagle 50': '#888888', 'Dual DEagle 50': '#888888', 'Barrett M107': '#888888',
    'S&W 500': '#888888', 'ASh-12': '#888888',

    // Specials
    'Flare Gun': '#FF5500', 'Potato Cannon': '#A56A2B', 'Potato SMG': '#A56A2B',
    'PMG-134': '#A56A2B', 'Rainbow Blaster': '#FF00FF'
  };

  /* =====================================================================
   *  Settings & Storage
   * ===================================================================== */
  const DEFAULTS = {
    menuKey: 'ShiftRight',
    accent: '#67a646',
    hud: {
      fps: true,
      ping: true,
      matchTimer: true,
      clock: false,
      onlyInGame: false,
      hpNumber: true,
      hpOffsetY: 16,
      adrenalineNumber: true,
      spectatorCard: true,
      barTextSize: 18,
      lowHpAlert: true,
      scale: 100,
      opacity: 100,
      keystrokes: false,
      cps: true,
      musicHud: false,
    },
    pos: {
      stats: { x: 14, y: 14 },
      keys: { x: 14, y: 170 },
      musicHud: { x: 14, y: 310 },
      musicVideo: { x: 20, y: 20 },
      playlistModal: { x: 380, y: 100 },
      replayHud: { x: 14, y: 420 },
      specCard: { x: 14, y: 530 },
    },
    visuals: {
      hudGlow: false,
      themeLobbyButtons: false,
      killSound: false,
      killSoundType: 'ding',
      killSoundVolume: 60,
    },
    crosshair: {
      enabled: false,
      style: 'cross',
      color: '#ffffff',
      outlineColor: '#000000',
      size: 24,
      thickness: 2,
      gap: 5,
    innerEnabled: true,
    innerLength: 7,
    innerVerticalLength: 7,
    innerThickness: 2,
    innerOffset: 5,
    innerOpacity: 1,
    outerEnabled: false,
    outerLength: 7,
    outerVerticalLength: 7,
    outerThickness: 2,
    outerOffset: 12,
    outerOpacity: 1,
    outlineWidth: 2.5,
    outlineOpacity: 1,
      dot: false,
      dotSize: 3,
    dotOpacity: 1,
      outline: true,
    },
    music: {
      playlists: [
        {
          id: 'pl_default',
          name: 'My Playlist',
          tracks: [],
        },
      ],
      activePlaylistId: 'pl_default',
      currentTrackIndex: 0,
      volume: 45,
      loop: false,
      autoNext: true,
      showVideo: false,
    },
    replay: {
      autoRecord: true,
      maxSaved: 10,
      killMarkers: true,
      bookmarkHotkey: true,
      cinemaHotkey: true,
    },
    ui: {
      variant: 'classic',
      askVariant: true,
      weaponBorders: true,
      serverDropdownPing: true,
      lobbyReplaysBtn: true,
      hideSocials: true,
      hideAds: true,
      hideNews: false,
      hideKillfeed: false,
      hideKillLeader: false,
    },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function merge(base, incoming) {
    if (!isObj(incoming)) return base;
    for (const k of Object.keys(base)) {
      if (!(k in incoming)) continue;
      if (isObj(base[k])) merge(base[k], incoming[k]);
      else if (typeof incoming[k] === typeof base[k]) base[k] = incoming[k];
    }
    return base;
  }
  const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  const setPath = (o, p, v) => {
    const ks = p.split('.');
    const last = ks.pop();
    ks.reduce((a, k) => a[k], o)[last] = v;
  };

  let S;
  try {
    S = merge(clone(DEFAULTS), JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
  } catch (_) {
    S = clone(DEFAULTS);
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(S));
      } catch (_) {}
    }, 200);
  }

  /* =====================================================================
   *  Helpers
   * ===================================================================== */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (sec) => {
    if (isNaN(sec) || sec < 0) return '00:00';
    return pad2(Math.floor(sec / 60)) + ':' + pad2(Math.floor(sec % 60));
  };
  const fmtShortDuration = (ms) => {
    const sec = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(sec / 60) + ':' + pad2(sec % 60);
  };
  const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const replayBytes = (rec) => {
    let n = 0;
    for (const p of rec.packets || []) n += p.d ? p.d.byteLength || p.d.length || 0 : 0;
    return n;
  };
  const totalReplayBytes = () => replay.list.reduce((a, r) => a + replayBytes(r), 0);
  const SORT_OPTIONS = [
    ['newest', 'Newest'],
    ['oldest', 'Oldest'],
    ['longest', 'Longest'],
    ['kills', 'Most kills'],
  ];
  const keyName = (code) =>
    code
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace(/^(Shift|Control|Alt)(Left|Right)$/, '$2 $1')
      .replace(/([a-z])([A-Z])/g, '$1 $2');

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function isVisibleEl(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function uint8ToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function base64ToUint8(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function normalizePacketBytes(raw) {
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (Array.isArray(raw)) return new Uint8Array(raw);
    if (raw && typeof raw === 'object') {
      const keys = Object.keys(raw);
      const len = keys.length;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = raw[i] & 255;
      return out;
    }
    return new Uint8Array(0);
  }

  /* =====================================================================
   *  Web Audio Kill Sound Synthesizer
   * ===================================================================== */
  let audioCtx = null;
  function playKillSound(forceType) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;
      const vol = clamp((S.visuals.killSoundVolume || 60) / 100, 0.05, 1) * 0.35;
      const type = forceType || S.visuals.killSoundType || 'ding';

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'ding') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.exponentialRampToValueAtTime(1567.98, now + 0.09);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'pop') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.07);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (type === 'coin') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(987.77, now);
        osc.frequency.setValueAtTime(1318.51, now + 0.07);
        gain.gain.setValueAtTime(vol * 0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.start(now);
        osc.stop(now + 0.27);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.33);
      }
    } catch (_) {}
  }

  /* =====================================================================
   *  IndexedDB Storage (Replays + Uploaded Visual Assets)
   * ===================================================================== */
  const REPLAY_DB_NAME = 'DanonaneReplaysDB';
  const REPLAY_STORE = 'replays';
  let armTimeout = 0;
  let vanillaModalOpen = false;
  const replay = {
    mode: 'record', // 'record' | 'recent' | 'file'
    armedOneShot: false,
    list: [],
    selectedId: null,
    fileReplay: null,
    recording: null,
    active: false,
    activeSocket: null,
    activeData: null,
    paused: false,
    seeking: false,
    cinema: false,
    pendingSeekMs: 0,
    speed: 1,
    virtualTimeMs: 0,
    packetIndex: 0,
    finished: false,
    filter: 'all', // 'all' | 'fav' | 'win' | 'highkills'
    search: '',
    sort: 'newest',
  };

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(REPLAY_DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(REPLAY_STORE)) {
          db.createObjectStore(REPLAY_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function sortReplayList() {
    replay.list.sort((a, b) => {
      const fa = a.favorite ? 1 : 0;
      const fb = b.favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  async function loadSavedReplays() {
    try {
      const db = await idbOpen();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(REPLAY_STORE, 'readonly');
        const req = tx.objectStore(REPLAY_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      for (const rec of items) {
        if (!Array.isArray(rec.packets)) continue;
        let repaired = false;
        for (const p of rec.packets) {
          if (!(p.d instanceof Uint8Array)) {
            p.d = normalizePacketBytes(p.d);
            repaired = true;
          }
        }
        if (repaired) {
          addDebugLog(`Auto-repaired packet bytes for "${formatReplayLabel(rec)}"`);
          try {
            const txW = db.transaction(REPLAY_STORE, 'readwrite');
            txW.objectStore(REPLAY_STORE).put(rec);
          } catch (_) {}
        }
      }

      replay.list = items;
      sortReplayList();
      if (!replay.selectedId && replay.list.length) replay.selectedId = replay.list[0].id;
      refreshReplayUI();
    } catch (err) {
      addDebugLog(`Replay DB load error: ${err.message}`, 'warn');
    }
  }

  async function saveReplayToDB(rec) {
    rec.favorite = !!rec.favorite;
    rec.name = rec.name || '';
    rec.markers = Array.isArray(rec.markers) ? rec.markers : [];
    rec.meta = rec.meta || { kills: 0, placement: '', weapons: [] };
    if (!replay.list.some((r) => r.id === rec.id)) {
      replay.list.unshift(rec);
    }

    const favorites = replay.list.filter((r) => r.favorite);
    const normals = replay.list.filter((r) => !r.favorite);
    normals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const maxN = clamp(S.replay.maxSaved || 10, 1, 50);
    const removed = normals.splice(maxN);
    replay.list = [...favorites, ...normals];
    sortReplayList();
    replay.selectedId = rec.id;

    try {
      const db = await idbOpen();
      const tx = db.transaction(REPLAY_STORE, 'readwrite');
      const store = tx.objectStore(REPLAY_STORE);
      store.put(rec);
      for (const old of removed) store.delete(old.id);
    } catch (err) {
      addDebugLog(`Replay DB save error: ${err.message}`, 'warn');
    }
    refreshReplayUI();
  }

  async function updateReplayInDB(rec) {
    if (!rec) return;
    sortReplayList();
    try {
      const db = await idbOpen();
      const tx = db.transaction(REPLAY_STORE, 'readwrite');
      tx.objectStore(REPLAY_STORE).put(rec);
    } catch (err) {
      addDebugLog(`Replay DB update error: ${err.message}`, 'warn');
    }
    refreshReplayUI();
  }

  async function deleteReplayFromDB(id, skipConfirm = false) {
    const target = replay.list.find((r) => r.id === id);
    if (!target) return;
    if (!skipConfirm && target.favorite) {
      if (!window.confirm(`"${formatReplayLabel(target)}" is favourited. Delete it anyway?`)) return;
    }
    replay.list = replay.list.filter((r) => r.id !== id);
    if (replay.selectedId === id) {
      replay.selectedId = replay.list.length ? replay.list[0].id : null;
    }
    try {
      const db = await idbOpen();
      const tx = db.transaction(REPLAY_STORE, 'readwrite');
      tx.objectStore(REPLAY_STORE).delete(id);
    } catch (_) {}
    refreshReplayUI();
  }

  async function clearNonFavoriteReplaysDB() {
    const favorites = replay.list.filter((r) => r.favorite);
    const toDelete = replay.list.filter((r) => !r.favorite);
    replay.list = favorites;
    replay.selectedId = replay.list.length ? replay.list[0].id : null;
    try {
      const db = await idbOpen();
      const tx = db.transaction(REPLAY_STORE, 'readwrite');
      const store = tx.objectStore(REPLAY_STORE);
      for (const old of toDelete) store.delete(old.id);
    } catch (_) {}
    refreshReplayUI();
  }

  function toggleReplayFavorite(rec) {
    if (!rec) return;
    if (rec === replay.fileReplay && !replay.list.some((r) => r.id === rec.id)) {
      rec.favorite = true;
      replay.fileReplay = null;
      replay.mode = 'recent';
      saveReplayToDB(rec);
      toast('Imported replay saved & favourited ★');
      return;
    }
    rec.favorite = !rec.favorite;
    updateReplayInDB(rec);
    toast(rec.favorite ? 'Added to Favourites ★' : 'Removed from Favourites');
  }

  function renameReplay(rec) {
    if (!rec) return;
    const next = window.prompt('Enter replay name (leave blank to reset to default):', rec.name || '');
    if (next === null) return;
    rec.name = next.trim();
    if (rec === replay.fileReplay && !replay.list.some((r) => r.id === rec.id)) {
      replay.fileReplay = null;
      replay.mode = 'recent';
      saveReplayToDB(rec);
    } else if (replay.list.some((r) => r.id === rec.id)) {
      updateReplayInDB(rec);
    } else {
      refreshReplayUI();
    }
    toast(rec.name ? `Renamed to "${rec.name}"` : 'Replay name reset');
  }

  function formatReplayLabel(rec) {
    if (!rec) return 'No recording';
    const star = rec.favorite ? '★ ' : '';
    const dur = fmtShortDuration(rec.durationMs);
    const metaParts = [];
    if (rec.meta && rec.meta.kills > 0) metaParts.push(`${rec.meta.kills}K`);
    if (rec.meta && rec.meta.placement) metaParts.push(rec.meta.placement);
    const metaSuffix = metaParts.length ? ` · ${metaParts.join(' ')}` : '';

    if (rec.name) {
      return `${star}${rec.name} (${dur}${metaSuffix})`;
    }
    const d = new Date(rec.createdAt || Date.now());
    const hhmm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const host = rec.host || 'survev.io';
    return `${star}${dur}${metaSuffix} ${hhmm} ${host}`;
  }

  function getActiveSelectedReplay() {
    if (replay.mode === 'file' && replay.fileReplay) return replay.fileReplay;
    if (replay.selectedId) {
      const found = replay.list.find((r) => r.id === replay.selectedId);
      if (found) return found;
    }
    return replay.fileReplay || replay.list[0] || null;
  }

  // A replay only starts when the user explicitly pressed Watch (one-shot, expires).
  // It must NEVER stay armed afterwards, or normal Play presses would run a replay.
  function isReplayArmed() {
    return !!replay.armedOneShot && !!replay.activeData;
  }

  function downloadReplayFile(rec) {
    if (!rec || !rec.packets || !rec.packets.length) {
      toast('Nothing to save');
      return;
    }
    const payload = {
      format: 'danonane-replay-v1',
      id: rec.id,
      name: rec.name || '',
      favorite: !!rec.favorite,
      host: rec.host,
      createdAt: rec.createdAt,
      durationMs: rec.durationMs,
      markers: rec.markers || [],
      meta: rec.meta || { kills: 0, placement: '', weapons: [] },
      packets: rec.packets.map((p) => [p.t, uint8ToBase64(normalizePacketBytes(p.d))]),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const safeName = rec.name ? rec.name.replace(/[^a-z0-9_-]+/gi, '_') : new Date(rec.createdAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `survev-replay-${safeName}.svrep`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Replay file downloaded!');
  }

  function parseImportedReplayText(text, filename) {
    const json = JSON.parse(text);

    if (json && json.format === 'danonane-replay-v1' && Array.isArray(json.packets)) {
      const packets = json.packets.map(([t, b64]) => ({ t: Number(t) || 0, d: base64ToUint8(b64) }));
      return {
        id: json.id || 'file_' + Date.now(),
        name: json.name || '',
        favorite: !!json.favorite,
        host: json.host || filename || 'file',
        createdAt: json.createdAt || Date.now(),
        durationMs: json.durationMs || (packets.length ? packets[packets.length - 1].t : 0),
        markers: Array.isArray(json.markers) ? json.markers : [],
        meta: json.meta || { kills: 0, placement: '', weapons: [] },
        packets,
      };
    }

    const entries = json?.log?.entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const msgs = entry._webSocketMessages;
        if (!Array.isArray(msgs) || msgs.length < 5) continue;
        const incoming = msgs.filter((m) => m.type === 'receive' && m.data);
        if (incoming.length < 5) continue;
        const t0 = incoming[0].time || 0;
        const packets = incoming.map((m) => ({
          t: Math.max(0, Math.round(((m.time || t0) - t0) * 1000)),
          d: base64ToUint8(m.data),
        }));
        let host = filename || 'har-replay';
        try {
          host = new URL(entry.request.url).host;
        } catch (_) {}
        return {
          id: 'har_' + Date.now(),
          name: '',
          favorite: false,
          host,
          createdAt: Date.now(),
          durationMs: packets.length ? packets[packets.length - 1].t : 0,
          markers: [],
          meta: { kills: 0, placement: '', weapons: [] },
          packets,
        };
      }
    }

    throw new Error('Unsupported replay format');
  }

  function loadReplayFileObject(file, autoPlay = false) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportedReplayText(String(reader.result || ''), file.name);
        replay.fileReplay = parsed;
        replay.mode = 'file';
        refreshReplayUI();
        toast(`Loaded replay (${fmtShortDuration(parsed.durationMs)})`);
        if (autoPlay) triggerWatchReplay(parsed);
      } catch (err) {
        toast('Invalid replay file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function findStartButton() {
    const ids = ['btn-start-mode-0', 'btn-start-mode-1', 'btn-start-mode-2'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null && !el.disabled && !el.classList.contains('btn-disabled')) {
        return el;
      }
    }
    return document.querySelector('[id^="btn-start-mode-"]:not([disabled]):not(.btn-disabled)');
  }

  function triggerWatchReplay(targetRec, seekMs = 0) {
    const rec = targetRec || getActiveSelectedReplay();
    if (!rec || !rec.packets || !rec.packets.length) {
      toast('Select or load a replay first!');
      return;
    }
    if (net.gameWs) {
      toast('Exit current match before starting a replay');
      return;
    }
    replay.activeData = rec;
    replay.pendingSeekMs = seekMs;
    replay.armedOneShot = true;
    clearTimeout(armTimeout);
    armTimeout = setTimeout(() => {
      replay.armedOneShot = false;
    }, 15000);

    const btn = findStartButton();
    if (btn) {
      addDebugLog(`Starting replay via #${btn.id}`);
      toast(seekMs > 0 ? `Seeking to ${fmtShortDuration(seekMs)}…` : 'Starting replay…');
      btn.click();
    } else {
      toast('Replay armed! Click Play Solo / Squad to start.');
    }
  }

  function setReplaySpeed(spd) {
    if (!replay.activeSocket) return;
    replay.activeSocket.setSpeed(spd);
    replay.speed = spd;
    updateReplayHud();
  }

  function toggleReplayPause() {
    if (!replay.activeSocket) return;
    if (replay.finished) {
      restartReplay();
      return;
    }
    replay.activeSocket.togglePause();
    updateReplayHud();
  }

  function setCinemaMode(on) {
    replay.cinema = !!on && replay.active;
    document.documentElement.classList.toggle('pl-cinema-mode', replay.cinema);
    if (root) root.classList.toggle('cinema', replay.cinema);
    if (ui.rhCinemaBtn) ui.rhCinemaBtn.classList.toggle('active', replay.cinema);
  }

  function jumpToMarker(dir) {
    if (!replay.active || !replay.activeData) return;
    const markers = replay.activeData.markers || [];
    if (!markers.length) {
      toast('No kill/bookmark markers in this replay');
      return;
    }
    const cur = replay.virtualTimeMs;
    const sorted = [...markers].sort((a, b) => a.t - b.t);
    if (dir > 0) {
      const next = sorted.find((m) => m.t > cur + 3200);
      if (next) seekReplayTo(Math.max(0, next.t - 2500));
      else toast('No later markers');
    } else {
      const prevs = sorted.filter((m) => m.t < cur - 500);
      if (prevs.length) {
        const prev = prevs[prevs.length - 1];
        seekReplayTo(Math.max(0, prev.t - 2500));
      } else {
        toast('No earlier markers');
      }
    }
  }

  function seekReplayTo(targetMs) {
    if (!replay.active || !replay.activeSocket || !replay.activeData) return;
    const total = replay.activeData.durationMs || 0;
    targetMs = clamp(Math.round(targetMs), 0, total);

    if (targetMs >= replay.virtualTimeMs) {
      replay.activeSocket.seekForwardTo(targetMs);
      return;
    }

    const rec = replay.activeData;
    const wasCinema = replay.cinema;
    exitReplay(true);
    let attempts = 0;
    const pollLobby = setInterval(() => {
      attempts++;
      const modalOk = document.querySelector('#modal-notification .modal-footer .btn, #ui-modal-disconnect .btn-confirm');
      if (modalOk && modalOk.offsetParent !== null) modalOk.click();

      const startBtn = findStartButton();
      const menuWrap = document.getElementById('start-menu-wrapper');
      const menuVisible = !menuWrap || menuWrap.style.display !== 'none';

      if (!net.gameWs && startBtn && startBtn.offsetParent !== null && menuVisible) {
        clearInterval(pollLobby);
        triggerWatchReplay(rec, targetMs);
        if (wasCinema) setTimeout(() => setCinemaMode(true), 200);
      } else if (attempts > 40) {
        clearInterval(pollLobby);
        toast('Could not auto-restart for backward seek');
      }
    }, 100);
  }

  function restartReplay() {
    if (!replay.active) return;
    seekReplayTo(0);
  }

  function exitReplay(silent = false) {
    const quitBtn =
      document.getElementById('btn-game-quit') ||
      document.querySelector('.btn-quit') ||
      document.getElementById('btn-stats-quit');

    setCinemaMode(false);
    if (replay.activeSocket) {
      try {
        replay.activeSocket.close(1000, 'Exited replay');
      } catch (_) {}
    }
    replay.active = false;
    replay.activeSocket = null;
    replay.armedOneShot = false;
    replay.seeking = false;
    updateReplayHud();

    if (quitBtn) {
      try {
        quitBtn.click();
      } catch (_) {}
    }
    if (!silent) {
      setTimeout(() => {
        const modalOk = document.querySelector('#modal-notification .modal-footer .btn, #ui-modal-disconnect .btn-confirm');
        if (modalOk && modalOk.offsetParent !== null) modalOk.click();
      }, 150);
    }
  }

  /* =====================================================================
   *  FakeReplayWebSocket
   * ===================================================================== */
  class FakeReplayWebSocket extends EventTarget {
    constructor(url, recData) {
      super();
      this.url = url;
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.readyState = 0;
      this.CONNECTING = 0;
      this.OPEN = 1;
      this.CLOSING = 2;
      this.CLOSED = 3;

      this._handlers = { open: null, message: null, error: null, close: null };
      this._rec = recData;
      this._startedStream = false;
      this._timer = 0;
      this._seekTimer = 0;
      this._lastReal = 0;

      clearTimeout(armTimeout);
      replay.active = true;
      replay.activeSocket = this;
      replay.paused = false;
      replay.seeking = false;
      replay.speed = 1;
      replay.virtualTimeMs = 0;
      replay.packetIndex = 0;
      replay.finished = false;
      replay.armedOneShot = false;

      addDebugLog(`Replay WebSocket starting (${recData.packets.length} packets, ${fmtShortDuration(recData.durationMs)})`);

      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this._emit('open', new Event('open'));
        renderTimelineMarkers();
        updateReplayHud();

        setTimeout(() => {
          if (this.readyState === 1 && !this._startedStream) this._beginStream();
        }, 120);
      }, 25);
    }

    get onopen() { return this._handlers.open; }
    set onopen(fn) { this._handlers.open = fn; }
    get onmessage() { return this._handlers.message; }
    set onmessage(fn) { this._handlers.message = fn; }
    get onerror() { return this._handlers.error; }
    set onerror(fn) { this._handlers.error = fn; }
    get onclose() { return this._handlers.close; }
    set onclose(fn) { this._handlers.close = fn; }

    _emit(type, event) {
      const fn = this._handlers[type];
      if (typeof fn === 'function') {
        try {
          fn.call(this, event);
        } catch (err) {
          addDebugLog(`Replay handler error (${type}): ${err.message}`, 'error');
        }
      }
      this.dispatchEvent(event);
    }

    _dispatchPacket(pkt) {
      const bytes = normalizePacketBytes(pkt.d);
      if (!bytes.length) return;
      const payload = this.binaryType === 'blob' ? new Blob([bytes]) : bytes.slice().buffer;
      this._emit('message', new MessageEvent('message', { data: payload }));
    }

    _beginStream() {
      if (this._startedStream || this.readyState !== 1) return;
      this._startedStream = true;
      this._lastReal = performance.now();

      const pkts = this._rec.packets;
      if (pkts.length && pkts[0].t > 100) {
        replay.virtualTimeMs = pkts[0].t - 20;
      }

      if (replay.pendingSeekMs > 0) {
        const target = replay.pendingSeekMs;
        replay.pendingSeekMs = 0;
        while (replay.packetIndex < pkts.length && replay.packetIndex < 3) {
          this._dispatchPacket(pkts[replay.packetIndex]);
          replay.virtualTimeMs = pkts[replay.packetIndex].t;
          replay.packetIndex++;
        }
        setTimeout(() => {
          if (this.readyState === 1) this.seekForwardTo(target);
        }, 90);
      }

      this._timer = setInterval(() => this._tick(), 10);
    }

    _tick() {
      if (this.readyState !== 1) {
        clearInterval(this._timer);
        return;
      }
      const now = performance.now();
      if (replay.paused || replay.finished || replay.seeking) {
        this._lastReal = now;
        return;
      }

      const dt = now - this._lastReal;
      this._lastReal = now;
      replay.virtualTimeMs += dt * replay.speed;

      const pkts = this._rec.packets;
      let processed = 0;
      while (replay.packetIndex < pkts.length && pkts[replay.packetIndex].t <= replay.virtualTimeMs) {
        this._dispatchPacket(pkts[replay.packetIndex]);
        replay.packetIndex++;
        processed++;
        if (processed >= 250) break;
      }

      if (replay.packetIndex >= pkts.length && !replay.finished) {
        replay.finished = true;
        updateReplayHud();
        toast('Replay finished! Drag timeline back, Restart, or Exit.');
      }
    }

    seekForwardTo(targetMs) {
      if (this.readyState !== 1) return;
      clearTimeout(this._seekTimer);
      replay.seeking = true;
      replay.finished = false;
      updateReplayHud();

      const pkts = this._rec.packets;
      const step = () => {
        if (this.readyState !== 1) {
          replay.seeking = false;
          return;
        }
        let batch = 0;
        while (replay.packetIndex < pkts.length && pkts[replay.packetIndex].t <= targetMs && batch < 300) {
          this._dispatchPacket(pkts[replay.packetIndex]);
          replay.virtualTimeMs = pkts[replay.packetIndex].t;
          replay.packetIndex++;
          batch++;
        }

        if (replay.packetIndex < pkts.length && pkts[replay.packetIndex].t <= targetMs) {
          updateReplayHud();
          this._seekTimer = setTimeout(step, 0);
        } else {
          replay.virtualTimeMs = targetMs;
          replay.seeking = false;
          this._lastReal = performance.now();
          if (replay.packetIndex >= pkts.length) replay.finished = true;
          updateReplayHud();
        }
      };
      step();
    }

    setSpeed(spd) {
      const now = performance.now();
      if (!replay.paused && !replay.finished && !replay.seeking && this._startedStream) {
        replay.virtualTimeMs += (now - this._lastReal) * replay.speed;
      }
      this._lastReal = now;
      replay.speed = spd;
    }

    togglePause() {
      const now = performance.now();
      if (!replay.paused && !replay.finished && !replay.seeking && this._startedStream) {
        replay.virtualTimeMs += (now - this._lastReal) * replay.speed;
      }
      this._lastReal = now;
      replay.paused = !replay.paused;
    }

    send(_data) {
      if (this.readyState === 1 && !this._startedStream) {
        setTimeout(() => this._beginStream(), 15);
      }
    }

    close(code = 1000, reason = '') {
      if (this.readyState === 3) return;
      clearInterval(this._timer);
      clearTimeout(this._seekTimer);
      this.readyState = 3;
      replay.active = false;
      replay.seeking = false;
      setCinemaMode(false);
      if (replay.activeSocket === this) replay.activeSocket = null;
      updateReplayHud();
      this._emit('close', new CloseEvent('close', { code, reason, wasClean: true }));
    }
  }

  /* =====================================================================
   *  Network Intercepts (find_game pass-through + WebSocket + Multi-Region Ping)
   * ===================================================================== */
  function extractUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (input && typeof input.href === 'string') return input.href;
    try {
      return String(input || '');
    } catch (_) {
      return '';
    }
  }

  function isFindGameUrl(url) {
    return typeof url === 'string' && url.toLowerCase().includes('find_game');
  }

  window.fetch = function (input, init) {
    const url = extractUrl(input);
    if (isFindGameUrl(url)) {
      return NativeFetch.apply(this, arguments)
        .then((resp) => {
          try {
            resp.clone().text().then((txt) => {
              if (txt && txt.startsWith('{')) {
                try {
                  localStorage.setItem(FINDGAME_CACHE_KEY, txt);
                } catch (_) {}
                addDebugLog(`find_game resolved (${url}) -> keys: ${Object.keys(JSON.parse(txt)).join(',')}`);
              }
            }).catch(() => {});
          } catch (_) {}
          return resp;
        })
        .catch((err) => {
          if (isReplayArmed()) {
            const cached = localStorage.getItem(FINDGAME_CACHE_KEY);
            if (cached) {
              addDebugLog('Using cached find_game response for offline Replay');
              return new Response(cached, {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
          throw err;
        });
    }
    return NativeFetch.apply(this, arguments);
  };

  const net = {
    gameWs: null,
    gameUrl: null,
    ptcWs: null,
    ping: null,
    minPing: 9999,
    maxPing: 0,
    samples: [],
    matchStart: 0,
    regionPings: {},
    lastKills: 0,
  };
  let pingTimer = 0;
  let pingProbeTimeout = 0;
  let pingGen = 0;

  const origLog = console.log;
  console.log = function (...args) {
    try {
      if (args.length >= 6 && args[0] === 'region' && args[4] === 'ping') {
        const region = String(args[1]);
        const sec = parseFloat(args[5]);
        if (!isNaN(sec) && sec < 5) {
          const ms = Math.round(sec * 1000);
          net.regionPings[region] = ms;
          if (!net.gameWs && (net.ping == null || region === 'eu')) {
            net.ping = ms;
          }
          updateServerDropdownPings();
        }
      }
    } catch (_) {}
    return origLog.apply(console, args);
  };

  function stopPing() {
    pingGen++;
    clearTimeout(pingTimer);
    clearTimeout(pingProbeTimeout);
    pingTimer = 0;
    pingProbeTimeout = 0;
    if (net.ptcWs) {
      try {
        net.ptcWs.onopen = net.ptcWs.onmessage = net.ptcWs.onerror = net.ptcWs.onclose = null;
        net.ptcWs.close();
      } catch (_) {}
      net.ptcWs = null;
    }
  }

  function resolvePtcUrl() {
    if (net.gameUrl && !net.gameUrl.includes('replay.local')) {
      try {
        const u = new URL(net.gameUrl, location.href);
        const proto = u.protocol === 'ws:' ? 'ws:' : 'wss:';
        return `${proto}//${u.host}/ptc`;
      } catch (_) {}
    }
    const region =
      document.getElementById('server-select-main')?.value ||
      document.getElementById('team-server-select')?.value ||
      'eu';
    return REGION_SERVERS[region] || REGION_SERVERS.eu;
  }

  function startPing() {
    stopPing();
    const gen = pingGen;
    const targetUrl = resolvePtcUrl();

    let ws;
    try {
      ws = new NativeWS(targetUrl);
    } catch (err) {
      pingTimer = setTimeout(() => gen === pingGen && startPing(), 3000);
      return;
    }
    ws.binaryType = 'arraybuffer';
    net.ptcWs = ws;

    let sentAt = 0;
    let awaitingProbe = false;
    const scheduleProbe = (delay = 1000) => {
      clearTimeout(pingTimer);
      pingTimer = setTimeout(probe, delay);
    };
    const probe = () => {
      if (gen !== pingGen || ws.readyState !== 1) return;
      awaitingProbe = true;
      sentAt = performance.now();
      clearTimeout(pingProbeTimeout);
      pingProbeTimeout = setTimeout(() => {
        if (gen !== pingGen || ws.readyState !== 1 || !awaitingProbe) return;
        awaitingProbe = false;
        scheduleProbe(250);
      }, 2500);
      try {
        ws.send(new ArrayBuffer(1));
      } catch (_) {
        awaitingProbe = false;
      }
    };

    ws.onopen = () => probe();
    ws.onmessage = () => {
      if (gen !== pingGen || !awaitingProbe) return;
      awaitingProbe = false;
      clearTimeout(pingProbeTimeout);
      const rtt = Math.round(performance.now() - sentAt);
      if (rtt <= 0 || rtt >= 3000) {
        scheduleProbe(250);
        return;
      }
      net.samples.push(rtt);
      if (net.samples.length > 12) net.samples.shift();
      const recent = net.samples.slice(-9).sort((a, b) => a - b);
      net.ping = recent[Math.floor(recent.length / 2)];
      net.minPing = Math.min(net.minPing, rtt);
      net.maxPing = Math.max(net.maxPing, rtt);
      scheduleProbe(1000);
    };

    const onErrorOrClose = () => {
      if (gen !== pingGen) return;
      pingTimer = setTimeout(() => gen === pingGen && startPing(), 3000);
    };
    ws.onerror = onErrorOrClose;
    ws.onclose = onErrorOrClose;
  }

  function probeAllRegions() {
    if (net.gameWs || !S.ui.serverDropdownPing || music.playing) return;
    for (const [reg, url] of Object.entries(REGION_SERVERS)) {
      try {
        const pws = new NativeWS(url);
        pws.binaryType = 'arraybuffer';
        let t0 = 0;
        const killer = setTimeout(() => {
          try { pws.close(); } catch (_) {}
        }, 4000);
        pws.onopen = () => {
          t0 = performance.now();
          try { pws.send(new ArrayBuffer(1)); } catch (_) {}
        };
        pws.onmessage = () => {
          clearTimeout(killer);
          const ms = Math.round(performance.now() - t0);
          if (!isNaN(ms) && ms > 0 && ms < 3000) {
            net.regionPings[reg] = ms;
            updateServerDropdownPings();
          }
          try { pws.close(); } catch (_) {}
        };
        pws.onerror = () => clearTimeout(killer);
      } catch (_) {}
    }
  }

  function isPlaySocket(url) {
    if (typeof url !== 'string') return false;
    if (url.includes('/ptc') || url.includes('/team_v2')) return false;
    return url.includes('/play') || url.includes('gameId=');
  }

  function onGameSocket(ws, url, isReplaySock) {
    addDebugLog(`Game socket established: ${url}${isReplaySock ? ' [REPLAY]' : ''}`);
    net.gameWs = ws;
    net.gameUrl = url;
    net.lastKills = 0;
    setVanillaReplaysModal(false);

    let rec = null;
    if (!isReplaySock && S.replay.autoRecord) {
      let hostLabel = 'survev.io';
      try {
        hostLabel = new URL(url, location.href).host;
      } catch (_) {}
      rec = {
        id: 'rec_' + Date.now(),
        name: '',
        favorite: false,
        host: hostLabel,
        createdAt: Date.now(),
        startPerf: performance.now(),
        durationMs: 0,
        markers: [],
        meta: { kills: 0, placement: '', weapons: [] },
        packets: [],
      };
      replay.recording = rec;

      ws.addEventListener('message', (ev) => {
        if (!rec || !S.replay.autoRecord) return;
        const t = Math.max(0, Math.round(performance.now() - rec.startPerf));
        if (ev.data instanceof Blob) {
          const entry = { t, d: new Uint8Array(0) };
          rec.packets.push(entry);
          rec.durationMs = t;
          ev.data.arrayBuffer().then((buf) => {
            entry.d = new Uint8Array(buf);
          }).catch(() => {});
        } else {
          // Keep a view of the socket buffer during recording. IndexedDB still
          // clones it when the replay is saved, but this avoids cloning every
          // packet on the game's hot message path.
          const bytes = normalizePacketBytes(ev.data);
          if (!bytes.length) return;
          rec.packets.push({ t, d: bytes });
          rec.durationMs = t;
        }
      });
    }

    ws.addEventListener('open', () => {
      if (net.gameWs !== ws) return;
      if (rec) rec.startPerf = performance.now();
      net.matchStart = performance.now();
      net.lastKills = 0;
      if (!isReplaySock) startPing();
      applyVisuals();
      refreshReplayUI();
    });

    ws.addEventListener('close', () => {
      if (rec && rec.packets.length >= 10 && rec.durationMs >= 1000) {
        const savedObj = {
          id: rec.id,
          name: '',
          favorite: false,
          host: rec.host,
          createdAt: rec.createdAt,
          durationMs: rec.durationMs,
          markers: rec.markers,
          meta: rec.meta,
          packets: rec.packets,
        };
        saveReplayToDB(savedObj);
        addDebugLog(`Saved match replay (${fmtShortDuration(savedObj.durationMs)}, ${savedObj.packets.length} packets)`);
      }
      if (replay.recording === rec) replay.recording = null;

      if (net.gameWs !== ws) return;
      net.gameWs = null;
      net.gameUrl = null;
      net.matchStart = 0;
      net.lastKills = 0;
      if (isReplaySock) {
        replay.active = false;
        replay.activeSocket = null;
        setCinemaMode(false);
        updateReplayHud();
      }
      startPing();
      applyVisuals();
      refreshReplayUI();
    });
  }

  window.WebSocket = new Proxy(NativeWS, {
    construct(target, args) {
      const url = String(args[0] || '');
      if (isPlaySocket(url) && isReplayArmed()) {
        const rec = replay.activeData;
        if (rec && rec.packets && rec.packets.length) {
          addDebugLog(`WebSocket intercepted for Replay (${url})`);
          const fakeWs = new FakeReplayWebSocket(url, rec);
          onGameSocket(fakeWs, url, true);
          return fakeWs;
        }
      }
      const ws = Reflect.construct(target, args);
      try {
        if (isPlaySocket(url)) {
          onGameSocket(ws, url, false);
        }
      } catch (_) {}
      return ws;
    },
  });

  /* =====================================================================
   *  YouTube Music Engine (Light DOM Bridge)
   * ===================================================================== */
  const music = {
    player: null,
    apiLoading: false,
    pendingPlay: false,
    loadedTrackId: null,
    ready: false,
    playing: false,
    duration: 0,
    currentTime: 0,
    playlistModalOpen: false,
    lastSyncAt: 0,
    uiCache: Object.create(null),
    searchToken: 0,
    ignoreEndedUntil: 0,
  };

  const MUSIC_SEARCH_APIS = [
    { base: 'https://yt-api.faizankhichi.me/', type: 'youtube-search' },
    { base: 'https://pipedapi.kavin.rocks', type: 'piped' },
  ];

  function extractYTId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  }

  function getActivePlaylist() {
    if (!S.music.playlists || !S.music.playlists.length) {
      S.music.playlists = clone(DEFAULTS.music.playlists);
    }
    let pl = S.music.playlists.find((p) => p.id === S.music.activePlaylistId);
    if (!pl) {
      pl = S.music.playlists[0];
      S.music.activePlaylistId = pl.id;
    }
    return pl;
  }

  function getCurrentTrack() {
    const pl = getActivePlaylist();
    if (!pl.tracks.length) return null;
    const idx = clamp(S.music.currentTrackIndex || 0, 0, pl.tracks.length - 1);
    return pl.tracks[idx];
  }

  function setupLightDomBridge() {
    let bridge = document.getElementById('pl-yt-light-bridge');
    if (!bridge) {
      bridge = document.createElement('div');
      bridge.id = 'pl-yt-light-bridge';
      bridge.style.cssText = `
        position: fixed;
        left: -9999px;
        top: 20px;
        width: 240px;
        height: 140px;
        z-index: 2147483647;
        border-radius: 12px;
        overflow: hidden;
        pointer-events: auto;
        box-shadow: 0 0 25px rgba(0,0,0,0.85);
        border: 2px solid var(--accent, #ff4fa3);
        opacity: 0;
        transform: translateY(14px);
        transition: transform 0.22s ease, opacity 0.22s ease, left 0s linear 0.22s, top 0s linear 0.22s;
      `;
      const target = document.createElement('div');
      target.id = 'pl-yt-iframe-target';
      target.style.cssText = 'width:100%;height:100%;pointer-events:none;';
      bridge.appendChild(target);
      const dragShield = document.createElement('div');
      dragShield.id = 'pl-yt-drag-shield';
      dragShield.title = 'Drag video window';
      dragShield.style.cssText = 'position:absolute;inset:0;z-index:2;cursor:move;background:transparent;pointer-events:auto;';
      dragShield.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const pos = S.pos.musicVideo || (S.pos.musicVideo = { x: 20, y: 20 });
        const originX = Number(pos.x) || 20;
        const originY = Number(pos.y) || 20;
        dragShield.setPointerCapture?.(event.pointerId);
        const move = (moveEvent) => {
          pos.x = clamp(originX + moveEvent.clientX - startX, 0, Math.max(0, window.innerWidth - bridge.offsetWidth));
          pos.y = clamp(originY + moveEvent.clientY - startY, 0, Math.max(0, window.innerHeight - bridge.offsetHeight));
          bridge.style.left = `${pos.x}px`;
          bridge.style.top = `${pos.y}px`;
        };
        const end = () => {
          dragShield.removeEventListener('pointermove', move);
          dragShield.removeEventListener('pointerup', end);
          dragShield.removeEventListener('pointercancel', end);
          save();
        };
        dragShield.addEventListener('pointermove', move);
        dragShield.addEventListener('pointerup', end);
        dragShield.addEventListener('pointercancel', end);
      });
      bridge.appendChild(dragShield);
      (document.body || document.documentElement).appendChild(bridge);
    }
    return bridge;
  }

  function loadYouTubeIframeAPI() {
    if (!getCurrentTrack() || music.player || music.apiLoading) return;
    music.apiLoading = true;
    setupLightDomBridge();
    if (window.YT && window.YT.Player) {
      music.apiLoading = false;
      initYTPlayer();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      music.apiLoading = false;
      initYTPlayer();
    };
  }

  function initYTPlayer() {
    if (music.player || !window.YT || !window.YT.Player) {
      music.apiLoading = false;
      return;
    }
    const track = getCurrentTrack();
    if (!track) {
      music.apiLoading = false;
      return;
    }
    const initialId = track.id;
    music.loadedTrackId = initialId;

    try {
      music.player = new window.YT.Player('pl-yt-iframe-target', {
        height: '140',
        width: '240',
        videoId: initialId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          origin: location.origin,
        },
        events: {
          onReady: (e) => {
            music.apiLoading = false;
            music.ready = true;
            addDebugLog('YouTube Player Ready & Attached to Light DOM');
            e.target.setVolume(S.music.volume);
            if (typeof e.target.setPlaybackQuality === 'function') e.target.setPlaybackQuality('small');
            if (music.pendingPlay) {
              music.pendingPlay = false;
              const current = getCurrentTrack();
              if (current) {
                music.loadedTrackId = current.id;
                e.target.loadVideoById(current.id);
                e.target.playVideo();
              }
            }
            updateMusicUI();
          },
          onStateChange: (e) => {
            music.playing = e.data === 1;
            if (e.data === 0) {
              if (performance.now() < music.ignoreEndedUntil) {
                updateMusicUI();
                return;
              }
              if (S.music.loop) {
                music.player.seekTo(0);
                music.player.playVideo();
              } else if (S.music.autoNext) {
                nextTrack();
              }
            }
            updateMusicUI();
          },
          onError: (e) => {
            addDebugLog(`YouTube playback error: ${e.data}`, 'warn');
          },
        },
      });
    } catch (err) {
      music.apiLoading = false;
      addDebugLog(`YT Player init error: ${err.message}`, 'error');
    }
  }

  function playTrackByIndex(idx) {
    const pl = getActivePlaylist();
    if (!pl.tracks.length) {
      stopMusicPlayback();
      return;
    }
    S.music.currentTrackIndex = clamp(idx, 0, pl.tracks.length - 1);
    save();
    const track = getCurrentTrack();
    if (!track) return;
    music.ignoreEndedUntil = 0;
    music.loadedTrackId = track.id;

    if (music.player && music.ready) {
      music.player.loadVideoById(track.id);
      music.player.playVideo();
    } else {
      music.pendingPlay = true;
      loadYouTubeIframeAPI();
    }
    updateMusicUI();
    if (music.playlistModalOpen) renderPlaylistModal();
  }

  function nextTrack() {
    const pl = getActivePlaylist();
    if (!pl.tracks.length) return;
    const nextIdx = (S.music.currentTrackIndex + 1) % pl.tracks.length;
    playTrackByIndex(nextIdx);
  }

  function prevTrack() {
    const pl = getActivePlaylist();
    if (!pl.tracks.length) return;
    const prevIdx = (S.music.currentTrackIndex - 1 + pl.tracks.length) % pl.tracks.length;
    playTrackByIndex(prevIdx);
  }

  function togglePlayPause() {
    const track = getCurrentTrack();
    if (!track) {
      toast('Your playlist is empty! Add a song first.');
      return;
    }
    if (!music.player || !music.ready) {
      music.pendingPlay = true;
      loadYouTubeIframeAPI();
      toast('Connecting to YouTube…');
      return;
    }
    if (music.playing) {
      music.player.pauseVideo();
    } else {
      if (music.loadedTrackId !== track.id) {
        music.loadedTrackId = track.id;
        music.player.loadVideoById(track.id);
      }
      music.player.playVideo();
    }
  }

  function stopMusicPlayback() {
    music.ignoreEndedUntil = performance.now() + 1000;
    music.pendingPlay = false;
    music.loadedTrackId = null;
    if (music.player && music.ready) {
      try { music.player.stopVideo(); } catch (_) {}
    }
    music.playing = false;
    music.currentTime = 0;
    music.duration = 0;
    music.lastSyncAt = 0;
    updateMusicUI();
  }

  function addTrackToActivePlaylist(urlOrId, playImmediately = false, metadata = null) {
    const id = extractYTId(urlOrId);
    if (!id) {
      toast('Invalid YouTube URL or Video ID');
      return;
    }
    const pl = getActivePlaylist();
    const newTrack = {
      id,
      title: metadata?.title || 'Loading info…',
      author: metadata?.author || 'YouTube',
    };
    pl.tracks.push(newTrack);
    const newIndex = pl.tracks.length - 1;
    save();
    toast('Track added to playlist!');

    if (!metadata) {
      fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.title) {
            newTrack.title = data.title;
            newTrack.author = data.author_name || 'YouTube';
            save();
            if (music.playlistModalOpen) renderPlaylistModal();
            updateMusicUI();
          }
        })
        .catch(() => {});
    }

    if (playImmediately) {
      playTrackByIndex(newIndex);
    }
    if (music.playlistModalOpen) renderPlaylistModal();
    updateMusicUI();
  }

  function addTrackToPlaylist(playlistId, result, playImmediately = false) {
    if (playlistId === S.music.activePlaylistId) {
      addTrackToActivePlaylist(result.id, playImmediately, result);
      return;
    }
    const playlist = S.music.playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    playlist.tracks.push({ id: result.id, title: result.title || 'Untitled video', author: result.author || 'YouTube' });
    save();
    if (music.playlistModalOpen) renderPlaylistModal();
    toast(`Added to "${playlist.name}"`);
  }

  function searchText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(searchText).filter(Boolean).join('');
    if (value && typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.simpleText === 'string') return value.simpleText;
      if (Array.isArray(value.runs)) return value.runs.map(searchText).join('');
      if (typeof value.name === 'string') return value.name;
      if (typeof value.title === 'string') return value.title;
      if (value.title && typeof value.title === 'object') return searchText(value.title);
    }
    return '';
  }

  function searchThumbnail(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return searchThumbnail(value[0]);
    if (value && typeof value === 'object') {
      return value.url || value.src || value.thumbnails?.[0]?.url || '';
    }
    return '';
  }

  function searchMusicResultId(item) {
    if (item && (item.videoId || item.id)) return String(item.videoId || item.id);
    const raw = String(item?.url || item?.link || '');
    return raw.match(/[?&]v=([\w-]{11})/)?.[1] || raw.match(/\/watch(?:\?v=|\/)([\w-]{11})/)?.[1] || raw.match(/\/([\w-]{11})(?:\?|$)/)?.[1] || null;
  }

  function formatSearchDuration(seconds) {
    if (typeof seconds === 'string' && seconds.includes(':')) return seconds;
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return '';
    return fmtTime(n);
  }

  function refreshMusicSearchPlaylists() {
    if (!ui.musicSearchPlaylist) return;
    const selected = ui.musicSearchPlaylist.value || S.music.activePlaylistId;
    ui.musicSearchPlaylist.textContent = '';
    for (const playlist of S.music.playlists || []) {
      ui.musicSearchPlaylist.append(h('option', { value: playlist.id }, playlist.name));
    }
    ui.musicSearchPlaylist.value = (S.music.playlists || []).some((playlist) => playlist.id === selected)
      ? selected
      : S.music.activePlaylistId;
  }

  function renderMusicSearchResults(results) {
    if (!ui.musicSearchResults) return;
    ui.musicSearchResults.textContent = '';
    for (const result of results) {
      const thumb = h('img', {
        src: result.thumbnail || `https://img.youtube.com/vi/${result.id}/mqdefault.jpg`,
        alt: '',
        loading: 'lazy',
        style: 'width:72px;height:42px;object-fit:cover;border-radius:5px;background:#181814;flex:0 0 auto;',
      });
      thumb.addEventListener('error', () => { thumb.style.visibility = 'hidden'; });
      const duration = result.duration ? ` · ${formatSearchDuration(result.duration)}` : '';
      const info = h(
        'div',
        { style: 'min-width:0;flex:1;cursor:pointer;' },
        h('div', { style: 'font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' }, result.title),
        h('div', { style: 'font-size:10px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' }, `${result.author || 'YouTube'}${duration}`)
      );
      const addBtn = h('button', { class: 'btn', style: 'padding:5px 8px;font-size:11px;' }, '＋ Add');
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackToPlaylist(ui.musicSearchPlaylist?.value || S.music.activePlaylistId, result, false);
      });
      const playBtn = h('button', { class: 'btn', style: 'padding:5px 8px;font-size:11px;' }, '▶');
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackToActivePlaylist(result.id, true, result);
      });
      info.addEventListener('click', () => addTrackToActivePlaylist(result.id, true, result));
      ui.musicSearchResults.append(h('div', { style: 'display:flex;align-items:center;gap:7px;padding:6px 7px;margin-top:4px;border-radius:6px;background:rgba(0,0,0,.25);' }, thumb, info, playBtn, addBtn));
    }
  }

  async function searchMusic(query) {
    const q = String(query || '').trim();
    if (!ui.musicSearchResults || !ui.musicSearchStatus) return;
    if (q.length < 2) {
      ui.musicSearchStatus.textContent = 'Type at least two characters to search.';
      ui.musicSearchResults.textContent = '';
      return;
    }

    const token = ++music.searchToken;
    ui.musicSearchStatus.textContent = 'Searching YouTube…';
    ui.musicSearchResults.textContent = '';
    let items = null;
    for (const source of MUSIC_SEARCH_APIS) {
      try {
        const url = source.type === 'youtube-search'
          ? `${source.base}?q=${encodeURIComponent(q)}&type=video`
          : `${source.base}/search?q=${encodeURIComponent(q)}&filter=videos&page=1`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Search returned ${response.status}`);
        const data = await response.json();
        items = Array.isArray(data) ? data : data.items || data.results || [];
        if (items.length) break;
      } catch (_) {}
    }
    if (token !== music.searchToken) return;

    const results = (items || [])
      .map((item) => {
        const id = searchMusicResultId(item);
        if (!id) return null;
        return {
          id,
          title: searchText(item.title) || 'Untitled video',
          author: searchText(item.uploaderName || item.uploader || item.author || item.channel) || 'YouTube',
          thumbnail: searchThumbnail(item.thumbnail || item.thumbnailUrl || item.videoThumbnails || item.thumbnails),
          duration: searchText(item.duration || item.lengthSeconds || item.length) || item.duration || item.lengthSeconds || item.length || 0,
        };
      })
      .filter(Boolean)
      .slice(0, 10);

    if (!results.length) {
      ui.musicSearchStatus.textContent = 'No results or search service unavailable. Try another search.';
      return;
    }
    ui.musicSearchStatus.textContent = `${results.length} result${results.length === 1 ? '' : 's'} · click a title to play`;
    renderMusicSearchResults(results);
  }

  function updateMusicUI() {
    const now = performance.now();
    const shouldSync = music.playing || (menuOpen && activeTab === 'music') || S.hud.musicHud || S.music.showVideo;
    if (music.player && music.ready && shouldSync && now - music.lastSyncAt >= 450) {
      try {
        music.currentTime = music.player.getCurrentTime() || 0;
        music.duration = music.player.getDuration() || 0;
        music.lastSyncAt = now;
      } catch (_) {}
    }
    const cache = music.uiCache;
    const track = getCurrentTrack();
    const thumbUrl = track && track.id ? `https://img.youtube.com/vi/${track.id}/mqdefault.jpg` : '';
    const titleStr = track ? track.title : 'No Track Selected';
    const authorStr = track ? track.author : 'Add a song below';
    const timeStr = `${fmtTime(music.currentTime)} / ${fmtTime(music.duration)}`;

    if (ui.tabMThumb && cache.tabThumb !== thumbUrl) {
      ui.tabMThumb.src = thumbUrl;
      ui.tabMThumb.style.display = thumbUrl ? 'block' : 'none';
      cache.tabThumb = thumbUrl;
    }
    if (ui.tabMTitle && cache.tabTitle !== titleStr) { ui.tabMTitle.textContent = titleStr; cache.tabTitle = titleStr; }
    if (ui.tabMAuthor && cache.tabAuthor !== authorStr) { ui.tabMAuthor.textContent = authorStr; cache.tabAuthor = authorStr; }
    const playLabel = music.playing ? '⏸ Pause' : '▶ Play';
    if (ui.tabMPlayBtn && cache.tabPlay !== playLabel) { ui.tabMPlayBtn.textContent = playLabel; cache.tabPlay = playLabel; }
    if (ui.tabMTime && cache.tabTime !== timeStr) { ui.tabMTime.textContent = timeStr; cache.tabTime = timeStr; }
    if (ui.tabMSeek && music.duration > 0 && !ui.mSeekDragging) {
      const max = Math.floor(music.duration);
      const value = Math.floor(music.currentTime);
      if (cache.seekMax !== max) { ui.tabMSeek.max = max; cache.seekMax = max; }
      if (cache.seekValue !== value) { ui.tabMSeek.value = value; cache.seekValue = value; }
    }
    if (ui.tabMLoopBtn) {
      const loop = !!S.music.loop;
      if (cache.loop !== loop) { ui.tabMLoopBtn.classList.toggle('active', loop); cache.loop = loop; }
    }

    if (ui.hudMThumb && cache.hudThumb !== thumbUrl) {
      ui.hudMThumb.src = thumbUrl;
      ui.hudMThumb.style.display = thumbUrl ? 'block' : 'none';
      cache.hudThumb = thumbUrl;
    }
    if (ui.hudMTitle && cache.hudTitle !== titleStr) { ui.hudMTitle.textContent = titleStr; cache.hudTitle = titleStr; }
    if (ui.hudMTime && cache.hudTime !== timeStr) { ui.hudMTime.textContent = timeStr; cache.hudTime = timeStr; }
    const hudLabel = music.playing ? '⏸' : '▶';
    if (ui.hudMBtn && cache.hudPlay !== hudLabel) { ui.hudMBtn.textContent = hudLabel; cache.hudPlay = hudLabel; }

    const bridge = document.getElementById('pl-yt-light-bridge');
    if (bridge) {
      const show = !!S.music.showVideo;
      if (cache.bridgeShow !== show) {
        bridge.style.transitionDelay = show ? '0s, 0s, 0s' : '0s, 0s, 0.22s';
        const pos = S.pos.musicVideo || (S.pos.musicVideo = { x: 20, y: 20 });
        bridge.style.left = show ? `${Number(pos.x) || 20}px` : '-9999px';
        bridge.style.top = show ? `${Number(pos.y) || 20}px` : '20px';
        bridge.style.opacity = show ? '1' : '0';
        bridge.style.transform = show ? 'none' : 'translateY(14px)';
        cache.bridgeShow = show;
      }
    }
  }

  function setPlaylistModal(open) {
    music.playlistModalOpen = open;
    ui.playlistModal.classList.toggle('open', open);
    if (open) {
      refreshMusicSearchPlaylists();
      renderPlaylistModal();
      placePanel(ui.playlistModal, 'playlistModal');
    }
  }

  /* =====================================================================
   *  Procedural Audio Visualizer Engine
   * ===================================================================== */
  // YouTube's iframe is cross-origin, so its audio can't be analysed: the motion is simulated.
  const VIZ_BARS = 48;
  const viz = { level: new Float32Array(VIZ_BARS), peak: new Float32Array(VIZ_BARS), energy: 0, last: 0 };

  function renderVisualizer(canvas) {
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const now = performance.now();
    const dt = Math.min(0.05, (now - (viz.last || now)) / 1000);
    viz.last = now;
    const t = now / 1000;
    viz.energy += ((music.playing ? 1 : 0) - viz.energy) * (1 - Math.exp(-dt * 4));
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8);
    const vol = 0.45 + 0.55 * (S.music.volume / 100);

    const modern = S.ui.variant === 'modern';
    const accent = modern ? S.accent : '#67a646';
    const gap = 3;
    const bw = (w - gap * (VIZ_BARS - 1)) / VIZ_BARS;
    const mid = (VIZ_BARS - 1) / 2;

    let fill = accent;
    if (modern) {
      fill = ctx.createLinearGradient(0, 0, 0, hgt);
      fill.addColorStop(0, '#ffffff');
      fill.addColorStop(0.38, accent);
      fill.addColorStop(0.62, accent);
      fill.addColorStop(1, '#ffffff');
    }

    for (let i = 0; i < VIZ_BARS; i++) {
      const d = Math.abs(i - mid) / mid; // 0 in the centre, 1 at the edges
      const wave =
        0.5 + 0.24 * Math.sin(t * 5.1 + d * 9) + 0.17 * Math.sin(t * 8.3 - d * 17 + i * 0.35) + 0.09 * Math.sin(t * 13.7 + i * 1.9);
      const live = Math.max(0, wave * (1 - d * 0.62) + beat * 0.3 * (1 - d)) * vol;
      const idle = 0.045 + 0.035 * Math.sin(t * 1.6 - d * 5);
      const target = Math.min(1, idle + (live - idle) * viz.energy);
      const speed = target > viz.level[i] ? 18 : 7; // fast attack, soft release
      viz.level[i] += (target - viz.level[i]) * (1 - Math.exp(-dt * speed));
      viz.peak[i] = Math.max(viz.level[i], viz.peak[i] - dt * 0.5);

      const x = i * (bw + gap);
      ctx.globalAlpha = 0.45 + 0.55 * Math.max(viz.energy, 0.2) * (1 - d * 0.35);
      ctx.fillStyle = fill;
      ctx.beginPath();
      if (modern) {
        const bh = Math.max(bw, viz.level[i] * (hgt - 4));
        ctx.roundRect(x, (hgt - bh) / 2, bw, bh, bw / 2);
        ctx.fill();
      } else {
        const bh = Math.max(3, viz.level[i] * (hgt - 7));
        ctx.roundRect(x, hgt - bh, bw, bh, 2);
        ctx.fill();
        ctx.fillStyle = '#2f541e';
        ctx.fillRect(x, hgt - 2, bw, 2);
        ctx.fillStyle = '#9bd36d';
        ctx.globalAlpha *= viz.energy;
        ctx.fillRect(x, hgt - Math.max(3, viz.peak[i] * (hgt - 7)) - 4, bw, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
   *  Custom Crosshairs (10 Styles)
   * ===================================================================== */
  function crosshairSVG(c) {
    const t = Number(c.thickness) || 2;
    const g = Number(c.gap) || 0;
    const half = (Number(c.size) || 24) / 2;
    const innerEnabled = c.innerEnabled !== false;
    const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const innerLength = Math.max(0, finiteOr(c.innerLength, Math.max(0, half - g)));
    const innerVerticalLength = Math.max(0, finiteOr(c.innerVerticalLength, innerLength));
    const innerThickness = Math.max(1, finiteOr(c.innerThickness, t));
    const innerOffset = Math.max(0, Number.isFinite(Number(c.innerOffset)) ? Number(c.innerOffset) : g);
    const outerEnabled = c.outerEnabled === true;
    const outerLength = Math.max(0, finiteOr(c.outerLength, innerLength));
    const outerVerticalLength = Math.max(0, finiteOr(c.outerVerticalLength, outerLength));
    const outerThickness = Math.max(1, finiteOr(c.outerThickness, t));
    const outerOffset = Math.max(0, Number.isFinite(Number(c.outerOffset)) ? Number(c.outerOffset) : innerOffset + innerLength);
    const maxReach = Math.max(half, innerOffset + innerLength, innerOffset + innerVerticalLength, outerOffset + outerLength, outerOffset + outerVerticalLength);
    const box = Math.ceil((maxReach * 2 + t + 16) / 2) * 2;
    const m = box / 2;
    const dotR = Math.max(1, (c.dotSize || t) * 0.75);
    const outlineW = Math.max(0, Math.min(8, finiteOr(c.outlineWidth, 2.5)));

    const renderElements = (color, strokeW, overallOpacity = 1) => {
      let out = `<g fill="${color}" stroke="${color}" stroke-width="${strokeW}" opacity="${overallOpacity}">`;
      const lineSet = (enabled, offset, length, verticalLength, thickness, opacity, skipTop = false) => {
        if (!enabled) return '';
        const parsedOpacity = Number(opacity);
        const alpha = Number.isFinite(parsedOpacity) ? Math.max(0, Math.min(1, parsedOpacity)) : 1;
        let lines = `<g opacity="${alpha}">`;
        lines += `<rect x="${m - offset - length}" y="${m - thickness / 2}" width="${length}" height="${thickness}"/>`;
        lines += `<rect x="${m + offset}" y="${m - thickness / 2}" width="${length}" height="${thickness}"/>`;
        if (!skipTop) lines += `<rect x="${m - thickness / 2}" y="${m - offset - verticalLength}" width="${thickness}" height="${verticalLength}"/>`;
        lines += `<rect x="${m - thickness / 2}" y="${m + offset}" width="${thickness}" height="${verticalLength}"/>`;
        return lines + '</g>';
      };

      switch (c.style) {
        case 'cross':
          out += lineSet(innerEnabled, innerOffset, innerLength, innerVerticalLength, innerThickness, c.innerOpacity);
          out += lineSet(outerEnabled, outerOffset, outerLength, outerVerticalLength, outerThickness, c.outerOpacity);
          break;
        case 'cross-dot':
          out += lineSet(innerEnabled, innerOffset, innerLength, innerVerticalLength, innerThickness, c.innerOpacity);
          out += lineSet(outerEnabled, outerOffset, outerLength, outerVerticalLength, outerThickness, c.outerOpacity);
          out += `<circle cx="${m}" cy="${m}" r="${dotR}" fill="${color}" stroke="none" opacity="${c.dotOpacity ?? 1}"/>`;
          break;
        case 't-cross':
          out += lineSet(innerEnabled, innerOffset, innerLength, innerVerticalLength, innerThickness, c.innerOpacity, true);
          out += lineSet(outerEnabled, outerOffset, outerLength, outerVerticalLength, outerThickness, c.outerOpacity, true);
          break;
        case 'circle':
          out += `<circle cx="${m}" cy="${m}" r="${Math.max(1, half - t / 2)}" fill="none" stroke-width="${t + strokeW}"/>`;
          break;
        case 'circle-dot':
          out += `<circle cx="${m}" cy="${m}" r="${Math.max(1, half - t / 2)}" fill="none" stroke-width="${t + strokeW}"/>`;
          out += `<circle cx="${m}" cy="${m}" r="${dotR}" fill="${color}" stroke="none" opacity="${c.dotOpacity ?? 1}"/>`;
          break;
        case 'box':
          out += `<rect x="${m - half}" y="${m - half}" width="${half * 2}" height="${half * 2}" fill="none" stroke-width="${t + strokeW}"/>`;
          break;
        case 'box-dot':
          out += `<rect x="${m - half}" y="${m - half}" width="${half * 2}" height="${half * 2}" fill="none" stroke-width="${t + strokeW}"/>`;
          out += `<circle cx="${m}" cy="${m}" r="${dotR}" fill="${color}" stroke="none" opacity="${c.dotOpacity ?? 1}"/>`;
          break;
        case 'chevron':
          out += `<path d="M ${m - half} ${m + half / 2} L ${m} ${m - half / 2} L ${m + half} ${m + half / 2}" fill="none" stroke-width="${t + strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`;
          break;
        case 'plus':
          out += `<rect x="${m - half * 0.7}" y="${m - t / 2}" width="${half * 1.4}" height="${t}"/>`;
          out += `<rect x="${m - t / 2}" y="${m - half * 0.7}" width="${t}" height="${half * 1.4}"/>`;
          break;
        case 'dot':
        default:
          out += `<circle cx="${m}" cy="${m}" r="${Math.max(1.5, t * 1.25)}" fill="${color}" stroke="none" opacity="${c.dotOpacity ?? 1}"/>`;
          break;
      }

      if (c.dot && c.style !== 'circle-dot' && c.style !== 'cross-dot' && c.style !== 'box-dot' && c.style !== 'dot') {
        out += `<circle cx="${m}" cy="${m}" r="${dotR}" fill="${color}" stroke="none" opacity="${c.dotOpacity ?? 1}"/>`;
      }
      return out + '</g>';
    };

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
      (c.outline ? renderElements(c.outlineColor || '#000000', outlineW, c.outlineOpacity ?? 1) : '') +
      renderElements(c.color, 0) +
      '</svg>'
    );
  }

  const crosshairURI = (c) => 'data:image/svg+xml,' + encodeURIComponent(crosshairSVG(c));
  function cursorCss(c) {
    const reach = Math.max(
      (Number(c.size) || 24) / 2,
      (Number(c.innerOffset) || 0) + (Number(c.innerLength) || 0),
      (Number(c.innerOffset) || 0) + (Number(c.innerVerticalLength) || 0),
      c.outerEnabled ? (Number(c.outerOffset) || 0) + (Number(c.outerLength) || 0) : 0,
      c.outerEnabled ? (Number(c.outerOffset) || 0) + (Number(c.outerVerticalLength) || 0) : 0
    );
    const box = Math.ceil((reach * 2 + (Number(c.thickness) || 2) + 16) / 2) * 2;
    const center = box / 2;
    return `url("${crosshairURI(c)}") ${center} ${center}, crosshair`;
  }

  function sanitizeCrosshair(raw) {
    const allowedStyles = new Set(['cross', 't-cross', 'circle', 'circle-dot', 'dot', 'cross-dot', 'box', 'box-dot', 'chevron', 'plus']);
    const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
    const n = (value, fallback, min, max) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
    };
    return {
      style: allowedStyles.has(raw?.style) ? raw.style : 'cross',
      color: hex(raw?.color, '#ffffff'),
      outlineColor: hex(raw?.outlineColor, '#000000'),
      size: Math.round(n(raw?.size, 24, 8, 56) / 2) * 2,
      thickness: Math.round(n(raw?.thickness, 2, 1, 10)),
      gap: Math.round(n(raw?.gap, 5, 0, 20)),
      innerEnabled: raw?.innerEnabled !== false,
      innerLength: n(raw?.innerLength, 7, 0, 40),
      innerVerticalLength: n(raw?.innerVerticalLength, n(raw?.innerLength, 7, 0, 40), 0, 40),
      innerThickness: n(raw?.innerThickness, 2, 1, 10),
      innerOffset: n(raw?.innerOffset, n(raw?.gap, 5, 0, 20), 0, 30),
      innerOpacity: n(raw?.innerOpacity, 1, 0, 1),
      outerEnabled: raw?.outerEnabled === true,
      outerLength: n(raw?.outerLength, 7, 0, 40),
      outerVerticalLength: n(raw?.outerVerticalLength, n(raw?.outerLength, 7, 0, 40), 0, 40),
      outerThickness: n(raw?.outerThickness, 2, 1, 10),
      outerOffset: n(raw?.outerOffset, 12, 0, 40),
      outerOpacity: n(raw?.outerOpacity, 1, 0, 1),
      outlineWidth: n(raw?.outlineWidth, 2.5, 0, 8),
      outlineOpacity: n(raw?.outlineOpacity, 1, 0, 1),
      dot: !!raw?.dot,
      dotSize: Math.round(n(raw?.dotSize, 3, 1, 8)),
      dotOpacity: n(raw?.dotOpacity, 1, 0, 1),
      outline: raw?.outline !== false,
    };
  }

  function crosshairShareCode(c = S.crosshair) {
    const payload = sanitizeCrosshair(c);
    return 'DN1:' + btoa(JSON.stringify(payload));
  }

  function parseCrosshairCode(input) {
    const code = String(input || '').trim().replace(/^`|`$/g, '');
    if (!code) return null;

    if (/^DN1:/i.test(code)) {
      try {
        return sanitizeCrosshair(JSON.parse(atob(code.slice(4))));
      } catch (_) {
        return null;
      }
    }

    const tokens = code.split(';').map((part) => part.trim()).filter(Boolean);
    const primary = {};
    let insidePrimary = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === 'P') {
        insidePrimary = true;
        continue;
      }
      if (insidePrimary && /^[A-Z]$/.test(token)) break;
      if (insidePrimary && i + 1 < tokens.length) {
        primary[token] = tokens[++i];
      }
    }
    if (!Object.keys(primary).length) return null;

    const number = (key, fallback = 0) => {
      const value = Number(primary[key]);
      return Number.isFinite(value) ? value : fallback;
    };
    const colorMap = ['#ffffff', '#00ff00', '#7fff00', '#ffff00', '#ffff00', '#00ffff', '#ff00ff', '#ff0000'];
    let color = colorMap[Math.round(number('c', 0))] || '#ffffff';
    if (String(primary.c) === '8' && /^[0-9a-f]{6,8}$/i.test(String(primary.u || ''))) {
      color = '#' + String(primary.u).slice(0, 6);
    }

    const innerVisible = primary['0b'] == null || primary['0b'] !== '0';
    const hasOuterSettings = ['1t', '1l', '1v', '1g', '1o', '1a'].some((key) => primary[key] != null);
    const outerVisible = primary['1b'] != null ? primary['1b'] === '1' : hasOuterSettings;
    const hasLines = innerVisible || outerVisible;
    const innerLength = Math.max(number('0l', 0), 0);
    const innerOffset = Math.max(number('0o', 0), 0);
    const outerLength = Math.max(number('1l', 0), 0);
    const outerOffset = Math.max(number('1o', 0), 0);
    const gap = innerOffset;
    const style = hasLines ? (number('d', 0) ? 'cross-dot' : 'cross') : (number('d', 0) ? 'dot' : 'cross');

    return sanitizeCrosshair({
      style,
      color,
      outlineColor: '#000000',
      size: Math.max(8, (Math.max(innerOffset + innerLength, outerOffset + outerLength) + 4) * 2),
      thickness: Math.max(number('0t', 2), number('1t', 0), 1),
      gap,
      innerEnabled: innerVisible,
      innerLength,
      innerVerticalLength: Math.max(number('0v', innerLength), 0),
      innerThickness: number('0t', number('t', 2)),
      innerOffset,
      innerOpacity: number('0a', 1),
      outerEnabled: outerVisible,
      outerLength,
      outerVerticalLength: Math.max(number('1v', outerLength), 0),
      outerThickness: number('1t', number('0t', number('t', 2))),
      outerOffset,
      outerOpacity: number('1a', 1),
      outlineWidth: number('t', 2.5),
      outlineOpacity: number('o', 1),
      dot: number('d', 0) === 1,
      dotSize: number('z', 3),
      dotOpacity: number('a', 1),
      outline: primary.h == null ? number('o', 1) > 0 : number('h', 0) === 1,
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /* =====================================================================
   *  UI 2 (Modern): overrides layered on top of the Classic styles
   * ===================================================================== */
  const MODERN_CSS = `
.panel, .panel.replay-hud { background: rgba(12,10,18,0.78); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid var(--accent); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
:host(.glow) .panel { box-shadow: 0 8px 24px rgba(0,0,0,0.45), 0 0 18px color-mix(in srgb, var(--accent) 42%, transparent); }
.backdrop { background: radial-gradient(ellipse at center, rgba(24,10,34,0.55), rgba(5,3,10,0.8)); backdrop-filter: blur(4px); }
.win { grid-template-columns: 200px 1fr; color: #ecebf1; background: rgba(14,12,20,0.98); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; box-shadow: 0 30px 90px rgba(0,0,0,0.7), 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent); }
.side { padding: 20px 12px 14px; background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0)); border-right: 1px solid rgba(255,255,255,0.06); }
.logo { font-weight: 800; letter-spacing: 0.2em; padding: 0 10px 4px; text-shadow: none; background: linear-gradient(90deg, var(--accent), #fff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ver { color: rgba(255,255,255,0.35); padding: 0 10px 18px; }
.tab { position: relative; padding: 9px 14px; margin-bottom: 3px; border: 0; border-radius: 9px; font-size: 13.5px; font-weight: 400; letter-spacing: 0.06em; background: transparent; color: rgba(255,255,255,0.65); }
.tab:hover { background: rgba(255,255,255,0.05); color: #fff; }
.tab:active { transform: none; border: 0; }
.tab.active { background: color-mix(in srgb, var(--accent) 16%, transparent); color: #fff; font-weight: 700; }
.tab::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px; border-radius: 3px; background: var(--accent); scale: 1 0; transition: scale 0.25s cubic-bezier(0.3,1.5,0.5,1); }
.tab.active::before { scale: 1 1; }
.hint-foot { color: rgba(255,255,255,0.35); }
.hint-foot b { color: var(--accent); }
.head { padding: 18px 22px 10px; background: transparent; border: 0; }
.head h2 { font-size: 20px; text-shadow: none; }
.x { border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.55); }
.x:hover { background: rgba(255,255,255,0.08); }
.content { padding: 4px 22px 22px; }
.content::-webkit-scrollbar-thumb, .pl-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 8px; }
.section { font-size: 11px; letter-spacing: 0.18em; color: var(--accent); border: 0; padding: 0; margin: 16px 4px 8px; }
.row { padding: 10px 14px; border-radius: 11px; background: rgba(255,255,255,0.035); border: 1px solid transparent; }
.row:hover { background: rgba(255,255,255,0.06); border-color: color-mix(in srgb, var(--accent) 22%, transparent); }
.lbl .t { font-weight: 600; letter-spacing: 0.02em; }
.lbl .hint { color: rgba(255,255,255,0.42); }
.switch i { border: 0; border-radius: 11px; background: #2b2735; }
.switch i::after { top: 3px; left: 3px; border-radius: 50%; background: #8d8799; }
.switch input:checked + i { background: var(--accent); }
.switch input:checked + i::after { left: 21px; }
input[type=range], .replay-timeline { accent-color: var(--accent) !important; }
input[type=text], select { background: #221f2c; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; }
input[type=text]:focus, select:focus { border-color: var(--accent); }
input[type=color] { border: 0; border-radius: 7px; }
.btn { border: 0; border-radius: 8px; font-weight: 600; background: rgba(255,255,255,0.08); }
.btn:hover { background: color-mix(in srgb, var(--accent) 35%, transparent); filter: none; }
.btn:active { transform: none; border: 0; }
.btn.active { background: var(--accent) !important; box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 60%, transparent); }
.btn.danger:hover { background: rgba(255,80,80,0.35); }
.sw { border-radius: 50%; }
.sw:hover { scale: 1.15; }
.music-tab-card, .pl-visualizer { border-radius: 12px; background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.05); }
.debug-box { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.05); border-radius: 12px; }
.debug-head { border-color: rgba(255,255,255,0.06); }
.chip { border: 0; border-radius: 20px; background: rgba(255,255,255,0.09); }
.chip.on { background: color-mix(in srgb, var(--accent) 80%, transparent); }
.debug-term { background: #0c0a12; border-color: rgba(255,255,255,0.08); border-radius: 12px; }
.pl-modal { background: rgba(14,11,22,0.98); border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); border-radius: 16px; box-shadow: 0 25px 70px rgba(0,0,0,0.7), 0 0 35px color-mix(in srgb, var(--accent) 30%, transparent); }
.pl-head { background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); }
.pl-head h3 { color: var(--accent); }
.pl-item { border-radius: 8px; background: rgba(255,255,255,0.03); border-color: transparent; }
.pl-item.active, .pl-item.drag-over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.pl-item-title:hover { color: var(--accent); }
.pl-btn { border: 0; background: rgba(255,255,255,0.08); }
.replay-badge, .rh-btn.active, .rh-btn.play { background: var(--accent); border: 0; }
.replay-badge { border-radius: 5px; }
.rh-btn { border: 0; border-radius: 7px; background: rgba(255,255,255,0.1); }
.rh-btn:active { border: 0; }
.rh-btn.danger { background: rgba(255,80,80,0.45); }
.toast { background: rgba(14,12,20,0.94); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 10px; }
`;

  const MODERN_PAGE_CSS = `
.pl-vr-modal { background: rgba(14,12,20,0.98); border: 1px solid color-mix(in srgb, var(--pl-accent) 40%, transparent); border-radius: 16px; }
.pl-vr-head { background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.07); }
.pl-vr-head h3 { color: var(--pl-accent); text-shadow: none; }
.pl-vr-item { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.05); border-radius: 11px; }
.pl-vr-search, .pl-vr-sort { background: #221f2c; border-color: rgba(255,255,255,0.1); border-radius: 8px; }
.pl-vr-search:focus { border-color: var(--pl-accent); }
.pl-vr-btn { background: rgba(255,255,255,0.08); border: 0; border-radius: 8px; }
.pl-vr-btn.green, .pl-vr-btn.active { background: var(--pl-accent); }
.pl-vr-btn.fav-on { background: rgba(255,209,102,0.2); }
`;

  /* =====================================================================
   *  Page Global CSS & Vanilla Replays Modal (Light DOM)
   * ===================================================================== */
  const gstyle = document.createElement('style');
  gstyle.id = 'pinkline-global-style';
  (document.head || document.documentElement).appendChild(gstyle);
  let menuOpen = false;

  const STATIC_CSS = `
.pl-health-text {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%) translateY(var(--pl-hp-offset-y, 16px));
  height: 22px;
  line-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-family: 'Roboto Condensed', 'Segoe UI', Arial, sans-serif;
  font-size: var(--pl-bar-text-size, 18px);
  font-weight: 800;
  letter-spacing: 0.5px;
  z-index: 15;
  pointer-events: none;
  text-shadow: 0 1px 4px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.9);
  user-select: none;
}
.pl-boost-display {
  position: absolute;
  bottom: 25px;
  right: 335px;
  color: #FF901A;
  background-color: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 144, 26, 0.35);
  font-family: 'Roboto Condensed', Arial, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  z-index: 10;
  text-align: center;
  pointer-events: none;
  user-select: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.45);
}
#pl-low-hp-vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 99;
  box-shadow: inset 0 0 80px rgba(255, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.25s ease-in-out;
}
#pl-low-hp-vignette.active {
  opacity: 1;
  animation: pl-vignette-pulse 1.1s infinite alternate;
}
@keyframes pl-vignette-pulse {
  from { opacity: 0.35; }
  to { opacity: 0.8; }
}
/* Native Main Menu Replays Button */
#btn-help.pl-has-replays {
  margin-bottom: 8px !important;
}
#pl-lobby-replays-btn {
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-align: center;
  background-color: #506478;
  border-bottom: 2px solid #2f3b47;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  cursor: pointer;
}
#pl-lobby-replays-btn:hover {
  filter: brightness(1.08);
}

/* Vanilla survev.io-styled Replays Modal */
#pl-vanilla-replays-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Roboto Condensed', Arial, sans-serif;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0s linear 0.2s;
}
#pl-vanilla-replays-backdrop.open {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease;
}
#pl-vanilla-replays-backdrop .pl-vr-modal {
  transform: translateY(14px) scale(0.96);
  transition: transform 0.2s ease;
}
#pl-vanilla-replays-backdrop.open .pl-vr-modal {
  transform: none;
  transition: transform 0.3s cubic-bezier(0.2, 1.3, 0.4, 1);
}
.pl-vr-modal {
  width: min(640px, 94vw);
  max-height: 82vh;
  background: #272722;
  border: 2px solid #141411;
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
}
.pl-vr-head {
  background: #3d4034;
  border-bottom: 2px solid #1a1b15;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pl-vr-head h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  text-shadow: 0 2px 0 rgba(0,0,0,0.45);
}
.pl-vr-close {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 5px;
  color: #ddd;
  font-size: 16px;
  font-weight: 700;
  width: 30px;
  height: 30px;
  cursor: pointer;
}
.pl-vr-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
.pl-vr-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
}
.pl-vr-body::-webkit-scrollbar { width: 8px; }
.pl-vr-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
.pl-vr-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.pl-vr-search {
  flex: 1;
  min-width: 180px;
  background: #181814;
  color: #fff;
  border: 1px solid #44453a;
  border-radius: 5px;
  padding: 7px 10px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
}
.pl-vr-search:focus {
  border-color: #67a646;
}
.pl-vr-pills {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.pl-vr-btn {
  background: #3d3e35;
  color: #fff;
  border: 1px solid #1b1b17;
  border-bottom: 2px solid #181814;
  border-radius: 5px;
  padding: 6px 11px;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.pl-vr-btn:hover { filter: brightness(1.12); }
.pl-vr-btn.green {
  background: #538c38;
  border-bottom-color: #2f541e;
}
.pl-vr-btn.active {
  background: #538c38;
  border-bottom-color: #2f541e;
}
.pl-vr-btn.fav-on {
  background: #7c6423;
  color: #ffd166;
  border-bottom-color: #4a3b12;
}
.pl-vr-btn.danger:hover {
  background: #8a3434;
}
.pl-vr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  line-height: 1;
  white-space: nowrap;
}
.pl-vr-btn.pl-vr-star {
  width: 30px;
  padding: 0;
  font-size: 16px;
}
.pl-vr-item-btns { align-items: center; }
.pl-vr-sort { margin-left: auto; background: #181814; color: #fff; border: 1px solid #44453a; border-radius: 5px; height: 30px; padding: 0 8px; font-size: 13px; font-family: inherit; font-weight: 700; outline: none; }
.pl-vr-meta-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.pl-vr-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(0, 0, 0, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 9px 12px;
  margin-bottom: 7px;
}
.pl-vr-item-info { min-width: 0; flex: 1; }
.pl-vr-item-title {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-vr-item-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 2px;
}
.pl-vr-item-btns {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

html.pl-cinema-mode #ui-top-left,
html.pl-cinema-mode #ui-top-right,
html.pl-cinema-mode #ui-bottom-center-0,
html.pl-cinema-mode #ui-bottom-center-left,
html.pl-cinema-mode #ui-bottom-center-right,
html.pl-cinema-mode #ui-weapon-container,
html.pl-cinema-mode #ui-health-container,
html.pl-cinema-mode #ui-boost-counter,
html.pl-cinema-mode #ui-map-wrapper,
html.pl-cinema-mode #ui-killfeed-wrapper,
html.pl-cinema-mode #ui-kill-leader-container,
html.pl-cinema-mode #ui-leaderboard-wrapper,
html.pl-cinema-mode #ui-top-center-scopes-wrapper,
html.pl-cinema-mode #ui-bottom-center-1,
html.pl-cinema-mode #ui-emote-button,
html.pl-cinema-mode #ui-game,
html.pl-cinema-mode #ui-center,
html.pl-cinema-mode #ui-spectate-options-wrapper,
html.pl-cinema-mode #ui-spectate-options,
html.pl-cinema-mode .ui-stats-container {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.2s ease;
}
`;

  const CLEANUP_CSS = `
#social-share-block-wrapper, #social-share-block, .account-social,
#btn-social-discord, #btn-social-kofi, a[href*="discord"], a[href*="ko-fi"], a[href*="kofi"],
.social-share, .social-icon, .social-icons, .social-share-block,
#ad-block-left, .ad-block-header, .ad-block-left-center, .ad-block-right-center,
.ad-block-leaderboard-bottom, .ad-block-loadouts-left, .ad-block-med-rect,
.ui-stats-ad-container, #ui-stats-ad-container-desktop, #ui-stats-ad-container-mobile,
#survevio_728x90, #publift-widget-sticky_footer-styles, #publift-widget-sticky_footer,
#leaderboard-front, #adunit, ins.adsbygoogle, iframe[id^="google_ads"], iframe[src*="doubleclick"] {
  display: none !important;
}
`;

  function applyCss() {
    let css =
      STATIC_CSS +
      `:root { --pl-bar-text-size: ${S.hud.barTextSize}px; --pl-hp-offset-y: ${S.hud.hpOffsetY}px; --pl-accent: ${S.accent}; }\n`;
    if (S.ui.hideAds || S.ui.hideSocials) css += CLEANUP_CSS;
    if (S.ui.hideNews) css += '#news-wrapper { display: none !important; }\n';
    if (S.ui.hideKillfeed) css += '#ui-killfeed-wrapper { display: none !important; }\n';
    if (S.ui.hideKillLeader) css += '#ui-kill-leader-container { display: none !important; }\n';

    if (S.visuals.themeLobbyButtons) {
      css += `
#start-menu, #pass-block, #account-panel {
  background-color: rgba(16, 12, 24, 0.78) !important;
  backdrop-filter: blur(8px) !important;
  border: 1px solid color-mix(in srgb, var(--pl-accent) 45%, transparent) !important;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45) !important;
}
#btn-start-mode-0, #btn-start-mode-1, #btn-start-mode-2,
#btn-customize, #pl-lobby-replays-btn, #start-bottom-right .btn-darken, #start-top-right .btn-darken,
#btn-join-team, #btn-create-team {
  background-color: color-mix(in srgb, var(--pl-accent) 68%, #181422) !important;
  border: 1px solid color-mix(in srgb, var(--pl-accent) 85%, #ffffff) !important;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--pl-accent) 30%, transparent) !important;
}
#btn-start-mode-0:hover, #btn-start-mode-1:hover, #btn-start-mode-2:hover,
#btn-customize:hover, #pl-lobby-replays-btn:hover, #btn-join-team:hover, #btn-create-team:hover,
#start-bottom-right .btn-darken:hover, #start-top-right .btn-darken:hover {
  filter: brightness(1.12);
}
`;
    }
    if (S.visuals.hudGlow) {
      css += `
#ui-map-wrapper {
  box-shadow: 0 0 18px color-mix(in srgb, var(--pl-accent) 55%, transparent) !important;
  border-color: var(--pl-accent) !important;
}
`;
    }
    if (S.crosshair.enabled && !menuOpen && !vanillaModalOpen) {
      const gameCursor = cursorCss(S.crosshair);
      css += `#game-area-wrapper, #game-area-wrapper canvas, #game-area-wrapper * { cursor: ${gameCursor} !important; }\n`;
    }
    if (S.ui.variant === 'modern') css += MODERN_PAGE_CSS;
    gstyle.textContent = css;
  }
  applyCss();

  /* =====================================================================
   *  Shadow DOM Styles
   * ===================================================================== */
  const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: 'Roboto Condensed', 'Segoe UI', system-ui, -apple-system, sans-serif; }
[hidden] { display: none !important; }

.panel {
  position: fixed;
  z-index: 2;
  pointer-events: none;
  transform-origin: top left;
  transform: scale(var(--scale, 1));
  opacity: var(--opacity, 1);
  background: rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(0, 0, 0, 0.45);
  border-radius: 4px;
  padding: 7px 12px;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.03em;
  user-select: none;
}
:host(.glow) .panel {
  box-shadow: 0 8px 24px rgba(0,0,0,0.45), 0 0 18px color-mix(in srgb, var(--accent) 42%, transparent);
}
.panel.away { display: none; }
:host(.open) .panel { pointer-events: auto; cursor: move; outline: 1px dashed var(--accent); outline-offset: 2px; }
:host(.open) .panel.away { display: block; }
.stat { display: flex; justify-content: space-between; gap: 16px; line-height: 1.55; }
.k { color: rgba(255, 255, 255, 0.55); font-size: 11px; letter-spacing: 0.14em; align-self: center; }
.v { min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
.good { color: #7dffb0; } .ok { color: #ffd166; } .bad { color: #ff6b6b; }

.kgrid { display: grid; grid-template-columns: repeat(3, 36px); gap: 4px; }
.key { height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; transition: background 0.04s, color 0.04s, box-shadow 0.04s; }
.key.on { background: var(--accent); color: #fff; border-color: transparent; box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent); }
.key.w { grid-column: 2; } .key.a { grid-column: 1; grid-row: 2; } .key.s { grid-column: 2; grid-row: 2; } .key.d { grid-column: 3; grid-row: 2; }
.key.l { grid-column: 1 / 3; grid-row: 3; } .key.r { grid-column: 3; grid-row: 3; }
.cps { margin-top: 6px; text-align: center; font-size: 11px; letter-spacing: 0.14em; color: rgba(255, 255, 255, 0.6); }

/* Cinema Mode */
:host(.cinema) .stats,
:host(.cinema) .keys,
:host(.cinema) .spec-card,
:host(.cinema) .hud-music {
  opacity: 0 !important;
  pointer-events: none !important;
}
:host(.cinema) .replay-hud {
  opacity: 0;
  pointer-events: auto !important;
  transition: opacity 0.2s ease;
}
:host(.cinema) .replay-hud:hover {
  opacity: 1;
  pointer-events: auto !important;
}

/* In-Game Replay HUD (vanilla survev look) */
.btn.fav-on { color: #ffd166 !important; background: rgba(255, 209, 102, 0.18) !important; }
.panel.replay-hud {
  pointer-events: auto !important;
  width: 440px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: none;
  border: 2px solid rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  box-shadow: none;
  font-weight: 700;
}
.replay-hud-top { display: flex; align-items: center; justify-content: space-between; font-size: 13px; cursor: move; }
.replay-badge {
  background: #538c38; color: #fff; font-size: 11px; font-weight: 800;
  padding: 3px 8px; border-radius: 3px; letter-spacing: 0.08em;
  border-bottom: 2px solid #2f541e; text-transform: uppercase;
}
.replay-timeline-wrap { position: relative; width: 100%; padding-top: 4px; }
.replay-tip { position: absolute; top: -16px; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 11px; pointer-events: none; z-index: 4; white-space: nowrap; }
.replay-markers { position: relative; height: 10px; margin: 0 6px 2px; }
.replay-pin {
  all: unset; position: absolute; top: 0; width: 8px; height: 8px; border-radius: 50%;
  transform: translateX(-50%); cursor: pointer; background: #e0453a;
  border: 1px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.8); transition: transform 0.1s;
}
.replay-pin.bookmark { background: #ffd166; }
.replay-pin:hover { transform: translateX(-50%) scale(1.45); z-index: 3; }
.replay-timeline { width: 100% !important; height: 6px; margin: 0; accent-color: #67a646; cursor: pointer; }
.replay-row { display: flex; align-items: center; gap: 4px; }
.replay-row.spread { justify-content: space-between; }
.replay-speeds { display: flex; gap: 3px; }
.rh-btn {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px; height: 26px; padding: 0 9px;
  background: #7f7f7f; color: #fff;
  border-bottom: 2px solid #4a4a4a; border-radius: 3px;
  font-size: 12px; font-weight: 700; white-space: nowrap;
}
.rh-btn:hover { filter: brightness(1.12); }
.rh-btn:active { transform: translateY(1px); border-bottom-width: 1px; }
.rh-btn.active { background: #538c38; border-bottom-color: #2f541e; }
.rh-btn.play { background: #538c38; border-bottom-color: #2f541e; min-width: 56px; }
.rh-btn.danger { background: #a63a3a; border-bottom-color: #6b2222; }
.rh-btn.speed { min-width: 32px; padding: 0 6px; font-size: 11px; }

/* Replay Search & Filter Bar */
.replay-filter-bar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.replay-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.replay-pills .btn { padding: 5px 10px; font-size: 11.5px; }
.rbtn { min-width: 34px; height: 30px; padding: 0 12px !important; font-size: 12px !important; display: inline-flex !important; align-items: center; justify-content: center; white-space: nowrap; }
.rbtn.star { width: 30px; min-width: 30px; padding: 0 !important; font-size: 16px !important; }

/* Spectator Health & Adrenaline Card */
.spec-card {
  width: 225px;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.spec-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; letter-spacing: 0.08em; }
.spec-name { color: var(--accent); font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 135px; }
.spec-meta { color: rgba(255,255,255,0.6); font-size: 10px; }
.spec-bar-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.spec-bar-lbl { width: 22px; color: rgba(255,255,255,0.65); font-size: 10px; }
.spec-bar-track { flex: 1; height: 7px; border-radius: 4px; background: rgba(255,255,255,0.12); overflow: hidden; }
.spec-bar-hp { height: 100%; width: 100%; background: #4ade80; transition: width 0.08s linear, background 0.15s; }
.spec-bar-ad { height: 100%; width: 0%; background: #ff901a; transition: width 0.08s linear; }
.spec-bar-val { width: 32px; text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; }

/* HUD Mini Player */
.hud-music {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 250px;
  pointer-events: auto !important;
  cursor: pointer;
}
.hud-mthumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; background: #222; }
.hud-minfo { flex: 1; min-width: 0; }
.hud-mtitle { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
.hud-mtime { font-size: 10px; color: rgba(255,255,255,0.5); }
.hud-mbtns { display: flex; gap: 4px; }
.hud-mbtn { all: unset; cursor: pointer; padding: 4px 6px; border-radius: 6px; background: rgba(255,255,255,0.1); font-size: 11px; transition: background 0.1s; }
.hud-mbtn:hover { background: color-mix(in srgb, var(--accent) 40%, transparent); }

/* Embedded Tab Music Card */
.music-tab-card {
  display: flex; gap: 14px; align-items: center;
  background: rgba(255,255,255,0.04); border-radius: 12px;
  padding: 12px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.06);
}
.music-tab-thumb { width: 72px; height: 72px; border-radius: 8px; object-fit: cover; background: #222; box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
.music-tab-meta { flex: 1; min-width: 0; }
.music-tab-title { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.music-tab-author { font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 3px; }
.pl-visualizer { box-sizing: content-box !important; width: calc(100% - 22px); height: 52px; display: block; border-radius: 5px; margin: 0 0 8px; padding: 6px 10px; background: rgba(0,0,0,0.34); border: 1px solid rgba(255,255,255,0.08); }

/* Dedicated Playlist GUI Modal (vanilla style) */
.pl-modal {
  position: fixed; z-index: 10;
  width: min(560px, calc(100vw - 28px)); max-height: min(680px, calc(100vh - 28px));
  display: flex; flex-direction: column;
  overflow: hidden; color: #fff;
  background: #272722;
  border: 2px solid #141411;
  border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.8);
  opacity: 0; visibility: hidden; transform: translateY(10px) scale(0.95);
  pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s linear 0.18s;
}
.pl-modal.open { opacity: 1; visibility: visible; transform: none; pointer-events: auto; transition: opacity 0.2s ease, transform 0.3s cubic-bezier(0.2, 1.3, 0.4, 1); }
.pl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: #3d4034;
  border-bottom: 2px solid #1a1b15; cursor: move; user-select: none;
}
.pl-head h3 { margin: 0; font-size: 15px; letter-spacing: 0.06em; color: #fff; font-weight: 700; text-transform: uppercase; }
.pl-body { padding: 14px; overflow-y: auto; flex: 1; min-height: 0; }
.pl-body::-webkit-scrollbar { width: 6px; }
.pl-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 6px; }

.pl-top-bar { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.pl-top-bar select { flex: 1; }
.pl-search-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.pl-search-row input { flex: 1; min-width: 0; }
.pl-summary { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; }
.pl-list { margin-top: 8px; }
.pl-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 7px;
  background: rgba(0,0,0,0.34); margin-bottom: 4px;
  border: 1px solid rgba(255,255,255,0.08); cursor: grab; transition: background 0.1s, border-color 0.1s, opacity 0.1s;
  user-select: none;
}
.pl-item:active { cursor: grabbing; }
.pl-item.dragging { opacity: 0.35; }
.pl-item.drag-over { border-top: 2px solid #67a646; background: rgba(103,166,70,0.18); }
.pl-item.active { border-color: #67a646; background: rgba(103,166,70,0.16); }
.pl-thumb { width: 54px; height: 34px; flex: 0 0 auto; object-fit: cover; border-radius: 4px; background: #181814; }
.pl-item-meta { flex: 1; min-width: 0; cursor: pointer; }
.pl-item-title { min-width: 0; font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-item-author { margin-top: 2px; font-size: 10px; color: rgba(255,255,255,0.48); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-item-title:hover { color: #9bd36d; }
.pl-item-actions { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.pl-btn { all: unset; cursor: pointer; min-width: 24px; padding: 4px 6px; text-align: center; border-radius: 3px; font-size: 10px; background: #4a4b42; border-bottom: 2px solid #2a2b25; }
.pl-btn:hover { filter: brightness(1.15); }
.pl-btn:disabled { opacity: 0.25; cursor: default; }
@media (max-width: 520px) {
  .pl-top-bar select { flex-basis: 100%; }
  .pl-top-bar .btn { flex: 1; }
  .pl-item-actions .move-btn { display: none; }
}

/* Main Settings Window (vanilla survev style) */
.backdrop { position: fixed; inset: 0; z-index: 1; background: rgba(0, 0, 0, 0.62); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.22s ease, visibility 0s linear 0.22s; }
:host(.open) .backdrop { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.22s ease; }

.win {
  position: fixed; z-index: 3; left: 50%; top: 50%;
  width: min(860px, 94vw); height: min(600px, 92vh); max-height: 92vh;
  display: grid; grid-template-columns: 190px 1fr;
  overflow: hidden; color: #fff;
  background: #272722;
  border: 2px solid #141411;
  border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.8);
  opacity: 0; visibility: hidden; transform: translate(-50%, -46%) scale(0.95);
  pointer-events: none; transition: opacity 0.18s ease, transform 0.2s cubic-bezier(0.4, 0, 1, 1), visibility 0s linear 0.2s;
}
:host(.open) .win { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); pointer-events: auto; transition: opacity 0.2s ease, transform 0.32s cubic-bezier(0.2, 1.25, 0.4, 1); }
.side { display: flex; flex-direction: column; padding: 14px 10px; background: #1d1e19; border-right: 2px solid #141411; }
.logo { font-weight: 700; font-size: 22px; letter-spacing: 0.12em; padding: 0 6px 2px; color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,0.5); }
.ver { font-size: 11px; letter-spacing: 0.12em; color: rgba(255,255,255,0.4); padding: 0 6px 14px; }
.tab { all: unset; cursor: pointer; display: block; box-sizing: border-box; padding: 8px 12px; margin-bottom: 5px; border-radius: 3px; font-size: 14px; font-weight: 700; color: #fff; background: #4a4b42; border-bottom: 2px solid #2a2b25; }
.tab:hover { filter: brightness(1.12); }
.tab:active { transform: translateY(1px); border-bottom-width: 1px; }
.tab.active { background: #538c38; border-bottom-color: #2f541e; }
.hint-foot { margin-top: auto; padding: 8px 6px; font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.4); }
.hint-foot b { color: #9bd36d; font-weight: 700; }

.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #3d4034; border-bottom: 2px solid #1a1b15; }
.head h2 { margin: 0; font-size: 18px; letter-spacing: 0.06em; font-weight: 700; text-transform: uppercase; text-shadow: 0 2px 0 rgba(0,0,0,0.45); }
.x { all: unset; cursor: pointer; width: 30px; height: 30px; box-sizing: border-box; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #ddd; font-size: 15px; font-weight: 700; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); }
.x:hover { background: rgba(255,255,255,0.15); color: #fff; }

.content { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 6px 18px 18px; }
.content::-webkit-scrollbar { width: 8px; }
.content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
.section { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #9bd36d; margin: 16px 2px 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 700; }
.note { font-size: 12px; line-height: 1.55; color: rgba(255,255,255,0.55); padding: 6px 6px 2px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 12px; margin-bottom: 6px; border-radius: 5px; background: rgba(0,0,0,0.34); border: 1px solid rgba(255,255,255,0.08); }
.row:hover { background: rgba(0,0,0,0.44); }
.lbl .t { font-size: 14px; font-weight: 700; }
.lbl .hint { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 2px; }
.ctl { display: flex; align-items: center; gap: 10px; }
.val { min-width: 46px; text-align: right; font-size: 12px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }

.switch input { display: none; }
.switch i { display: block; width: 40px; height: 22px; border-radius: 4px; background: #181814; border: 1px solid #44453a; position: relative; transition: background 0.12s; cursor: pointer; box-sizing: border-box; }
.switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 2px; background: #8a8b80; transition: left 0.12s, background 0.12s; }
.switch input:checked + i { background: #538c38; border-color: #2f541e; }
.switch input:checked + i::after { left: 20px; background: #fff; }
input[type=range] { accent-color: #67a646; width: 170px; cursor: pointer; }
input[type=color] { width: 38px; height: 26px; border: 1px solid #44453a; border-radius: 4px; background: none; padding: 0; cursor: pointer; }
input[type=text] { background: #181814; color: #fff; border: 1px solid #44453a; border-radius: 5px; padding: 7px 10px; font-size: 13px; outline: none; }
input[type=text]:focus { border-color: #67a646; }
select { background: #181814; color: #fff; border: 1px solid #44453a; border-radius: 5px; padding: 6px 10px; font-size: 13px; outline: none; }
select:focus { border-color: #67a646; }
.btn { all: unset; cursor: pointer; box-sizing: border-box; padding: 7px 14px; border-radius: 3px; font-size: 13px; font-weight: 700; background: #4a4b42; color: #fff; border-bottom: 2px solid #2a2b25; text-align: center; }
.btn:hover { filter: brightness(1.15); }
.btn:active { transform: translateY(1px); border-bottom-width: 1px; }
.btn.active { background: #538c38 !important; border-bottom-color: #2f541e !important; color: #fff !important; }
.btn.danger:hover { background: #8a3434; border-bottom-color: #5a2020; }
.swatches { display: flex; gap: 7px; }
.sw { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 4px; border: 2px solid transparent; }
.sw:hover { filter: brightness(1.2); } .sw.sel { border-color: #fff; }

.preview { display: flex; align-items: center; justify-content: center; height: 130px; margin: 6px 0 8px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); background: conic-gradient(#2a2733 25%, #1f1c28 0 50%, #2a2733 0 75%, #1f1c28 0) 0 0 / 22px 22px; }

.debug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.debug-box { min-width: 0; background: rgba(0,0,0,0.34); border: 1px solid rgba(255,255,255,0.08); border-radius: 5px; padding: 9px 12px; }
.debug-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; padding-bottom: 6px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.chip { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; background: #4a4b42; border-bottom: 2px solid #2a2b25; }
.chip.on { background: #538c38; border-bottom-color: #2f541e; }
.debug-kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; line-height: 1.75; color: rgba(255,255,255,0.5); }
.debug-kv b { color: #fff; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.debug-term { background: #181814; border: 1px solid #44453a; border-radius: 5px; padding: 8px 4px; margin-bottom: 6px; height: 190px; overflow-y: auto; }
.debug-term::-webkit-scrollbar { width: 8px; }
.debug-term::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
.log-line { font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.6; padding: 0 8px; color: rgba(255,255,255,0.72); white-space: pre-wrap; word-break: break-word; border-left: 2px solid transparent; }
.log-line.warn { color: #ffd166; border-left-color: #ffd166; }
.log-line.error { color: #ff8a8a; border-left-color: #ff6b6b; background: rgba(255,107,107,0.08); }

.toast {
  position: fixed; z-index: 20; left: 50%; bottom: 42px;
  transform: translate(-50%, 10px); opacity: 0; pointer-events: none;
  padding: 9px 18px; border-radius: 4px; background: rgba(0, 0, 0, 0.82);
  border: 2px solid #141411;
  color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 0.03em;
  transition: opacity 0.22s ease, transform 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

/* Motion */
.content.enter > * { animation: row-in 0.28s cubic-bezier(0.2, 0.8, 0.3, 1) backwards; animation-delay: calc(var(--i, 0) * 22ms); }
.head h2.enter { animation: title-in 0.25s ease; }
@keyframes row-in { from { opacity: 0; translate: 0 10px; } }
@keyframes title-in { from { opacity: 0; translate: -8px 0; } }
.panel:not([hidden]) { animation: panel-in 0.25s ease; }
@keyframes panel-in { from { opacity: 0; translate: 0 8px; } }
.tab, .btn, .x, .sw, .hud-mbtn, .pl-btn { transition: background-color 0.15s, filter 0.15s, translate 0.15s, scale 0.1s, box-shadow 0.15s; }
.tab:hover { translate: 3px 0; }
.btn:hover { translate: 0 -1px; }
.btn:active, .x:active, .sw:active, .hud-mbtn:active { scale: 0.95; }
.switch i, .switch i::after { transition: left 0.22s cubic-bezier(0.3, 1.5, 0.5, 1), background-color 0.18s, border-color 0.18s !important; }
.row { transition: background-color 0.15s, border-color 0.15s; }
@media (prefers-reduced-motion: reduce) { *, *::after { animation-duration: 0.01ms !important; animation-delay: 0ms !important; transition-duration: 0.01ms !important; } }
`;


  let root, shadow;
  let rebinding = false;
  let activeTab = 'hud';

  /* =====================================================================
   *  Menu Configuration Schema
   * ===================================================================== */
  const SWATCHES = ['#67a646', '#ff4fa3', '#a370ff', '#34d6ff', '#4ade80', '#ffb347', '#ff5c5c'];
  const THEME_PRESETS = [
    { name: 'Vanilla Green', accent: '#67a646', glow: false },
    { name: 'Sakura Pink', accent: '#ff4fa3', glow: true },
    { name: 'Cyber Cyan', accent: '#34d6ff', glow: true },
    { name: 'Midnight Purple', accent: '#a370ff', glow: false },
    { name: 'Emerald', accent: '#4ade80', glow: false },
    { name: 'Crimson', accent: '#ff5c5c', glow: true },
    { name: 'Amber Gold', accent: '#ffb347', glow: false },
  ];

  const TABS = [
    {
      id: 'hud',
      name: 'HUD',
      rows: [
        { section: 'Performance Counters' },
        { type: 'toggle', path: 'hud.fps', label: 'FPS counter' },
        { type: 'toggle', path: 'hud.ping', label: 'Ping counter', hint: 'Real server ping (lobby + in-match)' },
        { type: 'toggle', path: 'hud.matchTimer', label: 'Match timer', hint: 'Elapsed match time' },
        { type: 'toggle', path: 'hud.clock', label: 'Local clock' },
        { type: 'toggle', path: 'hud.onlyInGame', label: 'Only show counters during a match' },
        { section: 'Health & Adrenaline' },
        { type: 'toggle', path: 'hud.hpNumber', label: 'Health percentage display' },
        { type: 'slider', path: 'hud.hpOffsetY', label: 'Health number vertical position', min: -30, max: 30, step: 1, unit: 'px' },
        { type: 'toggle', path: 'hud.adrenalineNumber', label: 'Adrenaline percentage display' },
        { type: 'toggle', path: 'hud.spectatorCard', label: 'Spectator side card', hint: 'Shows HP/AD bars & kills when spectating another player' },
        { type: 'slider', path: 'hud.barTextSize', label: 'Health text size', min: 12, max: 28, step: 1, unit: 'px' },
        { type: 'toggle', path: 'hud.lowHpAlert', label: 'Low HP warning vignette', hint: 'Red pulsing screen vignette below 25% HP' },
        { section: 'Overlay Customization' },
        { type: 'slider', path: 'hud.scale', label: 'HUD scale', min: 60, max: 160, step: 5, unit: '%' },
        { type: 'slider', path: 'hud.opacity', label: 'HUD opacity', min: 30, max: 100, step: 5, unit: '%' },
      ],
    },
    {
      id: 'visuals',
      name: 'Visuals',
      rows: [
        { section: 'Theme Presets & Glow' },
        { type: 'themePresets' },
        { type: 'toggle', path: 'visuals.hudGlow', label: 'HUD & Minimap Neon Glow', hint: 'Adds an accent glow around panels and minimap' },
        { type: 'toggle', path: 'visuals.themeLobbyButtons', label: 'Theme lobby buttons with accent', hint: 'Applies translucent dark glass + accent tint to lobby cards' },
        { section: 'Killfeed & Kill Audio' },
        { type: 'toggle', path: 'visuals.killSound', label: 'Play sound on kill', hint: 'Synthesized audio chime when your kill count increases' },
        {
          type: 'select', path: 'visuals.killSoundType', label: 'Kill sound style',
          options: [
            ['ding', 'Crisp Ding'],
            ['pop', 'Arcade Pop'],
            ['coin', 'Retro Coin'],
            ['chime', 'Soft Chime'],
          ],
        },
        { type: 'slider', path: 'visuals.killSoundVolume', label: 'Kill sound volume', min: 10, max: 100, step: 5, unit: '%' },
        {
          type: 'buttons', label: 'Preview kill sound',
          buttons: [{ text: '🔊 Test Sound', run: () => playKillSound() }],
        },
      ],
    },
    {
      id: 'replay',
      name: 'Replay',
      rows: [
        { section: 'Replay Recorder & Player' },
        { type: 'toggle', path: 'replay.autoRecord', label: 'Auto-record matches', hint: 'Records binary game packets into IndexedDB automatically' },
        { type: 'toggle', path: 'ui.lobbyReplaysBtn', label: '"Replays" button in main menu', hint: 'Adds a vanilla Replays button below How to Play in the lobby' },
        { type: 'toggle', path: 'replay.killMarkers', label: 'Auto-pin kills on timeline', hint: 'Marks timestamps of your kills for quick jumping' },
        { type: 'toggle', path: 'replay.bookmarkHotkey', label: 'Bookmark hotkey (H key)', hint: 'Press H in a live match to drop a bookmark on the timeline' },
        { type: 'toggle', path: 'replay.cinemaHotkey', label: 'Cinema mode hotkey (J key)', hint: 'Press J during a replay to hide all UI for clean clips' },
        { type: 'slider', path: 'replay.maxSaved', label: 'Max saved normal replays', hint: 'Favourited replays (★) are exempt and never auto-deleted', min: 3, max: 30, step: 1, unit: '' },
        { section: 'Saved Recordings' },
        { type: 'replayManager' },
      ],
    },
    {
      id: 'music',
      name: 'Music',
      rows: [
        { section: 'Client Music Player' },
        { type: 'embeddedPlayer' },
        {
          type: 'buttons', label: 'Playlist Manager',
          buttons: [
            { text: '📑 Open Playlist Manager GUI', run: () => setPlaylistModal(true) },
          ],
        },
        { type: 'note', text: 'Search YouTube music below, then add or play results directly from the client.' },
        { type: 'toggle', path: 'hud.musicHud', label: 'Show Mini-Player on HUD', hint: 'Interactive controller on your screen' },
        { type: 'toggle', path: 'music.autoNext', label: 'Auto-play next track' },
        { type: 'slider', path: 'music.volume', label: 'Music volume', min: 0, max: 100, step: 2, unit: '%' },
      ],
    },
    {
      id: 'crosshair',
      name: 'Crosshair',
      rows: [
        { type: 'preview' },
        { type: 'crosshairShare' },
        { type: 'toggle', path: 'crosshair.enabled', label: 'Use custom crosshair', hint: 'Replaces cursor in the play area' },
        {
          type: 'select', path: 'crosshair.style', label: 'Crosshair style',
          options: [
            ['cross', 'Classic Cross'],
            ['t-cross', 'T-Cross (No Top Arm)'],
            ['circle', 'Ring'],
            ['circle-dot', 'Ring + Center Dot'],
            ['dot', 'Precision Dot'],
            ['cross-dot', 'Cross + Center Dot'],
            ['box', 'Tactical Box'],
            ['box-dot', 'Box + Center Dot'],
            ['chevron', 'Chevron (Arrow)'],
            ['plus', 'Tight Plus (0 Gap)'],
          ],
        },
        { type: 'color', path: 'crosshair.color', label: 'Crosshair color' },
        { type: 'color', path: 'crosshair.outlineColor', label: 'Outline color' },
        { type: 'slider', path: 'crosshair.size', label: 'Reticle size', min: 8, max: 56, step: 2, unit: 'px' },
        { type: 'slider', path: 'crosshair.thickness', label: 'Line thickness', min: 1, max: 10, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.gap', label: 'Center gap', min: 0, max: 20, step: 1, unit: 'px' },
        { type: 'toggle', path: 'crosshair.dot', label: 'Include center dot' },
        { type: 'slider', path: 'crosshair.dotSize', label: 'Center dot size', min: 1, max: 8, step: 1, unit: 'px' },
        { type: 'toggle', path: 'crosshair.outline', label: 'High-contrast outline' },
        { section: 'Valorant-style Line Controls' },
        { type: 'toggle', path: 'crosshair.innerEnabled', label: 'Show inner lines' },
        { type: 'slider', path: 'crosshair.innerLength', label: 'Inner line length', min: 0, max: 40, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.innerVerticalLength', label: 'Inner vertical length', min: 0, max: 40, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.innerThickness', label: 'Inner line thickness', min: 1, max: 10, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.innerOffset', label: 'Inner line offset', min: 0, max: 30, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.innerOpacity', label: 'Inner line opacity', min: 0, max: 1, step: 0.05, unit: '' },
        { type: 'toggle', path: 'crosshair.outerEnabled', label: 'Show outer lines' },
        { type: 'slider', path: 'crosshair.outerLength', label: 'Outer line length', min: 0, max: 40, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.outerVerticalLength', label: 'Outer vertical length', min: 0, max: 40, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.outerThickness', label: 'Outer line thickness', min: 1, max: 10, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.outerOffset', label: 'Outer line offset', min: 0, max: 40, step: 1, unit: 'px' },
        { type: 'slider', path: 'crosshair.outerOpacity', label: 'Outer line opacity', min: 0, max: 1, step: 0.05, unit: '' },
        { type: 'slider', path: 'crosshair.outlineWidth', label: 'Outline thickness', min: 0, max: 8, step: 0.5, unit: 'px' },
        { type: 'slider', path: 'crosshair.outlineOpacity', label: 'Outline opacity', min: 0, max: 1, step: 0.05, unit: '' },
        { type: 'slider', path: 'crosshair.dotOpacity', label: 'Center dot opacity', min: 0, max: 1, step: 0.05, unit: '' },
      ],
    },
    {
      id: 'interface',
      name: 'Interface',
      rows: [
        { section: 'Game Enhancements' },
        { type: 'toggle', path: 'ui.serverDropdownPing', label: 'Live ping inside server dropdown', hint: 'Shows live ms latency next to each region in the lobby selector' },
        { type: 'toggle', path: 'ui.weaponBorders', label: 'Gun caliber borders (Guns Only)', hint: 'Highlights primary & secondary guns with their caliber color' },
        { type: 'toggle', path: 'ui.hideSocials', label: 'Hide social & coffee buttons', hint: 'Removes Discord, Ko-Fi, and promo links' },
        { type: 'toggle', path: 'ui.hideAds', label: 'Hide promo & banner ad boxes' },
        { type: 'toggle', path: 'ui.hideNews', label: 'Hide news feed' },
        { type: 'toggle', path: 'ui.hideKillfeed', label: 'Hide killfeed' },
        { type: 'toggle', path: 'ui.hideKillLeader', label: 'Hide kill leader panel' },
      ],
    },
    {
      id: 'extras',
      name: 'Extras',
      rows: [
        { section: 'Keystrokes Display' },
        { type: 'toggle', path: 'hud.keystrokes', label: 'Show keystrokes (WASD & Mouse buttons)' },
        { type: 'toggle', path: 'hud.cps', label: 'Clicks per second (CPS) counter' },
      ],
    },
    {
      id: 'debug',
      name: 'Debug',
      rows: [
        { section: 'Advanced Match Telemetry' },
        { type: 'advancedTelemetry' },
        { section: 'Live Console Logs' },
        { type: 'debugTerminal' },
        {
          type: 'buttons', label: 'Export Diagnostics',
          buttons: [
            { text: 'Copy to clipboard', run: () => exportDiagnostics() },
          ],
        },
      ],
    },
    {
      id: 'settings',
      name: 'Settings',
      rows: [
        { section: 'Interface Style' },
        { type: 'uiVariant' },
        { type: 'toggle', path: 'ui.askVariant', label: 'Ask which UI to load on page load', hint: 'Off: the loader goes straight to your last choice' },
        { section: 'Theme Accent' },
        { type: 'swatches' },
        { type: 'color', path: 'accent', label: 'Custom accent color' },
        { section: 'Menu Shortcut' },
        { type: 'key', label: 'Toggle key', hint: 'Press on its own to open or close the menu' },
        { section: 'Profile Management' },
        {
          type: 'buttons', label: 'Settings profile',
          buttons: [
            { text: 'Export', run: () => exportCfg() },
            { text: 'Import', run: () => importCfg() },
            { text: 'Reset', run: () => resetCfg(), danger: true },
          ],
        },
      ],
    },
  ];

  /* =====================================================================
   *  UI Builder
   * ===================================================================== */
  function commit(path, value) {
    setPath(S, path, value);
    if (path === 'crosshair.size' || path === 'crosshair.gap') {
      const c = S.crosshair;
      c.innerOffset = c.gap;
      c.innerLength = Math.max(1, c.size / 2 - c.innerOffset);
      c.innerVerticalLength = c.innerLength;
      if (!c.outerEnabled) c.outerOffset = c.innerOffset + c.innerLength;
    }
    save();
    applyAll();
  }

  function buildRow(r) {
    if (r.section) return h('div', { class: 'section' }, r.section);
    if (r.type === 'note') return h('div', { class: 'note' }, r.text);
    if (r.type === 'preview') {
      ui.previewImg = h('img', { alt: 'Crosshair Preview' });
      updatePreview();
      return h('div', { class: 'preview' }, ui.previewImg);
    }
    if (r.type === 'swatches') {
      const wrap = h('div', { class: 'swatches' });
      for (const c of SWATCHES) {
        const b = h('button', { class: 'sw' + (S.accent.toLowerCase() === c ? ' sel' : ''), style: 'background:' + c, title: c });
        b.addEventListener('click', () => {
          commit('accent', c);
          renderTab();
        });
        wrap.append(b);
      }
      return h('div', { class: 'row' }, h('div', { class: 'lbl' }, h('div', { class: 't' }, 'Accent presets')), wrap);
    }

    if (r.type === 'uiVariant') {
      const wrap = h('div', { class: 'ctl' });
      for (const [id, name] of [['classic', 'UI 1 · Classic'], ['modern', 'UI 2 · Modern']]) {
        wrap.append(h('button', {
          class: 'btn' + (S.ui.variant === id ? ' active' : ''),
          onclick: () => {
            setVariant(id);
            renderTab();
          },
        }, name));
      }
      return h('div', { class: 'row' }, h('div', { class: 'lbl' }, h('div', { class: 't' }, 'UI variant'), h('div', { class: 'hint' }, 'Same features, different look')), wrap);
    }

    if (r.type === 'themePresets') {
      const wrap = h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;' });
      for (const p of THEME_PRESETS) {
        const isCurrent = S.accent.toLowerCase() === p.accent.toLowerCase();
        const b = h('button', {
          class: 'btn' + (isCurrent ? ' active' : ''),
          style: `padding: 6px 11px; font-size: 12px; border-left: 3px solid ${p.accent};`,
          onclick: () => {
            S.accent = p.accent;
            S.visuals.hudGlow = p.glow;
            save();
            applyAll();
            renderTab();
            toast(`Applied "${p.name}" theme`);
          },
        }, p.name);
        wrap.append(b);
      }
      return wrap;
    }

    if (r.type === 'replayManager') {
      const wrap = h('div', {});
      const favCount = replay.list.filter((x) => x.favorite).length;
      const normCount = replay.list.length - favCount;

      const topActions = h(
        'div',
        { style: 'display:flex; gap:8px; margin-bottom:10px; align-items:center;' },
        h('button', { class: 'btn rbtn', onclick: () => ui.replayFileInput?.click() }, 'Import Replay (.svrep / .json / .har)'),
        h('button', {
          class: 'btn rbtn danger',
          onclick: () => {
            if (normCount > 0 && window.confirm(`Delete all ${normCount} non-favourite replays? (Favourites stay safe)`)) {
              clearNonFavoriteReplaysDB();
              renderTab();
              toast('Non-favourite replays cleared');
            } else if (normCount === 0) {
              toast('No non-favourite replays to clear');
            }
          },
        }, 'Clear Non-Favourites')
      );
      wrap.append(topActions);

      wrap.append(
        h('div', { class: 'note', style: 'padding-bottom:8px;' }, `Favourites: ${favCount} (unlimited) · Recent slots used: ${normCount} / ${S.replay.maxSaved} · Storage: ${fmtBytes(totalReplayBytes())}`)
      );

      const searchInput = h('input', {
        type: 'text',
        placeholder: 'Search replays by name, server, or weapon…',
        value: replay.search,
        style: 'width:100%;',
      });
      searchInput.addEventListener('input', () => {
        replay.search = searchInput.value;
        renderReplayListOnly(listWrap);
      });

      const pillsWrap = h('div', { class: 'replay-pills' });
      const filters = [
        ['all', 'All'],
        ['fav', 'Favourites'],
        ['win', 'Wins (#1)'],
        ['highkills', '5+ Kills'],
      ];
      filters.forEach(([fid, flabel]) => {
        const pb = h('button', {
          class: 'btn' + (replay.filter === fid ? ' active' : ''),
          onclick: () => {
            replay.filter = fid;
            pillsWrap.querySelectorAll('.btn').forEach((b, idx) => {
              b.classList.toggle('active', filters[idx][0] === fid);
            });
            renderReplayListOnly(listWrap);
          },
        }, flabel);
        pillsWrap.append(pb);
      });

      const sortSel = h('select', { style: 'margin-left:auto;' }, SORT_OPTIONS.map(([v, t]) => h('option', { value: v }, t)));
      sortSel.value = replay.sort;
      sortSel.addEventListener('change', () => {
        replay.sort = sortSel.value;
        renderReplayListOnly(listWrap);
      });
      pillsWrap.append(sortSel);

      const listWrap = h('div', {});
      wrap.append(h('div', { class: 'replay-filter-bar' }, searchInput, pillsWrap), listWrap);
      renderReplayListOnly(listWrap);

      wrap.append(h('div', { class: 'note' }, 'Hotkeys — Live: H (Bookmark) | Replay: F1-F6 (Speed), F7 (Pause / Restart when finished), Left/Right (-5s / +5s), [ and ] (Prev / Next pin), J (Cinema Mode).'));
      return wrap;
    }

    if (r.type === 'crosshairShare') {
      const input = h('input', {
        type: 'text',
        placeholder: 'Paste a Valorant or Danonane crosshair code…',
        style: 'width:100%; min-width:0; margin-bottom:7px;',
      });
      const status = h('div', { class: 'hint', style: 'margin-bottom:7px;' }, 'Valorant movement/error settings are approximated to the supported reticle controls.');
      const applyBtn = h('button', { class: 'btn', style: 'padding:6px 10px;' }, '📥 Apply Code');
      applyBtn.addEventListener('click', () => {
        const next = parseCrosshairCode(input.value);
        if (!next) {
          status.textContent = 'That code was not recognized.';
          toast('Invalid crosshair code');
          return;
        }
        S.crosshair = { ...S.crosshair, ...next, enabled: true };
        save();
        applyAll();
        toast('Crosshair imported');
        renderTab();
      });
      const copyBtn = h('button', { class: 'btn', style: 'padding:6px 10px;' }, '📋 Copy Current Code');
      copyBtn.addEventListener('click', async () => {
        const code = crosshairShareCode();
        input.value = code;
        status.textContent = (await copyText(code)) ? 'Copied. Paste this code anywhere to share it.' : 'Code placed in the box; copy it manually.';
      });
      const actions = h('div', { style: 'display:flex; gap:7px; flex-wrap:wrap;' }, applyBtn, copyBtn);
      return h('div', { class: 'row', style: 'display:block;' }, h('div', { class: 'lbl', style: 'margin-bottom:7px;' }, h('div', { class: 't' }, 'Crosshair codes'), h('div', { class: 'hint' }, 'Paste a Valorant crosshair code or a Danonane code copied from a friend.')), input, status, actions);
    }

    if (r.type === 'embeddedPlayer') {
      const track = getCurrentTrack();
      const thumbUrl = track && track.id ? `https://img.youtube.com/vi/${track.id}/mqdefault.jpg` : '';
      ui.tabMThumb = h('img', { class: 'music-tab-thumb', src: thumbUrl, style: `display: ${thumbUrl ? 'block' : 'none'};` });
      ui.tabMTitle = h('div', { class: 'music-tab-title' }, track ? track.title : 'No Track Selected');
      ui.tabMAuthor = h('div', { class: 'music-tab-author' }, track ? track.author : 'Add a song below');

      const meta = h('div', { class: 'music-tab-meta' }, ui.tabMTitle, ui.tabMAuthor);
      const topCard = h('div', { class: 'music-tab-card' }, ui.tabMThumb, meta);
      ui.visualizerCanvas = h('canvas', { class: 'pl-visualizer' });

      ui.tabMSeek = h('input', { type: 'range', style: 'flex:1; accent-color: var(--accent);', min: 0, max: 100, value: 0 });
      ui.tabMSeek.addEventListener('input', () => { ui.mSeekDragging = true; });
      ui.tabMSeek.addEventListener('change', () => {
        ui.mSeekDragging = false;
        if (music.player && music.ready) music.player.seekTo(Number(ui.tabMSeek.value), true);
      });
      ui.tabMTime = h('div', { style: 'font-size:11px; min-width:70px; text-align:right;' }, '00:00 / 00:00');
      const seekRow = h('div', { style: 'display:flex; align-items:center; gap:8px; margin-bottom:8px;' }, ui.tabMSeek, ui.tabMTime);

      const prevBtn = h('button', { class: 'btn' }, '⏮');
      prevBtn.addEventListener('click', () => prevTrack());

      ui.tabMPlayBtn = h('button', { class: 'btn', style: 'padding: 6px 16px;' }, music.playing ? '⏸ Pause' : '▶ Play');
      ui.tabMPlayBtn.addEventListener('click', () => togglePlayPause());

      const nextBtn = h('button', { class: 'btn' }, '⏭');
      nextBtn.addEventListener('click', () => nextTrack());

      ui.tabMLoopBtn = h('button', { class: 'btn' + (S.music.loop ? ' active' : '') }, '🔁 Loop');
      ui.tabMLoopBtn.addEventListener('click', () => {
        S.music.loop = !S.music.loop;
        ui.tabMLoopBtn.classList.toggle('active', S.music.loop);
        save();
      });

      const videoBtn = h('button', { class: 'btn' }, '📺 Video');
      videoBtn.addEventListener('click', () => {
        S.music.showVideo = !S.music.showVideo;
        updateMusicUI();
        save();
      });

      const ctrls = h('div', { style: 'display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:12px;' }, prevBtn, ui.tabMPlayBtn, nextBtn, ui.tabMLoopBtn, videoBtn);

      const clientInput = h('input', { type: 'text', placeholder: 'Paste YouTube link or Video ID…', style: 'flex:1;' });
      const addBtn = h('button', { class: 'btn', style: 'padding: 6px 12px;' }, '➕ Add');
      addBtn.addEventListener('click', () => {
        if (clientInput.value) {
          addTrackToActivePlaylist(clientInput.value, false);
          clientInput.value = '';
        }
      });
      const playNowBtn = h('button', { class: 'btn', style: 'padding: 6px 12px;' }, '▶ Play Now');
      playNowBtn.addEventListener('click', () => {
        if (clientInput.value) {
          addTrackToActivePlaylist(clientInput.value, true);
          clientInput.value = '';
        }
      });
      const inputRow = h('div', { style: 'display:flex; gap:6px; margin-bottom:12px;' }, clientInput, addBtn, playNowBtn);

      ui.musicSearchInput = h('input', { type: 'search', placeholder: 'Search YouTube music…', autocomplete: 'off', style: 'flex:1; min-width:0;' });
      ui.musicSearchPlaylist = h('select', { style: 'min-width:130px;' });
      refreshMusicSearchPlaylists();
      ui.musicSearchStatus = h('div', { class: 'hint', style: 'margin:6px 0;' }, 'Search results stay inside the client. Choose a playlist before pressing Add.');
      ui.musicSearchResults = h('div', { style: 'max-height:260px; overflow-y:auto;' });
      const searchBtn = h('button', { class: 'btn', style: 'padding:6px 10px;' }, '🔎 Search');
      searchBtn.addEventListener('click', () => searchMusic(ui.musicSearchInput.value));
      ui.musicSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchBtn.click();
      });
      const searchRow = h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;' }, ui.musicSearchInput, ui.musicSearchPlaylist, searchBtn);
      const searchBox = h('div', { style: 'padding:9px 10px; margin-top:8px; border-radius:8px; background:rgba(0,0,0,.22);' }, h('div', { style: 'font-size:12px;font-weight:700;margin-bottom:2px;' }, '🎵 Search music'), searchRow, ui.musicSearchStatus, ui.musicSearchResults);

      return h('div', {}, topCard, ui.visualizerCanvas, seekRow, ctrls, inputRow, searchBox);
    }

    if (r.type === 'advancedTelemetry') {
      ui.debugGrid = h('div', { class: 'debug-grid' });
      renderTelemetry();
      return ui.debugGrid;
    }

    if (r.type === 'debugTerminal') {
      ui.debugLogEl = h('div', { class: 'debug-term' });
      renderDebugLog();
      requestAnimationFrame(() => { if (ui.debugLogEl) ui.debugLogEl.scrollTop = ui.debugLogEl.scrollHeight; });
      return ui.debugLogEl;
    }

    const label = h(
      'div',
      { class: 'lbl' },
      h('div', { class: 't' }, r.label),
      r.hint ? h('div', { class: 'hint' }, r.hint) : null
    );

    switch (r.type) {
      case 'toggle': {
        const input = h('input', { type: 'checkbox' });
        input.checked = !!getPath(S, r.path);
        input.addEventListener('change', () => {
          commit(r.path, input.checked);
        });
        return h('label', { class: 'row' }, label, h('span', { class: 'switch' }, input, h('i')));
      }
      case 'slider': {
        const val = h('span', { class: 'val' });
        const input = h('input', { type: 'range', min: r.min, max: r.max, step: r.step || 1 });
        input.value = getPath(S, r.path);
        const show = () => (val.textContent = input.value + (r.unit || ''));
        show();
        input.addEventListener('input', () => {
          show();
          commit(r.path, Number(input.value));
          if (r.path === 'music.volume' && music.player && music.ready) {
            music.player.setVolume(Number(input.value));
          }
        });
        return h('div', { class: 'row' }, label, h('span', { class: 'ctl' }, input, val));
      }
      case 'color': {
        const input = h('input', { type: 'color' });
        input.value = getPath(S, r.path);
        input.addEventListener('input', () => commit(r.path, input.value));
        return h('div', { class: 'row' }, label, input);
      }
      case 'select': {
        const sel = h('select', {}, r.options.map(([v, t]) => h('option', { value: v }, t)));
        sel.value = getPath(S, r.path);
        sel.addEventListener('change', () => commit(r.path, sel.value));
        return h('div', { class: 'row' }, label, sel);
      }
      case 'key': {
        const btn = h('button', { class: 'btn' }, keyName(S.menuKey));
        btn.addEventListener('click', () => {
          btn.textContent = 'Press any key…';
          rebinding = true;
          const onKey = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.removeEventListener('keydown', onKey, true);
            rebinding = false;
            if (e.code !== 'Escape') {
              S.menuKey = e.code;
              save();
              toast('Menu shortcut set to ' + keyName(S.menuKey));
            }
            btn.textContent = keyName(S.menuKey);
          };
          window.addEventListener('keydown', onKey, true);
        });
        return h('div', { class: 'row' }, label, btn);
      }
      case 'buttons': {
        const wrap = h('div', { class: 'ctl' });
        for (const b of r.buttons) {
          wrap.append(h('button', { class: 'btn' + (b.danger ? ' danger' : ''), onclick: b.run }, b.text));
        }
        return h('div', { class: 'row' }, label, wrap);
      }
    }
    return h('div');
  }

  function renderTelemetry() {
    if (!ui.debugGrid) return;
    const text = (sel) => document.querySelector(sel)?.textContent || '';
    const alive = text('#ui-players-alive') || text('#ui-alive-counter') || text('.ui-players-alive');
    const ms = (v) => (v ? v + ' ms' : '--');
    const card = (title, status, tone, lines) =>
      h(
        'div',
        { class: 'debug-box' },
        h('div', { class: 'debug-head' }, h('span', {}, title), status ? h('span', { class: 'chip ' + tone }, status) : null),
        lines.map(([k, v]) => h('div', { class: 'debug-kv' }, h('span', {}, k), h('b', { title: String(v) }, String(v))))
      );
    ui.debugGrid.replaceChildren(
      card('Network', replay.active ? 'Replay' : net.gameWs ? 'In match' : 'Lobby', replay.active || net.gameWs ? 'on' : '', [
        ['Ping', net.ping != null ? net.ping + ' ms' : 'Probing'],
        ['Jitter', net.maxPing > net.minPing ? net.maxPing - net.minPing + ' ms' : '0 ms'],
        ['Min / Max', `${net.minPing === 9999 ? 0 : net.minPing} / ${net.maxPing} ms`],
      ]),
      card('Match', net.gameWs ? 'Live' : 'Idle', net.gameWs ? 'on' : '', [
        ['Alive', alive || '--'],
        ['Kills', text('#ui-kill-counter') || '0'],
        ['Time', net.matchStart ? fmtTime((performance.now() - net.matchStart) / 1000) : '--:--'],
      ]),
      card('Weapons', '', '', [
        ['Slot 1', text('#ui-weapon-id-1 .ui-weapon-name') || 'None'],
        ['Slot 2', text('#ui-weapon-id-2 .ui-weapon-name') || 'None'],
      ]),
      card('Replay engine', replay.recording ? 'Recording' : 'Idle', replay.recording ? 'on' : '', [
        ['Saved', replay.list.length],
        ['Favourites', replay.list.filter((x) => x.favorite).length],
        ['Packets', replay.recording ? replay.recording.packets.length : 0],
      ]),
      card('Regional ping', '', '', [
        ['Europe', ms(net.regionPings.eu)],
        ['North America', ms(net.regionPings.na)],
        ['Russia', ms(net.regionPings.ru)],
        ['Asia', ms(net.regionPings.asia)],
      ]),
      card('Music engine', music.ready ? 'Ready' : 'Starting', music.ready ? 'on' : '', [
        ['Tracks', getActivePlaylist().tracks.length],
        ['Loop', S.music.loop ? 'On' : 'Off'],
        ['Volume', S.music.volume + '%'],
      ])
    );
  }

  function getFilteredReplays() {
    let displayList = [...replay.list];
    if (replay.fileReplay && !displayList.some((x) => x.id === replay.fileReplay.id)) {
      displayList.unshift(replay.fileReplay);
    }

    const q = (replay.search || '').trim().toLowerCase();
    const filtered = displayList.filter((rec) => {
      if (replay.filter === 'fav' && !rec.favorite) return false;
      if (replay.filter === 'win' && (!rec.meta || rec.meta.placement !== '#1')) return false;
      if (replay.filter === 'highkills' && (!rec.meta || (rec.meta.kills || 0) < 5)) return false;
      if (q) {
        const hay = [
          rec.name || '',
          rec.host || '',
          ...(rec.meta?.weapons || []),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorted = filtered.slice();
    if (replay.sort === 'oldest') sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    else if (replay.sort === 'longest') sorted.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
    else if (replay.sort === 'kills') sorted.sort((a, b) => ((b.meta && b.meta.kills) || 0) - ((a.meta && a.meta.kills) || 0));
    return sorted;
  }

  function renderReplayListOnly(container) {
    container.textContent = '';
    const displayList = getFilteredReplays();

    if (!displayList.length) {
      container.append(h('div', { class: 'note' }, 'No matching replays found.'));
      return;
    }

    displayList.forEach((rec) => {
      const m = rec.meta || {};
      const metaBits = [];
      if (m.kills > 0) metaBits.push(`${m.kills} Kills`);
      if (m.placement) metaBits.push(m.placement);
      if (m.weapons && m.weapons.length) metaBits.push(m.weapons.join(' + '));
      metaBits.push(`${fmtBytes(replayBytes(rec))}`);
      metaBits.push(new Date(rec.createdAt).toLocaleString());

      const info = h(
        'div',
        { class: 'lbl' },
        h('div', { class: 't' }, formatReplayLabel(rec)),
        h('div', { class: 'hint' }, metaBits.join(' · '))
      );
      const btns = h(
        'div',
        { class: 'ctl', style: 'gap:6px;' },
        h('button', {
          class: 'btn rbtn',
          onclick: () => {
            setMenu(false);
            if (rec === replay.fileReplay) replay.mode = 'file';
            else { replay.mode = 'recent'; replay.selectedId = rec.id; }
            refreshReplayUI();
            setTimeout(() => triggerWatchReplay(rec), 60);
          },
        }, 'Watch'),
        h('button', {
          class: 'btn rbtn star' + (rec.favorite ? ' fav-on' : ''),
          title: rec.favorite ? 'Unfavourite' : 'Favourite (Never auto-deleted)',
          onclick: () => toggleReplayFavorite(rec),
        }, rec.favorite ? '★' : '☆'),
        h('button', { class: 'btn rbtn', title: 'Rename Replay', onclick: () => renameReplay(rec) }, 'Rename'),
        h('button', { class: 'btn rbtn', title: 'Download .svrep', onclick: () => downloadReplayFile(rec) }, 'Save'),
        h('button', {
          class: 'btn rbtn danger',
          title: 'Delete Replay',
          onclick: async () => {
            if (rec === replay.fileReplay) {
              replay.fileReplay = null;
              replay.mode = 'record';
              refreshReplayUI();
            } else {
              await deleteReplayFromDB(rec.id);
            }
            renderTab();
          },
        }, 'Delete')
      );
      container.append(h('div', { class: 'row' }, info, btns));
    });
  }

  let renderedTab = null;
  function renderTab() {
    const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
    const changed = renderedTab !== tab.id;
    const scroll = changed ? 0 : ui.content.scrollTop;
    renderedTab = tab.id;
    ui.title.textContent = tab.name.toUpperCase();
    ui.content.textContent = '';
    ui.previewImg = null;
    ui.debugGrid = null;
    ui.debugLogEl = null;
    for (const r of tab.rows) ui.content.append(buildRow(r));
    for (const [id, btn] of Object.entries(ui.tabBtns)) btn.classList.toggle('active', id === activeTab);
    ui.content.scrollTop = scroll;
    ui.content.classList.remove('enter');
    ui.title.classList.remove('enter');
    if (changed) {
      [...ui.content.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
      void ui.content.offsetWidth; // restart the animation
      ui.content.classList.add('enter');
      ui.title.classList.add('enter');
      if (tab.id === 'music') {
        music.uiCache = Object.create(null);
        if (getCurrentTrack()) loadYouTubeIframeAPI();
        updateMusicUI();
      }
    }
  }

  function updatePreview() {
    if (ui.previewImg) ui.previewImg.src = crosshairURI(S.crosshair);
  }

  /* =====================================================================
   *  Main Menu Replays Button & Vanilla survev.io-styled Replays Modal
   * ===================================================================== */
  function updateServerDropdownPings() {
    const selects = [
      document.getElementById('server-select-main'),
      document.getElementById('team-server-select'),
    ];
    for (const sel of selects) {
      if (!sel) continue;
      for (const opt of sel.options) {
        const curText = opt.textContent || '';
        const stripIdx = curText.lastIndexOf(' · ');
        if (stripIdx !== -1 && /\d+\s*ms$/.test(curText.slice(stripIdx + 3))) {
          opt.dataset.plOrig = curText.slice(0, stripIdx);
        } else {
          opt.dataset.plOrig = curText;
        }

        const orig = opt.dataset.plOrig || curText;
        if (!S.ui.serverDropdownPing) {
          if (opt.textContent !== orig) opt.textContent = orig;
          continue;
        }
        const reg = opt.value;
        const ms = net.regionPings[reg];
        if (ms != null) {
          const nextTxt = `${orig} · ${ms} ms`;
          if (opt.textContent !== nextTxt) opt.textContent = nextTxt;
        }
      }
    }
  }

  function updateLobbyReplaysButton() {
    const helpBtn = document.getElementById('btn-help');
    const existing = document.getElementById('pl-lobby-replays-btn');
    if (!S.ui.lobbyReplaysBtn || !!net.gameWs) {
      if (existing) existing.style.display = 'none';
      if (helpBtn) helpBtn.classList.remove('pl-has-replays');
      return;
    }

    if (!helpBtn || !helpBtn.parentElement) return;
    helpBtn.classList.add('pl-has-replays');

    const countLabel = replay.list.length ? `Replays (${replay.list.length})` : 'Replays';
    if (existing) {
      existing.style.display = '';
      if (existing.textContent !== countLabel) existing.textContent = countLabel;
      return;
    }

    const btn = document.createElement('a');
    btn.id = 'pl-lobby-replays-btn';
    btn.className = helpBtn.className.replace(/\bpl-has-replays\b/g, '').trim() || 'btn-darken menu-option';
    btn.textContent = countLabel;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setVanillaReplaysModal(true);
    });
    helpBtn.insertAdjacentElement('afterend', btn);
  }

  function ensureVanillaReplaysModal() {
    if (ui.vrBackdrop) return;

    ui.vrSearch = h('input', {
      type: 'text',
      class: 'pl-vr-search',
      placeholder: 'Search replays by name, server, or weapon…',
    });
    ui.vrSearch.addEventListener('input', () => {
      replay.search = ui.vrSearch.value;
      renderVanillaReplaysList();
    });

    const chooseBtn = h('button', {
      class: 'pl-vr-btn',
      onclick: () => ui.replayFileInput?.click(),
    }, 'Choose File');

    const clearBtn = h('button', {
      class: 'pl-vr-btn danger',
      onclick: () => {
        const normCount = replay.list.filter((x) => !x.favorite).length;
        if (normCount > 0 && window.confirm(`Delete all ${normCount} non-favourite replays? (Favourites stay safe)`)) {
          clearNonFavoriteReplaysDB();
          toast('Non-favourite replays cleared');
        } else if (normCount === 0) {
          toast('No non-favourite replays to clear');
        }
      },
    }, 'Clear Normal');

    ui.vrPills = h('div', { class: 'pl-vr-pills' });
    const filters = [
      ['all', 'All'],
      ['fav', 'Favourites'],
      ['win', 'Wins (#1)'],
      ['highkills', '5+ Kills'],
    ];
    filters.forEach(([fid, flabel]) => {
      ui.vrPills.append(h('button', {
        class: 'pl-vr-btn' + (replay.filter === fid ? ' active' : ''),
        'data-fid': fid,
        onclick: () => {
          replay.filter = fid;
          renderVanillaReplaysModal();
        },
      }, flabel));
    });

    ui.vrSort = h('select', { class: 'pl-vr-sort', title: 'Sort replays' }, SORT_OPTIONS.map(([v, t]) => h('option', { value: v }, t)));
    ui.vrSort.value = replay.sort;
    ui.vrSort.addEventListener('change', () => {
      replay.sort = ui.vrSort.value;
      renderVanillaReplaysList();
    });
    ui.vrPills.append(ui.vrSort);

    ui.vrAutoRecBtn = h('button', {
      class: 'pl-vr-btn',
      onclick: () => {
        S.replay.autoRecord = !S.replay.autoRecord;
        save();
        renderVanillaReplaysModal();
      },
    });

    ui.vrMetaText = h('span', {});
    ui.vrList = h('div', {});

    const closeBtn = h('button', {
      class: 'pl-vr-close',
      onclick: () => setVanillaReplaysModal(false),
    }, '×');

    const modal = h(
      'div',
      { class: 'pl-vr-modal' },
      h('div', { class: 'pl-vr-head' }, h('h3', {}, 'Replays'), closeBtn),
      h(
        'div',
        { class: 'pl-vr-body' },
        h('div', { class: 'pl-vr-toolbar' }, ui.vrSearch, chooseBtn, clearBtn),
        ui.vrPills,
        h('div', { class: 'pl-vr-meta-bar' }, ui.vrMetaText, ui.vrAutoRecBtn),
        ui.vrList
      )
    );
    modal.addEventListener('click', (e) => e.stopPropagation());

    ui.vrBackdrop = h('div', { id: 'pl-vanilla-replays-backdrop' }, modal);
    ui.vrBackdrop.addEventListener('click', (e) => {
      if (e.target === ui.vrBackdrop) setVanillaReplaysModal(false);
    });
    document.body.appendChild(ui.vrBackdrop);
  }

  function renderVanillaReplaysList() {
    if (!ui.vrList) return;
    ui.vrList.textContent = '';

    const displayList = getFilteredReplays();
    if (!displayList.length) {
      ui.vrList.append(h('div', { style: 'text-align:center; padding: 28px 12px; color: rgba(255,255,255,0.5); font-size: 14px;' },
        'No replays found. Play a match with Auto-Record ON, or click Choose File to load a .svrep replay!'));
      return;
    }

    displayList.forEach((rec) => {
      const m = rec.meta || {};
      const metaBits = [];
      if (m.kills > 0) metaBits.push(`${m.kills} Kills`);
      if (m.placement) metaBits.push(m.placement);
      if (m.weapons && m.weapons.length) metaBits.push(m.weapons.join(' + '));
      metaBits.push(`${fmtBytes(replayBytes(rec))}`);
      metaBits.push(new Date(rec.createdAt).toLocaleString());

      const row = h(
        'div',
        { class: 'pl-vr-item' },
        h(
          'div',
          { class: 'pl-vr-item-info' },
          h('div', { class: 'pl-vr-item-title' }, formatReplayLabel(rec)),
          h('div', { class: 'pl-vr-item-sub' }, metaBits.join(' · '))
        ),
        h(
          'div',
          { class: 'pl-vr-item-btns' },
          h('button', {
            class: 'pl-vr-btn green',
            onclick: () => {
              setVanillaReplaysModal(false);
              if (rec === replay.fileReplay) replay.mode = 'file';
              else {
                replay.mode = 'recent';
                replay.selectedId = rec.id;
              }
              setTimeout(() => triggerWatchReplay(rec), 40);
            },
          }, 'Watch'),
          h('button', {
            class: 'pl-vr-btn pl-vr-star' + (rec.favorite ? ' fav-on' : ''),
            title: rec.favorite ? 'Unfavourite' : 'Favourite (Exempt from auto-delete)',
            onclick: () => toggleReplayFavorite(rec),
          }, rec.favorite ? '★' : '☆'),
          h('button', { class: 'pl-vr-btn', title: 'Rename', onclick: () => renameReplay(rec) }, 'Rename'),
          h('button', { class: 'pl-vr-btn', title: 'Save .svrep file', onclick: () => downloadReplayFile(rec) }, 'Save'),
          h('button', {
            class: 'pl-vr-btn danger',
            title: 'Delete',
            onclick: async () => {
              if (rec === replay.fileReplay) {
                replay.fileReplay = null;
                replay.mode = 'record';
                refreshReplayUI();
              } else {
                await deleteReplayFromDB(rec.id);
              }
            },
          }, 'Delete')
        )
      );
      ui.vrList.append(row);
    });
  }

  function renderVanillaReplaysModal() {
    if (!ui.vrBackdrop) return;
    if (ui.vrSearch && ui.vrSearch.value !== replay.search) {
      ui.vrSearch.value = replay.search;
    }
    if (ui.vrPills) {
      ui.vrPills.querySelectorAll('.pl-vr-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-fid') === replay.filter);
      });
    }
    const favCount = replay.list.filter((x) => x.favorite).length;
    const normCount = replay.list.length - favCount;
    if (ui.vrMetaText) {
      ui.vrMetaText.textContent = `Favourites: ${favCount} (unlimited) · Recent: ${normCount} / ${S.replay.maxSaved} · ${fmtBytes(totalReplayBytes())}`;
    }
    if (ui.vrAutoRecBtn) {
      ui.vrAutoRecBtn.textContent = `Auto-Record: ${S.replay.autoRecord ? 'ON' : 'OFF'}`;
      ui.vrAutoRecBtn.classList.toggle('green', !!S.replay.autoRecord);
    }
    renderVanillaReplaysList();
  }

  function setVanillaReplaysModal(open) {
    ensureVanillaReplaysModal();
    vanillaModalOpen = !!open;
    ui.vrBackdrop.classList.toggle('open', vanillaModalOpen);
    applyCss();
    if (vanillaModalOpen) renderVanillaReplaysModal();
  }

  function applyVisuals() {
    if (root) {
      root.classList.toggle('glow', !!S.visuals.hudGlow);
    }
  }

  function checkKillEventsAndKillfeed() {
    if (!net.gameWs) return;

    const killEl = document.getElementById('ui-kill-counter') || document.querySelector('.js-ui-kills, .ui-kill-counter');
    if (killEl) {
      const curKills = parseInt(killEl.textContent || '0', 10);
      if (!isNaN(curKills) && curKills > net.lastKills) {
        net.lastKills = curKills;
        if (S.visuals.killSound) playKillSound();
        if (replay.recording && !replay.active && S.replay.killMarkers) {
          const t = Math.max(0, Math.round(performance.now() - replay.recording.startPerf));
          replay.recording.markers.push({ t, type: 'kill', label: `Kill #${curKills}` });
          replay.recording.meta.kills = curKills;
        }
      }
    }

    if (replay.recording && !replay.active) {
      const w1 = document.querySelector('#ui-weapon-id-1 .ui-weapon-name')?.textContent?.trim();
      const w2 = document.querySelector('#ui-weapon-id-2 .ui-weapon-name')?.textContent?.trim();
      const guns = [w1, w2].filter((w) => w && w !== 'Fists');
      if (guns.length) replay.recording.meta.weapons = guns;

      const rankEl = document.querySelector('.ui-stats-header-rank, #ui-stats-rank');
      const rankTxt = rankEl?.textContent?.trim() || '';
      if (rankTxt && /^#\d+/.test(rankTxt)) {
        replay.recording.meta.placement = rankTxt.match(/^#\d+/)[0];
      } else {
        const winBanner = document.getElementById('ui-stats-logo');
        if (winBanner && isVisibleEl(winBanner) && /winner|chicken/i.test(winBanner.textContent || '')) {
          replay.recording.meta.placement = '#1';
        }
      }
    }
  }

  /* =====================================================================
   *  Replay UI Updaters (In-Game Interactive Timeline + Pins)
   * ===================================================================== */
  function renderTimelineMarkers() {
    if (!ui.rhMarkers) return;
    ui.rhMarkers.textContent = '';
    if (!replay.active || !replay.activeData) return;
    const markers = replay.activeData.markers || [];
    const total = Math.max(1, replay.activeData.durationMs || 1);

    for (const m of markers) {
      const pct = clamp((m.t / total) * 100, 0, 100);
      const pin = h('button', {
        class: 'replay-pin' + (m.type === 'bookmark' ? ' bookmark' : ''),
        style: `left: ${pct.toFixed(2)}%;`,
        title: `${fmtShortDuration(m.t)} · ${m.label || (m.type === 'bookmark' ? 'Bookmark' : 'Kill')}`,
        onclick: (e) => {
          e.stopPropagation();
          seekReplayTo(Math.max(0, m.t - 2500));
        },
      });
      ui.rhMarkers.append(pin);
    }
  }

  function refreshReplayUI() {
    updateLobbyReplaysButton();
    if (vanillaModalOpen) renderVanillaReplaysModal();
    if (menuOpen && activeTab === 'replay') renderTab();
    updateReplayHud();
  }

  function updateReplayHud() {
    if (!ui.replayHud) return;
    ui.replayHud.hidden = !replay.active;
    if (!replay.active || !replay.activeData) return;

    const totalMs = Math.max(1, replay.activeData.durationMs || 1);
    const curMs = clamp(replay.virtualTimeMs, 0, totalMs);

    if (ui.rhBadge) {
      ui.rhBadge.textContent = replay.seeking ? 'SEEKING…' : replay.finished ? 'FINISHED' : 'REPLAY';
    }
    if (ui.rhTime && !ui.rhDragging) {
      ui.rhTime.textContent = `${fmtShortDuration(curMs)} / ${fmtShortDuration(totalMs)}`;
    }
    if (ui.rhTimeline && !ui.rhDragging) {
      ui.rhTimeline.max = totalMs;
      ui.rhTimeline.value = Math.round(curMs);
    }
    if (ui.rhPauseBtn) {
      ui.rhPauseBtn.textContent = replay.paused ? 'Play' : 'Pause';
    }
    if (ui.rhSpeedBtns) {
      for (const [spd, btn] of Object.entries(ui.rhSpeedBtns)) {
        btn.classList.toggle('active', Number(spd) === replay.speed);
      }
    }
  }

  /* =====================================================================
   *  Playlist Modal Renderer with Drag & Drop
   * ===================================================================== */
  let draggedTrackIdx = null;
  let playlistSearch = '';

  function renderPlaylistModal() {
    const pl = getActivePlaylist();
    ui.plSelect.innerHTML = '';
    S.music.playlists.forEach((p) => {
      const opt = h('option', { value: p.id }, p.name + ` (${p.tracks.length})`);
      if (p.id === S.music.activePlaylistId) opt.selected = true;
      ui.plSelect.appendChild(opt);
    });

    if (ui.plSearch && ui.plSearch.value !== playlistSearch) ui.plSearch.value = playlistSearch;
    const query = playlistSearch;
    const visibleTracks = pl.tracks
      .map((track, idx) => ({ track, idx }))
      .filter(({ track }) => {
        if (!query) return true;
        return [track.title, track.author, track.id].some((value) => String(value || '').toLowerCase().includes(query));
      });
    if (ui.plSummary) {
      ui.plSummary.textContent = query ? `${visibleTracks.length}/${pl.tracks.length} tracks` : `${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`;
    }

    ui.plList.innerHTML = '';
    if (!pl.tracks.length) {
      ui.plList.append(h('div', { class: 'note', style: 'text-align:center; padding: 20px 0;' }, 'Your playlist is empty.\nPaste a YouTube link above to add music!'));
    } else if (!visibleTracks.length) {
      ui.plList.append(h('div', { class: 'note', style: 'text-align:center; padding: 20px 0;' }, `No tracks match “${playlistSearch}”.`));
    } else {
      const moveTrack = (from, to) => {
        if (to < 0 || to >= pl.tracks.length || from === to) return;
        const moved = pl.tracks.splice(from, 1)[0];
        pl.tracks.splice(to, 0, moved);
        if (S.music.currentTrackIndex === from) S.music.currentTrackIndex = to;
        else if (S.music.currentTrackIndex === to) S.music.currentTrackIndex = from;
        else if (from < S.music.currentTrackIndex && to >= S.music.currentTrackIndex) S.music.currentTrackIndex--;
        else if (from > S.music.currentTrackIndex && to <= S.music.currentTrackIndex) S.music.currentTrackIndex++;
        save();
        renderPlaylistModal();
        updateMusicUI();
      };

      visibleTracks.forEach(({ track, idx }) => {
        const isActive = idx === S.music.currentTrackIndex;
        const dragHandle = h('span', { style: 'cursor: grab; opacity: 0.5; margin-right: 4px;' }, '⠿');
        const thumb = h('img', { class: 'pl-thumb', src: track.id ? `https://img.youtube.com/vi/${track.id}/mqdefault.jpg` : '', alt: '', loading: 'lazy' });
        thumb.addEventListener('error', () => { thumb.style.visibility = 'hidden'; });
        const titleEl = h('div', { class: 'pl-item-title' }, (isActive ? '▶ ' : '') + (track.title || 'Untitled video'));
        const authorEl = h('div', { class: 'pl-item-author' }, track.author || track.id || 'YouTube');
        const meta = h('div', { class: 'pl-item-meta' }, titleEl, authorEl);
        meta.addEventListener('click', () => playTrackByIndex(idx));

        const playBtn = h('button', { class: 'pl-btn', title: 'Play this track' }, '▶');
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playTrackByIndex(idx);
        });
        const upBtn = h('button', { class: 'pl-btn move-btn', title: 'Move up' }, '↑');
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveTrack(idx, idx - 1); });
        const downBtn = h('button', { class: 'pl-btn move-btn', title: 'Move down' }, '↓');
        downBtn.disabled = idx === pl.tracks.length - 1;
        downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveTrack(idx, idx + 1); });

        const delBtn = h('button', { class: 'pl-btn', title: 'Remove Track' }, '🗑');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const oldCurrent = S.music.currentTrackIndex;
          const removedCurrent = pl.id === S.music.activePlaylistId && oldCurrent === idx;
          pl.tracks.splice(idx, 1);
          if (oldCurrent > idx) S.music.currentTrackIndex = oldCurrent - 1;
          else if (oldCurrent === idx) S.music.currentTrackIndex = Math.min(idx, Math.max(0, pl.tracks.length - 1));
          else S.music.currentTrackIndex = Math.min(oldCurrent, Math.max(0, pl.tracks.length - 1));
          if (removedCurrent) stopMusicPlayback();
          save();
          renderPlaylistModal();
          updateMusicUI();
        });

        const actions = h('div', { class: 'pl-item-actions' }, playBtn, upBtn, downBtn, delBtn);
        const row = h(
          'div',
          { class: 'pl-item' + (isActive ? ' active' : ''), draggable: 'true' },
          dragHandle,
          thumb,
          meta,
          actions
        );

        row.addEventListener('dragstart', (e) => {
          draggedTrackIdx = idx;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drag-over');
          if (draggedTrackIdx !== null && draggedTrackIdx !== idx) {
            moveTrack(draggedTrackIdx, idx);
          }
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          draggedTrackIdx = null;
          shadow.querySelectorAll('.pl-item').forEach((el) => el.classList.remove('drag-over'));
        });

        ui.plList.append(row);
      });
    }
  }

  function exportPlaylistShareCode() {
    const pl = getActivePlaylist();
    const data = { name: pl.name, tracks: pl.tracks.map((t) => ({ id: t.id, title: t.title, author: t.author })) };
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    try {
      navigator.clipboard.writeText(code);
      toast('Share Code copied to clipboard!');
    } catch (_) {
      window.prompt('Copy playlist share code:', code);
    }
  }

  function importPlaylistShareCode() {
    const code = window.prompt('Paste Playlist Share Code:');
    if (!code) return;
    try {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!decoded.name || !Array.isArray(decoded.tracks)) throw new Error();
      const id = 'pl_' + Date.now();
      S.music.playlists.push({ id, name: decoded.name + ' (Imported)', tracks: decoded.tracks });
      S.music.activePlaylistId = id;
      S.music.currentTrackIndex = 0;
      save();
      renderPlaylistModal();
      playTrackByIndex(0);
      toast('Playlist imported successfully!');
    } catch (_) {
      toast('Invalid Playlist Share Code');
    }
  }

  /* =====================================================================
   *  Diagnostics & Profile Export
   * ===================================================================== */
  async function exportDiagnostics() {
    const diag = [
      `=== DANONANE CLIENT DIAGNOSTICS ===`,
      `Version: ${VERSION}`,
      `Date: ${new Date().toISOString()}`,
      `Ping: ${net.ping != null ? net.ping + 'ms' : 'Unknown'} (Min: ${net.minPing}ms, Max: ${net.maxPing}ms)`,
      `Game Socket: ${net.gameUrl || 'Lobby'}`,
      `Saved Replays: ${replay.list.length} (${replay.list.filter(r => r.favorite).length} fav)`,
      `Health Hook: ${document.getElementById('ui-health-actual') ? 'OK' : 'Missing'}`,
      `Playlists: ${S.music.playlists.length} | Tracks: ${getActivePlaylist().tracks.length}`,
      `Settings JSON:\n${JSON.stringify(S, null, 2)}`,
      `Recent Logs:\n${debugLogs.join('\n')}`,
      `===================================`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(diag);
      toast('Diagnostics copied to clipboard!');
    } catch (_) {
      window.prompt('Copy diagnostics:', diag);
    }
  }

  async function exportCfg() {
    const txt = JSON.stringify(S);
    try {
      await navigator.clipboard.writeText(txt);
      toast('Settings copied to clipboard');
    } catch (_) {
      window.prompt('Copy Danonane settings JSON:', txt);
    }
  }
  function importCfg() {
    const txt = window.prompt('Paste settings JSON:');
    if (!txt) return;
    try {
      S = merge(clone(DEFAULTS), JSON.parse(txt));
      save();
      applyAll();
      renderTab();
      toast('Settings successfully imported');
    } catch (_) {
      toast('Invalid settings JSON');
    }
  }
  function resetCfg() {
    if (!window.confirm('Reset all Danonane settings back to default?')) return;
    S = clone(DEFAULTS);
    save();
    applyAll();
    renderTab();
    toast('Settings reset to defaults');
  }

  let toastTimer = 0;
  function toast(msg) {
    if (!ui.toast) return;
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast?.classList.remove('show'), 2600);
  }

  /* =====================================================================
   *  Draggable Overlays
   * ===================================================================== */
  function statRow(label) {
    const v = h('span', { class: 'v' }, '--');
    return { row: h('div', { class: 'stat' }, h('span', { class: 'k' }, label), v), v };
  }

  function placePanel(el, key) {
    if (!el || !S.pos[key]) return;
    const p = S.pos[key];
    const pad = 70;
    el.style.left = clamp(p.x, 0, Math.max(0, innerWidth - pad)) + 'px';
    el.style.top = clamp(p.y, 0, Math.max(0, innerHeight - 40)) + 'px';
  }

  function makeDraggable(el, key, handle) {
    const grabEl = handle || el;
    grabEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, select, input, .x, .pl-btn, .replay-pin')) return;
      if (!menuOpen && key !== 'playlistModal' && key !== 'replayHud') return;

      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY, px: S.pos[key].x, py: S.pos[key].y };
      try {
        grabEl.setPointerCapture(e.pointerId);
      } catch (_) {}
      const move = (ev) => {
        S.pos[key].x = Math.round(start.px + ev.clientX - start.x);
        S.pos[key].y = Math.round(start.py + ev.clientY - start.y);
        placePanel(el, key);
      };
      const up = () => {
        grabEl.removeEventListener('pointermove', move);
        grabEl.removeEventListener('pointerup', up);
        grabEl.removeEventListener('pointercancel', up);
        S.pos[key].x = clamp(S.pos[key].x, 0, Math.max(0, innerWidth - 40));
        S.pos[key].y = clamp(S.pos[key].y, 0, Math.max(0, innerHeight - 40));
        placePanel(el, key);
        save();
      };
      grabEl.addEventListener('pointermove', move);
      grabEl.addEventListener('pointerup', up);
      grabEl.addEventListener('pointercancel', up);
    });
  }

  /* =====================================================================
   *  Apply All Settings
   * ===================================================================== */
  function applyAll() {
    applyCss();
    if (!root) return;
    const modern = S.ui.variant === 'modern';
    root.classList.toggle('ui-modern', modern);
    if (ui.variantStyle) ui.variantStyle.textContent = modern ? MODERN_CSS : '';
    root.style.setProperty('--accent', S.accent);
    root.style.setProperty('--scale', String(S.hud.scale / 100));
    root.style.setProperty('--opacity', String(S.hud.opacity / 100));

    ui.fps.row.hidden = !S.hud.fps;
    ui.ping.row.hidden = !S.hud.ping;
    ui.match.row.hidden = !S.hud.matchTimer;
    ui.clock.row.hidden = !S.hud.clock;
    ui.stats.hidden = !(S.hud.fps || S.hud.ping || S.hud.matchTimer || S.hud.clock);
    ui.keys.hidden = !S.hud.keystrokes;
    ui.cps.hidden = !S.hud.cps;
    ui.hudMusic.hidden = !S.hud.musicHud;

    placePanel(ui.stats, 'stats');
    placePanel(ui.keys, 'keys');
    placePanel(ui.hudMusic, 'musicHud');
    placePanel(ui.playlistModal, 'playlistModal');
    placePanel(ui.replayHud, 'replayHud');
    placePanel(ui.specCard, 'specCard');
    if (ui.hpLabel) ui.hpLabel.hidden = !S.hud.hpNumber;
    if (ui.boostLabel) ui.boostLabel.hidden = !S.hud.adrenalineNumber;

    applyVisuals();
    refreshReplayUI();
    updateServerDropdownPings();
    readBars();
    updatePreview();
    updateStats(ui.lastFps || 0);
    updateWeaponBorders();
  }

  /* =====================================================================
   *  Live Stats Loop
   * ===================================================================== */
  const clicks = [];
  function tone(el, cls) {
    el.classList.remove('good', 'ok', 'bad');
    if (cls) el.classList.add(cls);
  }

  function refreshCpsInstant() {
    const now = performance.now();
    while (clicks.length && now - clicks[0] > 1000) clicks.shift();
    if (ui.cps) ui.cps.textContent = 'CPS ' + clicks.length;
  }

  function updateStats(fps) {
    ui.lastFps = fps;
    ui.stats.classList.toggle('away', S.hud.onlyInGame && !net.gameWs);

    ui.fps.v.textContent = fps ? String(fps) : '--';
    tone(ui.fps.v, !fps ? '' : fps >= 90 ? 'good' : fps >= 50 ? 'ok' : 'bad');

    if (net.ping == null) {
      ui.ping.v.textContent = '--';
      tone(ui.ping.v, '');
    } else {
      ui.ping.v.textContent = net.ping + ' ms';
      tone(ui.ping.v, net.ping < 60 ? 'good' : net.ping < 120 ? 'ok' : 'bad');
    }

    ui.match.v.textContent = net.matchStart ? fmtTime((performance.now() - net.matchStart) / 1000) : '--:--';
    ui.clock.v.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    refreshCpsInstant();
    if (music.playing || (menuOpen && activeTab === 'music') || S.hud.musicHud || S.music.showVideo) updateMusicUI();
    updateReplayHud();
    if (menuOpen && activeTab === 'debug') renderTelemetry();
  }

  function startLoop() {
    let frames = 0;
    let last = performance.now();
    const tick = (now) => {
      frames++;
      if (now - last >= 500) {
        updateStats(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      if (replay.active) updateReplayHud();
      if (menuOpen && activeTab === 'music' && ui.visualizerCanvas?.isConnected && now - (tick.lastVisualizer || 0) >= 33) {
        tick.lastVisualizer = now;
        renderVisualizer(ui.visualizerCanvas);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* =====================================================================
   *  Health, Adrenaline & Spectator Corner Card
   * ===================================================================== */
  let bars = { hp: null, boost: [] };
  let observer = null;
  let vignetteEl = null;

  function isCurrentlySpectating() {
    return (
      isVisibleEl(document.getElementById('btn-spectate-next-player')) ||
      isVisibleEl(document.getElementById('btn-spectate-prev-player')) ||
      isVisibleEl(document.getElementById('ui-spectate-options'))
    );
  }

  function resolveBars() {
    const hpBar = document.getElementById('ui-health-actual');
    const boostHost = document.getElementById('ui-boost-counter');
    if (!hpBar || !boostHost) return false;

    const hpHost = hpBar.parentElement || document.getElementById('ui-health-container');
    const boost = Array.from(boostHost.querySelectorAll('.ui-boost-base .ui-bar-inner'));
    const changed = bars.hp !== hpBar || boost.length !== bars.boost.length;
    bars = { hp: hpBar, boost };

    if (!ui.hpLabel || !ui.hpLabel.isConnected) {
      ui.hpLabel = h('div', { class: 'pl-health-text' }, '100%');
      hpHost.style.position = 'relative';
      hpHost.appendChild(ui.hpLabel);
    }
    if (!ui.boostLabel || !ui.boostLabel.isConnected) {
      ui.boostLabel = h('div', { class: 'pl-boost-display' }, 'AD: 0%');
      boostHost.style.position = 'relative';
      boostHost.appendChild(ui.boostLabel);
    }

    if (!vignetteEl || !vignetteEl.isConnected) {
      vignetteEl = h('div', { id: 'pl-low-hp-vignette' });
      document.body.appendChild(vignetteEl);
    }

    ui.hpLabel.hidden = !S.hud.hpNumber;
    ui.boostLabel.hidden = !S.hud.adrenalineNumber;

    if (changed) {
      if (observer) observer.disconnect();
      observer = new MutationObserver(readBars);
      if (hpBar) observer.observe(hpBar, { attributes: true, attributeFilter: ['style'] });
      for (const el of boost) {
        if (el) observer.observe(el, { attributes: true, attributeFilter: ['style'] });
      }
    }
    return true;
  }

  function updateSpectatorCard(hp, avgBoost) {
    if (!ui.specCard) return;
    const isSpectating = isCurrentlySpectating();
    const showCard = S.hud.spectatorCard && !!net.gameWs && (isSpectating || menuOpen);
    ui.specCard.hidden = !showCard;
    if (!showCard) return;

    const hpColor = hp <= 25 ? '#ff6b6b' : hp <= 50 ? '#ffd166' : '#4ade80';
    const specNameRaw = isSpectating
      ? (document.getElementById('ui-spectate-text')?.textContent?.trim() ||
         document.querySelector('#ui-spectate-options .ui-spectate-player-name')?.textContent?.trim() ||
         '')
      : '';
    const kills =
      document.getElementById('ui-kill-counter')?.textContent?.trim() ||
      document.querySelector('.js-ui-kills, .ui-kill-counter')?.textContent?.trim() ||
      '0';
    const alive =
      document.getElementById('ui-players-alive')?.textContent?.trim() ||
      document.getElementById('ui-alive-counter')?.textContent?.trim() ||
      document.querySelector('.js-ui-players-alive')?.textContent?.trim() ||
      '--';

    ui.specName.textContent = specNameRaw ? specNameRaw : 'SPECTATING';
    ui.specMeta.textContent = `${kills} K · ${alive} Alive`;
    ui.specHpFill.style.width = `${hp}%`;
    ui.specHpFill.style.background = hpColor;
    ui.specHpVal.textContent = `${hp}%`;
    ui.specAdFill.style.width = `${avgBoost}%`;
    ui.specAdVal.textContent = `${avgBoost}%`;
  }

  function readBars() {
    if (!bars.hp || !ui.hpLabel) {
      updateSpectatorCard(100, 0);
      return;
    }

    const hpRaw = parseFloat(bars.hp.style.width || '0');
    const hp = clamp(isNaN(hpRaw) ? 0 : Math.round(hpRaw), 0, 100);
    const hpText = `${hp}%`;
    if (ui.hpLabel.textContent !== hpText) ui.hpLabel.textContent = hpText;

    ui.hpLabel.style.color = hp <= 25 ? '#ff6b6b' : hp <= 50 ? '#ffd166' : '#ffffff';

    if (vignetteEl) {
      const active = S.hud.lowHpAlert && hp > 0 && hp <= 25;
      vignetteEl.classList.toggle('active', active);
    }

    const weights = [25, 25, 40, 10];
    let totalBoost = 0;
    bars.boost.forEach((bar, i) => {
      const w = parseFloat(bar?.style?.width || '0');
      if (!isNaN(w)) totalBoost += w * ((weights[i] || 25) / 100);
    });
    const avgBoost = clamp(Math.round(totalBoost), 0, 100);
    const boostText = `AD: ${avgBoost}%`;
    if (ui.boostLabel.textContent !== boostText) ui.boostLabel.textContent = boostText;

    updateSpectatorCard(hp, avgBoost);
  }

  /* =====================================================================
   *  Gun Caliber Borders
   * ===================================================================== */
  function updateWeaponBorders() {
    const slots = document.querySelectorAll('.ui-weapon-switch');
    if (!slots || !slots.length) return;

    for (const slot of slots) {
      const isGun = slot.id === 'ui-weapon-id-1' || slot.id === 'ui-weapon-id-2' || slot.dataset.slot === '0' || slot.dataset.slot === '1';

      if (!S.ui.weaponBorders || !isGun) {
        slot.style.border = '';
        slot.style.boxShadow = '';
        continue;
      }

      const name = slot.querySelector('.ui-weapon-name')?.textContent?.trim();
      const color = name ? WEAPON_COLORS[name] : null;

      if (color) {
        slot.style.border = `2px solid ${color}`;
        slot.style.borderRadius = '8px';
        slot.style.boxShadow = S.visuals.hudGlow ? `0 0 14px ${color}66` : '';
      } else {
        slot.style.border = '2px solid rgba(255, 255, 255, 0.15)';
        slot.style.boxShadow = '';
      }
    }
  }

  /* =====================================================================
   *  Input Monitoring & Hotkeys
   * ===================================================================== */
  function isTypingTarget(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return true;
    const ae = document.activeElement;
    return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));
  }

  function installInput() {
    const handleKeyChange = (e, isDown) => {
      const code = e.code || '';
      const key = (e.key || '').toLowerCase();

      if (code === 'KeyW' || key === 'w' || code === 'ArrowUp') ui.kW.classList.toggle('on', isDown);
      if (code === 'KeyA' || key === 'a' || code === 'ArrowLeft') ui.kA.classList.toggle('on', isDown);
      if (code === 'KeyS' || key === 's' || code === 'ArrowDown') ui.kS.classList.toggle('on', isDown);
      if (code === 'KeyD' || key === 'd' || code === 'ArrowRight') ui.kD.classList.toggle('on', isDown);
    };

    const mk = { down: false, dirty: false };
    window.addEventListener(
      'keydown',
      (e) => {
        if (rebinding || booting) return;
        if (e.code === S.menuKey) {
          if (!e.repeat) {
            mk.down = true;
            mk.dirty = false;
          }
          return;
        }
        if (mk.down) mk.dirty = true;
        if (e.code === 'Escape') {
          if (vanillaModalOpen) {
            e.preventDefault();
            e.stopImmediatePropagation();
            setVanillaReplaysModal(false);
            return;
          }
          if (menuOpen) {
            e.preventDefault();
            e.stopImmediatePropagation();
            setMenu(false);
            return;
          }
        }
        if (!menuOpen && !vanillaModalOpen && !isTypingTarget(e)) {
          if (replay.active) {
            const speedHotkeys = { F1: 0.5, F2: 1, F3: 2, F4: 4, F5: 8, F6: 16 };
            if (e.code in speedHotkeys) {
              e.preventDefault();
              setReplaySpeed(speedHotkeys[e.code]);
            } else if (e.code === 'F7') {
              e.preventDefault();
              toggleReplayPause();
            } else if (e.code === 'ArrowLeft') {
              e.preventDefault();
              seekReplayTo(replay.virtualTimeMs - 5000);
            } else if (e.code === 'ArrowRight') {
              e.preventDefault();
              seekReplayTo(replay.virtualTimeMs + 5000);
            } else if (e.code === 'BracketLeft' && !e.repeat) {
              e.preventDefault();
              jumpToMarker(-1);
            } else if (e.code === 'BracketRight' && !e.repeat) {
              e.preventDefault();
              jumpToMarker(1);
            } else if (e.code === REPLAY_CINEMA_CODE && S.replay.cinemaHotkey && !e.repeat) {
              e.preventDefault();
              setCinemaMode(!replay.cinema);
            }
          } else if (replay.recording && net.gameWs && e.code === REPLAY_BOOKMARK_CODE && S.replay.bookmarkHotkey && !e.repeat) {
            const t = Math.max(0, Math.round(performance.now() - replay.recording.startPerf));
            replay.recording.markers.push({ t, type: 'bookmark', label: 'Bookmark' });
            toast(`Bookmark dropped at ${fmtShortDuration(t)}`);
          }
        }
        handleKeyChange(e, true);
      },
      true
    );

    window.addEventListener(
      'keyup',
      (e) => {
        handleKeyChange(e, false);
        if (e.code === S.menuKey && mk.down) {
          const clean = !mk.dirty;
          mk.down = false;
          if (clean && !rebinding) setMenu(!menuOpen);
        }
      },
      true
    );

    window.addEventListener(
      'mousedown',
      (e) => {
        if (e.button === 0) {
          ui.kL.classList.add('on');
          clicks.push(performance.now());
          refreshCpsInstant();
        } else if (e.button === 2) {
          ui.kR.classList.add('on');
        }
      },
      true
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) ui.kL.classList.remove('on');
        else if (e.button === 2) ui.kR.classList.remove('on');
      },
      true
    );

    window.addEventListener('blur', () => {
      [ui.kW, ui.kA, ui.kS, ui.kD, ui.kL, ui.kR].forEach((k) => k.classList.remove('on'));
      mk.down = false;
    });

    window.addEventListener('resize', () => {
      placePanel(ui.stats, 'stats');
      placePanel(ui.keys, 'keys');
      placePanel(ui.hudMusic, 'musicHud');
      placePanel(ui.playlistModal, 'playlistModal');
      placePanel(ui.replayHud, 'replayHud');
      placePanel(ui.specCard, 'specCard');
    });

    const onRegionChange = () => {
      if (!net.gameWs) startPing();
    };
    document.getElementById('server-select-main')?.addEventListener('change', onRegionChange);
    document.getElementById('team-server-select')?.addEventListener('change', onRegionChange);
  }

  function setMenu(open) {
    menuOpen = open;
    root.classList.toggle('open', open);
    if (!open) setPlaylistModal(false);
    applyCss();
    if (open) {
      renderedTab = null;
      renderTab();
    }
    readBars();
  }

  /* =====================================================================
   *  Boot Loader & UI Variant Picker
   * ===================================================================== */
  const VARIANT_ACCENT = { classic: '#67a646', modern: '#ff4fa3' };

  function setVariant(id) {
    const prev = S.ui.variant;
    // Swap the accent only if it is still the previous style's default; custom colours are kept.
    if (S.accent.toLowerCase() === VARIANT_ACCENT[prev === id ? (id === 'modern' ? 'classic' : 'modern') : prev]) {
      S.accent = VARIANT_ACCENT[id];
    }
    S.ui.variant = id;
    save();
    applyAll();
  }

  const BOOT_CSS = `
.boot { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(8,9,7,0.88); pointer-events: auto; color: #fff; transition: opacity 0.35s ease; animation: boot-fade 0.25s ease; }
.boot.out { opacity: 0; pointer-events: none; }
.boot.out .boot-card { translate: 0 -12px; scale: 0.96; }
.boot-card { width: min(520px, 100%); max-height: 100%; overflow: auto; padding: 24px; text-align: center; background: #272722; border: 2px solid #141411; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.8); transition: translate 0.35s ease, scale 0.35s ease; animation: boot-pop 0.4s cubic-bezier(0.2,1.3,0.4,1); }
.boot-logo { font-size: 30px; font-weight: 800; letter-spacing: 0.22em; text-shadow: 0 3px 0 rgba(0,0,0,0.5); }
.boot-sub { font-size: 12px; letter-spacing: 0.14em; color: rgba(255,255,255,0.45); margin: 4px 0 18px; }
.boot-stage { animation: boot-pop 0.35s cubic-bezier(0.2,1.2,0.4,1); }
.boot-track { height: 12px; padding: 2px; border-radius: 4px; background: #181814; border: 1px solid #44453a; }
.boot-fill { height: 100%; width: 0%; border-radius: 2px; background: repeating-linear-gradient(135deg, #67a646 0 8px, #538c38 8px 16px); background-size: 22.6px 100%; animation: boot-stripes 0.6s linear infinite; }
.boot-status { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; }
.boot-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.boot-choice { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.34); border: 2px solid rgba(255,255,255,0.1); transition: translate 0.18s ease, border-color 0.18s, box-shadow 0.18s; }
.boot-choice:hover, .boot-choice:focus-visible { translate: 0 -4px; box-shadow: 0 10px 24px rgba(0,0,0,0.5); }
.boot-choice.classic:hover, .boot-choice.classic:focus-visible, .boot-choice.classic.last { border-color: #67a646; }
.boot-choice.modern:hover, .boot-choice.modern:focus-visible, .boot-choice.modern.last { border-color: #ff4fa3; }
.mock { display: grid; grid-template-columns: 30% 1fr; height: 92px; overflow: hidden; border-radius: 4px; background: #272722; border: 1px solid #141411; }
.mock > div { display: flex; flex-direction: column; gap: 5px; padding: 7px; }
.mock > div:first-child { background: #1d1e19; }
.mock i { display: block; height: 9px; border-radius: 2px; background: #4a4b42; }
.mock > div:first-child i:nth-child(2) { background: #538c38; }
.mock > div:last-child i { height: 16px; background: #1b1c17; }
.modern .mock { background: #0e0c14; border-color: #3a2234; border-radius: 10px; }
.modern .mock > div:first-child { background: #16131d; }
.modern .mock i { border-radius: 6px; background: #231f2c; }
.modern .mock > div:first-child i:nth-child(2) { background: #ff4fa3; }
.modern .mock > div:last-child i { background: #1a1722; }
.boot-name { font-size: 16px; font-weight: 800; }
.boot-desc { font-size: 12px; color: rgba(255,255,255,0.5); }
.boot-remember { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.6); cursor: pointer; }
.boot-remember input { accent-color: #67a646; }
@keyframes boot-fade { from { opacity: 0; } }
@keyframes boot-pop { from { opacity: 0; translate: 0 14px; scale: 0.96; } }
@keyframes boot-stripes { to { background-position: 22.6px 0; } }
`;

  let booting = false;
  function runBootSequence() {
    booting = true;
    const fill = h('div', { class: 'boot-fill' });
    const status = h('span', {}, 'Starting…');
    const pct = h('span', {}, '0%');
    const stage = h('div', { class: 'boot-stage' }, h('div', { class: 'boot-track' }, fill), h('div', { class: 'boot-status' }, status, pct));
    const card = h('div', { class: 'boot-card' }, h('div', { class: 'boot-logo' }, 'DANONANE'), h('div', { class: 'boot-sub' }, 'CLIENT v' + VERSION), stage);
    const overlay = h('div', { class: 'boot' }, card);
    ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'wheel'].forEach((ev) =>
      overlay.addEventListener(ev, (e) => e.stopPropagation())
    );
    shadow.append(overlay);

    let onKey = null;
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      booting = false;
      if (onKey) window.removeEventListener('keydown', onKey, true);
      setVariant(id);
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 400);
      toast(`${id === 'modern' ? 'UI 2' : 'UI 1'} loaded · Press ${keyName(S.menuKey)} for settings`);
    };

    const showPicker = () => {
      const remember = h('input', { type: 'checkbox' });
      const choice = (id, name, desc) => {
        const side = h('div', {}, h('i'), h('i'), h('i'), h('i'));
        const body = h('div', {}, h('i'), h('i'), h('i'));
        return h('button', {
          class: `boot-choice ${id}` + (S.ui.variant === id ? ' last' : ''),
          onclick: () => {
            if (remember.checked) S.ui.askVariant = false;
            finish(id);
          },
        }, h('div', { class: 'mock' }, side, body), h('div', { class: 'boot-name' }, name), h('div', { class: 'boot-desc' }, desc));
      };
      const one = choice('classic', 'Load UI 1', 'Classic survev style');
      const two = choice('modern', 'Load UI 2', 'Modern dark glass');
      stage.replaceWith(
        h('div', { class: 'boot-stage' },
          h('div', { class: 'boot-choices' }, one, two),
          h('label', { class: 'boot-remember' }, remember, "Remember my choice (change it later in Settings)"))
      );
      onKey = (e) => {
        let id = null;
        if (e.code === 'Digit1' || e.code === 'Numpad1') id = 'classic';
        else if (e.code === 'Digit2' || e.code === 'Numpad2') id = 'modern';
        else if (e.code === 'Escape') id = S.ui.variant;
        if (!id) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        (id === 'modern' ? two : one).click();
      };
      window.addEventListener('keydown', onKey, true);
    };

    const steps = [[0, 'Starting…'], [18, 'Loading settings…'], [40, 'Hooking HUD…'], [62, 'Preparing replays…'], [82, 'Warming up music player…'], [100, 'Ready']];
    const DURATION = 1800;
    const t0 = performance.now();
    // A timer (not rAF) so the loader still finishes in a background tab.
    const timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / DURATION);
      const p = Math.round((1 - Math.pow(1 - k, 2)) * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      status.textContent = [...steps].reverse().find(([at]) => p >= at)[1];
      if (k < 1) return;
      clearInterval(timer);
      setTimeout(() => (S.ui.askVariant ? showPicker() : finish(S.ui.variant)), 250);
    }, 30);
  }

  /* =====================================================================
   *  Mount & Initialize
   * ===================================================================== */
  function mount() {
    addDebugLog('Mounting Danonane Client DOM...');
    root = document.createElement('div');
    root.id = 'Danonane-root';
    root.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    shadow = root.attachShadow({ mode: 'open' });
    ui.variantStyle = h('style');
    shadow.append(h('style', {}, SHADOW_CSS), ui.variantStyle, h('style', {}, BOOT_CSS));

    ui.fps = statRow('FPS');
    ui.ping = statRow('PING');
    ui.match = statRow('MATCH');
    ui.clock = statRow('TIME');
    ui.stats = h('div', { class: 'panel stats' }, ui.fps.row, ui.ping.row, ui.match.row, ui.clock.row);

    ui.kW = h('div', { class: 'key w' }, 'W');
    ui.kA = h('div', { class: 'key a' }, 'A');
    ui.kS = h('div', { class: 'key s' }, 'S');
    ui.kD = h('div', { class: 'key d' }, 'D');
    ui.kL = h('div', { class: 'key l' }, 'LMB');
    ui.kR = h('div', { class: 'key r' }, 'RMB');
    ui.cps = h('div', { class: 'cps' }, 'CPS 0');
    ui.keys = h('div', { class: 'panel keys' }, h('div', { class: 'kgrid' }, ui.kW, ui.kA, ui.kS, ui.kD, ui.kL, ui.kR), ui.cps);

    // Spectator Side Stats Card
    ui.specName = h('span', { class: 'spec-name' }, 'SPECTATING');
    ui.specMeta = h('span', { class: 'spec-meta' }, '0 K · -- Alive');
    ui.specHpFill = h('div', { class: 'spec-bar-hp' });
    ui.specHpVal = h('span', { class: 'spec-bar-val' }, '100%');
    ui.specAdFill = h('div', { class: 'spec-bar-ad' });
    ui.specAdVal = h('span', { class: 'spec-bar-val' }, '0%');
    ui.specCard = h(
      'div',
      { class: 'panel spec-card', hidden: true },
      h('div', { class: 'spec-head' }, ui.specName, ui.specMeta),
      h('div', { class: 'spec-bar-row' }, h('span', { class: 'spec-bar-lbl' }, 'HP'), h('div', { class: 'spec-bar-track' }, ui.specHpFill), ui.specHpVal),
      h('div', { class: 'spec-bar-row' }, h('span', { class: 'spec-bar-lbl' }, 'AD'), h('div', { class: 'spec-bar-track' }, ui.specAdFill), ui.specAdVal)
    );
    makeDraggable(ui.specCard, 'specCard');

    // Hidden file input for Replay loading
    ui.replayFileInput = h('input', {
      type: 'file',
      accept: '.svrep,.json,.har',
      style: 'display:none;',
    });
    ui.replayFileInput.addEventListener('change', () => {
      const f = ui.replayFileInput.files && ui.replayFileInput.files[0];
      if (f) loadReplayFileObject(f, false);
      ui.replayFileInput.value = '';
    });

    // In-Game Replay Control HUD with Kill/Bookmark Timeline Pins + Cinema Mode
    ui.rhBadge = h('span', { class: 'replay-badge' }, 'REPLAY');
    ui.rhTime = h('span', { style: 'font-variant-numeric: tabular-nums; opacity:0.85;' }, '0:00 / 0:00');
    const rhTop = h('div', { class: 'replay-hud-top' }, ui.rhBadge, ui.rhTime);

    ui.rhMarkers = h('div', { class: 'replay-markers' });
    ui.rhTimeline = h('input', { type: 'range', class: 'replay-timeline', min: 0, max: 1000, value: 0 });
    ui.rhTimeline.addEventListener('input', () => {
      ui.rhDragging = true;
      const total = replay.activeData?.durationMs || 0;
      if (ui.rhTime) {
        ui.rhTime.textContent = `${fmtShortDuration(Number(ui.rhTimeline.value))} / ${fmtShortDuration(total)}`;
      }
    });
    ui.rhTimeline.addEventListener('change', () => {
      ui.rhDragging = false;
      seekReplayTo(Number(ui.rhTimeline.value));
    });

    ui.rhTip = h('div', { class: 'replay-tip', hidden: true }, '0:00');
    const rhTimelineWrap = h('div', { class: 'replay-timeline-wrap' }, ui.rhTip, ui.rhMarkers, ui.rhTimeline);
    rhTimelineWrap.addEventListener('mousemove', (e) => {
      const r = ui.rhTimeline.getBoundingClientRect();
      const pct = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      ui.rhTip.hidden = false;
      ui.rhTip.style.left = pct * 100 + '%';
      ui.rhTip.textContent = fmtShortDuration(pct * (replay.activeData?.durationMs || 0));
    });
    rhTimelineWrap.addEventListener('mouseleave', () => { ui.rhTip.hidden = true; });

    const mkBtn = (cls, text, title, fn) => {
      const b = h('button', { class: 'rh-btn ' + cls, title }, text);
      b.addEventListener('click', fn);
      return b;
    };

    const rhPrevPinBtn = mkBtn('', 'Prev Pin', 'Previous kill / bookmark', () => jumpToMarker(-1));
    const rhBack10Btn = mkBtn('', '-10s', 'Back 10 seconds', () => seekReplayTo(replay.virtualTimeMs - 10000));
    ui.rhPauseBtn = mkBtn('play', 'Pause', 'Pause / Resume (F7)', () => toggleReplayPause());
    const rhFwd10Btn = mkBtn('', '+10s', 'Forward 10 seconds', () => seekReplayTo(replay.virtualTimeMs + 10000));
    const rhNextPinBtn = mkBtn('', 'Next Pin', 'Next kill / bookmark', () => jumpToMarker(1));
    const rhRestartBtn = mkBtn('', 'Restart', 'Restart replay', () => restartReplay());
    ui.rhCinemaBtn = mkBtn('', 'Cinema', 'Cinema mode (J)', () => setCinemaMode(!replay.cinema));
    const rhExitBtn = mkBtn('danger', 'Exit', 'Exit replay', () => exitReplay(false));

    ui.rhSpeedBtns = {};
    const speedWrap = h('div', { class: 'replay-speeds' });
    [0.5, 1, 2, 4, 8, 16].forEach((spd) => {
      const b = mkBtn('speed' + (spd === 1 ? ' active' : ''), spd + 'x', 'Speed ' + spd + 'x', () => setReplaySpeed(spd));
      ui.rhSpeedBtns[spd] = b;
      speedWrap.append(b);
    });

    ui.replayHud = h(
      'div',
      { class: 'panel replay-hud', hidden: true },
      rhTop,
      rhTimelineWrap,
      h('div', { class: 'replay-row spread' }, rhPrevPinBtn, rhBack10Btn, ui.rhPauseBtn, rhFwd10Btn, rhNextPinBtn),
      h('div', { class: 'replay-row spread' }, speedWrap, h('div', { class: 'replay-row' }, rhRestartBtn, ui.rhCinemaBtn, rhExitBtn))
    );
    makeDraggable(ui.replayHud, 'replayHud', rhTop);

    // Interactive HUD Mini Player
    ui.hudMThumb = h('img', { class: 'hud-mthumb', src: '', style: 'display:none;' });
    ui.hudMTitle = h('div', { class: 'hud-mtitle' }, 'No Track');
    ui.hudMTime = h('div', { class: 'hud-mtime' }, '00:00 / 00:00');
    ui.hudMPrev = h('button', { class: 'hud-mbtn', title: 'Previous' }, '⏮');
    ui.hudMPrev.addEventListener('click', (e) => { e.stopPropagation(); prevTrack(); });
    ui.hudMBtn = h('button', { class: 'hud-mbtn', title: 'Play / Pause' }, '▶');
    ui.hudMBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
    ui.hudMNext = h('button', { class: 'hud-mbtn', title: 'Next' }, '⏭');
    ui.hudMNext.addEventListener('click', (e) => { e.stopPropagation(); nextTrack(); });

    ui.hudMusic = h(
      'div',
      { class: 'panel hud-music', title: 'Click to open Music settings' },
      ui.hudMThumb,
      h('div', { class: 'hud-minfo' }, ui.hudMTitle, ui.hudMTime),
      h('div', { class: 'hud-mbtns' }, ui.hudMPrev, ui.hudMBtn, ui.hudMNext)
    );
    ui.hudMusic.addEventListener('click', () => {
      setMenu(true);
      activeTab = 'music';
      renderTab();
    });

    makeDraggable(ui.stats, 'stats');
    makeDraggable(ui.keys, 'keys');
    makeDraggable(ui.hudMusic, 'musicHud');

    /* ---------- Dedicated Playlist Manager GUI Modal ---------- */
    const plHeadTitle = h('h3', {}, '📑 PLAYLIST MANAGER');
    ui.plCloseBtn = h('button', { class: 'x' }, '✕');
    ui.plCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaylistModal(false);
    });
    const plHead = h('div', { class: 'pl-head' }, plHeadTitle, ui.plCloseBtn);

    ui.plSelect = h('select');
    ui.plSelect.addEventListener('change', () => {
      S.music.activePlaylistId = ui.plSelect.value;
      S.music.currentTrackIndex = 0;
      save();
      renderPlaylistModal();
      playTrackByIndex(0);
    });

    const newPlBtn = h('button', { class: 'btn', style: 'padding: 4px 8px; font-size: 11px;' }, '➕');
    newPlBtn.title = 'Create New Playlist';
    newPlBtn.addEventListener('click', () => {
      const name = window.prompt('Enter new playlist name:');
      if (!name) return;
      const id = 'pl_' + Date.now();
      S.music.playlists.push({ id, name, tracks: [] });
      S.music.activePlaylistId = id;
      S.music.currentTrackIndex = 0;
      save();
      renderPlaylistModal();
    });

    const renamePlBtn = h('button', { class: 'btn', style: 'padding: 4px 8px; font-size: 11px;' }, '✏️');
    renamePlBtn.title = 'Rename Current Playlist';
    renamePlBtn.addEventListener('click', () => {
      const pl = getActivePlaylist();
      const name = window.prompt('Rename playlist to:', pl.name);
      if (!name) return;
      pl.name = name;
      save();
      renderPlaylistModal();
    });

    const sharePlBtn = h('button', { class: 'btn', style: 'padding: 4px 8px; font-size: 11px;' }, '☁️ Share');
    sharePlBtn.title = 'Share Playlist Code';
    sharePlBtn.addEventListener('click', () => exportPlaylistShareCode());

    const importPlBtn = h('button', { class: 'btn', style: 'padding: 4px 8px; font-size: 11px;' }, '📥 Import');
    importPlBtn.title = 'Import Playlist Code';
    importPlBtn.addEventListener('click', () => importPlaylistShareCode());

    const delPlBtn = h('button', { class: 'btn danger', style: 'padding: 4px 8px; font-size: 11px;' }, '🗑');
    delPlBtn.title = 'Delete Playlist';
    delPlBtn.addEventListener('click', () => {
      if (S.music.playlists.length <= 1) {
        toast('Cannot delete the only playlist');
        return;
      }
      if (!window.confirm('Delete this playlist?')) return;
      const idx = S.music.playlists.findIndex((p) => p.id === S.music.activePlaylistId);
      if (idx !== -1) {
        if (S.music.playlists[idx].id === S.music.activePlaylistId) stopMusicPlayback();
        S.music.playlists.splice(idx, 1);
        S.music.activePlaylistId = S.music.playlists[0].id;
        S.music.currentTrackIndex = 0;
        save();
        renderPlaylistModal();
        playTrackByIndex(0);
      }
    });

    const clearTracksBtn = h('button', { class: 'btn danger', style: 'padding: 4px 8px; font-size: 11px;' }, 'Clear Tracks');
    clearTracksBtn.title = 'Remove every track from the current playlist';
    clearTracksBtn.addEventListener('click', () => {
      const pl = getActivePlaylist();
      if (!pl.tracks.length) return;
      if (!window.confirm(`Clear all ${pl.tracks.length} tracks from "${pl.name}"?`)) return;
      pl.tracks = [];
      S.music.currentTrackIndex = 0;
      if (pl.id === S.music.activePlaylistId) stopMusicPlayback();
      save();
      renderPlaylistModal();
      updateMusicUI();
    });

    const playFirstBtn = h('button', { class: 'btn', style: 'padding: 4px 8px; font-size: 11px;' }, '▶ Play');
    playFirstBtn.title = 'Play the first track in the current playlist';
    playFirstBtn.addEventListener('click', () => playTrackByIndex(0));

    const plTopBar = h('div', { class: 'pl-top-bar' }, ui.plSelect, playFirstBtn, newPlBtn, renamePlBtn, sharePlBtn, importPlBtn, clearTracksBtn, delPlBtn);

    ui.plSearch = h('input', { type: 'search', placeholder: 'Search this playlist…', autocomplete: 'off' });
    ui.plSummary = h('span', { class: 'pl-summary' }, '0 tracks');
    ui.plSearch.addEventListener('input', () => {
      playlistSearch = ui.plSearch.value.trim().toLowerCase();
      renderPlaylistModal();
    });
    const plSearchRow = h('div', { class: 'pl-search-row' }, ui.plSearch, ui.plSummary);

    const trackInput = h('input', { type: 'text', placeholder: 'Paste YouTube link or Video ID…', style: 'flex: 1;' });
    const addTrackBtn = h('button', { class: 'btn', style: 'padding: 6px 12px;' }, '➕ Add');
    addTrackBtn.addEventListener('click', () => {
      if (trackInput.value) {
        addTrackToActivePlaylist(trackInput.value, false);
        trackInput.value = '';
      }
    });
    const playNowBtn = h('button', { class: 'btn', style: 'padding: 6px 12px;' }, '▶ Add & Play');
    playNowBtn.addEventListener('click', () => {
      if (trackInput.value) {
        addTrackToActivePlaylist(trackInput.value, true);
        trackInput.value = '';
      }
    });
    trackInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTrackBtn.click();
    });
    const addTrackBar = h('div', { style: 'display: flex; gap: 6px; margin-bottom: 12px;' }, trackInput, addTrackBtn, playNowBtn);

    ui.plList = h('div', { class: 'pl-list' });
    const plBody = h('div', { class: 'pl-body' }, plTopBar, plSearchRow, addTrackBar, ui.plList);
    ui.playlistModal = h('div', { class: 'pl-modal' }, plHead, plBody);
    makeDraggable(ui.playlistModal, 'playlistModal', plHead);

    /* ---------- Main Settings Menu ---------- */
    const backdrop = h('div', { class: 'backdrop' });
    ui.tabBtns = {};
    const side = h('div', { class: 'side' }, h('div', { class: 'logo' }, 'DANONANE'), h('div', { class: 'ver' }, 'CLIENT v' + VERSION));
    for (const t of TABS) {
      const b = h('button', { class: 'tab' }, t.name);
      b.addEventListener('click', () => {
        activeTab = t.id;
        renderTab();
      });
      ui.tabBtns[t.id] = b;
      side.append(b);
    }
    ui.hintFoot = h('div', { class: 'hint-foot' });
    side.append(ui.hintFoot);

    ui.title = h('h2', {}, 'HUD');
    ui.content = h('div', { class: 'content' });
    const closeBtn = h('button', { class: 'x', title: 'Close' }, '✕');
    closeBtn.addEventListener('click', () => setMenu(false));
    const main = h('div', { class: 'main' }, h('div', { class: 'head' }, ui.title, closeBtn), ui.content);
    const win = h('div', { class: 'win' }, side, main);
    ui.toast = h('div', { class: 'toast' });

    const isolate = (el, evs) => evs.forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));
    isolate(backdrop, ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup']);
    isolate(win, ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress']);
    isolate(ui.playlistModal, ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress']);
    isolate(ui.hudMusic, ['mousedown', 'mouseup', 'click', 'dblclick']);
    isolate(ui.replayHud, ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup']);
    isolate(ui.specCard, ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup']);

    win.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    ui.playlistModal.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

    shadow.append(
      backdrop,
      ui.stats,
      ui.keys,
      ui.hudMusic,
      ui.specCard,
      ui.replayHud,
      ui.replayFileInput,
      win,
      ui.playlistModal,
      ui.toast
    );
    document.body.appendChild(root);

    const refreshHint = () => {
      ui.hintFoot.textContent = '';
      ui.hintFoot.append(h('b', {}, keyName(S.menuKey)), ' toggles this menu.');
    };
    refreshHint();
    setInterval(refreshHint, 2000);

    resolveBars();
    applyAll();
    installInput();
    startLoop();
    startPing();
    setTimeout(probeAllRegions, 600);
    setInterval(probeAllRegions, 60000);
    loadSavedReplays();

    setInterval(() => {
      resolveBars();
      readBars();
      updateWeaponBorders();
      checkKillEventsAndKillfeed();
      updateServerDropdownPings();
      updateLobbyReplaysButton();
    }, 350);

    addDebugLog(`DANONANE Client v${VERSION} mounted cleanly.`);
    runBootSequence();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
