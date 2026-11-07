'use strict';
/*
 * Schema — the character sheet data model, defaults, and normalization of untrusted input.
 * Store  — persistence in the browser's localStorage (never leaves the device).
 * Vault  — optional passphrase encryption for exported files (Web Crypto, AES-GCM + PBKDF2).
 */

const Schema = (() => {
  const VERSION = 1;
  const ABIL_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  const uid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

  const clone = o => JSON.parse(JSON.stringify(o));

  // Shapes of the objects stored in each list.
  const TEMPLATES = {
    class: { name: '', subclass: '', level: 1, hitDie: 8, caster: 'none' },
    attack: { name: '', bonus: '', damage: '', notes: '' },
    spell: {
      name: '', level: 0, school: '', castingTime: '', range: '', components: '', duration: '',
      concentration: false, ritual: false, prepared: false, description: '', source: '',
    },
    // armor: '' = work it out from the name/notes, 'none', 'light', 'medium', 'heavy', 'shield' or 'bonus'
    item: { name: '', qty: 1, weight: 0, equipped: false, notes: '', source: '', armor: '', acValue: 0 },
    // timing: '' = work it out from the text, or 'action', 'bonus', 'reaction', 'passive'
    feature: { name: '', origin: 'Other', source: '', description: '', timing: '' },
    // key is set on trackers that follow the class level; blank means the player manages it.
    resource: { key: '', name: '', max: 1, used: 0, recharge: 'long' },
    history: { id: '', date: '', type: 'note', summary: '', snapshot: null },
    // Imported class/subclass features the character hasn't reached yet; offered at level-up.
    pending: { className: '', subclass: '', level: 1, name: '', description: '', source: '' },
  };
  const LIST_TEMPLATES = {
    classes: 'class', attacks: 'attack', 'spellcasting.spells': 'spell',
    inventory: 'item', features: 'feature', history: 'history', pendingFeatures: 'pending', resources: 'resource',
  };
  const STRING_LISTS = ['combat.conditions', 'hiddenResources'];
  const FEATURE_ORIGINS =['Class', 'Race', 'Background', 'Feat', 'Statblock', 'Other'];

  function blank() {
    const now = new Date().toISOString();
    return {
      schemaVersion: VERSION, id: uid(), createdAt: now, updatedAt: now,
      // '' = custom/homebrew, '2014' = SRD 5.1 rules, '2024' = SRD 5.2 rules
      ruleset: '',
      name: '', player: '', race: '', background: '', alignment: '', xp: 0, inspiration: false,
      classes: [],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      saveProf: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
      skills: Object.fromEntries(Rules.SKILLS.map(s => [s.key, 0])),
      jackOfAllTrades: false,
      combat: {
        // acAuto: work AC out from equipped gear (acBonus is any extra). Off keeps `ac` as typed.
        ac: 10, acAuto: false, acBonus: 0, initBonus: 0, speed: 30, hpMax: 0, hpCurrent: 0, hpTemp: 0,
        hitDiceUsed: {},
        deathSaves: { success: [false, false, false], fail: [false, false, false] },
        // Session state used by the Play tab
        conditions: [],
        exhaustion: 0,
        concentration: '',
      },
      attacks: [],
      spellcasting: { ability: '', slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0, spells: [] },
      inventory: [],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      features: [],
      pendingFeatures: [],
      resources: [],
      hiddenResources: [], // class trackers the player removed or took over

      proficiencies: { armor: '', weapons: '', tools: '', languages: 'Common' },
      notes: { appearance: '', personality: '', ideals: '', bonds: '', flaws: '', backstory: '', general: '' },
      history: [],
    };
  }

  /** Recursively coerce `val` into the shape of `tpl`, reporting anything that had to be fixed. */
  function coerce(tpl, val, path, warn) {
    if (Array.isArray(tpl)) {
      if (val == null) return clone(tpl);
      if (!Array.isArray(val)) { warn(`"${path}" should be a list, so it was reset.`); return clone(tpl); }
      if (STRING_LISTS.includes(path)) return val.filter(v => typeof v === 'string').slice(0, 30);
      const itemTpl = TEMPLATES[LIST_TEMPLATES[path]];
      if (itemTpl) {
        return val.filter(v => v && typeof v === 'object' && !Array.isArray(v))
          .map((v, i) => coerce(itemTpl, v, `${path}.${i}`, warn));
      }
      return tpl.map((d, i) => coerce(d, val[i], `${path}.${i}`, warn));
    }
    if (tpl === null) return (val && typeof val === 'object') ? val : null; // history snapshots
    if (typeof tpl === 'object') {
      if (val == null) return clone(tpl);
      if (typeof val !== 'object' || Array.isArray(val)) {
        warn(`"${path || 'sheet'}" had the wrong shape, so it was reset.`);
        return clone(tpl);
      }
      const keys = Object.keys(tpl);
      if (keys.length === 0) { // free-form numeric map (hitDiceUsed)
        const o = {};
        for (const [k, v] of Object.entries(val)) if (Number.isFinite(Number(v))) o[k] = Number(v);
        return o;
      }
      const o = {};
      for (const k of keys) o[k] = coerce(tpl[k], val[k], path ? `${path}.${k}` : k, warn);
      return o;
    }
    if (typeof tpl === 'number') {
      if (val == null || val === '') return tpl;
      const n = Number(val);
      if (!Number.isFinite(n)) { warn(`"${path}" isn't a number ("${String(val).slice(0, 20)}"), so ${tpl} was used.`); return tpl; }
      return n;
    }
    if (typeof tpl === 'boolean') return val == null ? tpl : Boolean(val);
    if (typeof tpl === 'string') {
      if (val == null) return tpl;
      return typeof val === 'string' ? val : typeof val === 'object' ? JSON.stringify(val) : String(val);
    }
    return val;
  }

  /** Turn any object into a valid sheet. Throws only when the input can't be a sheet at all. */
  function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('A character must be a JSON object (something wrapped in { }).');
    }
    const warnings = [];
    const warn = m => { if (warnings.length < 50) warnings.push(m); };
    const sheet = coerce(blank(), input, '', warn);
    if (!sheet.id) sheet.id = uid();
    sheet.schemaVersion = VERSION;

    for (const k of ABIL_KEYS) {
      const v = Math.round(sheet.abilities[k]);
      const c = Math.max(1, Math.min(30, v));
      if (c !== sheet.abilities[k]) warn(`${k.toUpperCase()} score ${sheet.abilities[k]} is outside 1–30, so it was set to ${c}.`);
      sheet.abilities[k] = c;
    }
    for (const c of sheet.classes) {
      c.level = Rules.clampLevel(c.level);
      if (!Rules.CASTER_TYPES[c.caster]) c.caster = 'none';
    }
    if (!['', '2014', '2024'].includes(sheet.ruleset)) sheet.ruleset = '';
    sheet.combat.conditions = sheet.combat.conditions.filter(c => Rules.CONDITIONS.includes(c));
    sheet.combat.exhaustion = Math.max(0, Math.min(6, Math.round(sheet.combat.exhaustion)));
    for (const k of Object.keys(sheet.skills)) sheet.skills[k] = [0, 1, 2].includes(sheet.skills[k]) ? sheet.skills[k] : 0;
    for (const f of sheet.features) {
      if (!FEATURE_ORIGINS.includes(f.origin)) f.origin = 'Other';
      if (!['', 'action', 'bonus', 'reaction', 'passive'].includes(f.timing)) f.timing = '';
    }
    for (const it of sheet.inventory) if (!['', 'none', 'light', 'medium', 'heavy', 'shield', 'bonus'].includes(it.armor)) it.armor = '';
    for (const r of sheet.resources) {
      r.max = Math.max(1, Math.round(r.max));
      r.used = Math.max(0, Math.min(r.max, Math.round(r.used)));
      if (!['short', 'short1', 'long', 'none'].includes(r.recharge)) r.recharge = 'long';
    }
    return { sheet, warnings };
  }

  const isSheetLike = o => !!o && typeof o === 'object' && !Array.isArray(o)
    && !!o.abilities && typeof o.abilities === 'object' && ('classes' in o || 'skills' in o || 'combat' in o);

  return { VERSION, TEMPLATES, FEATURE_ORIGINS, uid, clone, blank, normalize, isSheetLike };
})();

const Store = (() => {
  const KEY = 'quillsheet.sheets.v1';
  const ACTIVE = 'quillsheet.active.v1';
  const PREFS = 'quillsheet.prefs.v1';

  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      return { sheets: {}, activeId: null, error: 'Your browser is blocking local storage (private mode or strict privacy settings). Changes will be lost when this tab closes — use Export to keep a copy.' };
    }
    if (!raw) return { sheets: {}, activeId: null };
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (_) { /* best effort */ }
      return { sheets: {}, activeId: null, error: `Saved data was damaged and couldn't be read. A raw copy was kept under "${KEY}.corrupt" in this browser's storage.` };
    }
    const sheets = {};
    const warnings = [];
    for (const s of Object.values((data && data.sheets) || {})) {
      try { const { sheet } = Schema.normalize(s); sheets[sheet.id] = sheet; } catch (e) { warnings.push(e.message); }
    }
    let activeId = null;
    try { activeId = localStorage.getItem(ACTIVE); } catch (_) { /* ignore */ }
    return { sheets, activeId: sheets[activeId] ? activeId : null, warnings };
  }

  function save(sheets, activeId) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), sheets }));
      if (activeId) localStorage.setItem(ACTIVE, activeId); else localStorage.removeItem(ACTIVE);
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        throw new Error('Browser storage is full. Export and delete characters you no longer use, or remove old timeline checkpoints.');
      }
      throw new Error(`Couldn't save to this browser's storage: ${e.message}`);
    }
  }

  function getPref(key, fallback) {
    try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); return key in p ? p[key] : fallback; } catch (_) { return fallback; }
  }
  function setPref(key, value) {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
      p[key] = value;
      localStorage.setItem(PREFS, JSON.stringify(p));
    } catch (_) { /* preferences are a convenience only */ }
  }

  return { load, save, getPref, setPref };
})();

const Vault = (() => {
  const ITERATIONS = 250000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const toB64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

  function ensureSupport() {
    if (!(window.crypto && crypto.subtle)) {
      throw new Error('Encryption needs a secure page (https:// or localhost). Open the site that way, or use the plain export.');
    }
  }

  async function deriveKey(pass, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(plainText, pass) {
    ensureSupport();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, ITERATIONS);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText)));
    return {
      format: 'quillsheet-encrypted', version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(ct),
    };
  }

  async function decrypt(box, pass) {
    ensureSupport();
    if (!box || !box.salt || !box.iv || !box.data) throw new Error('This encrypted file is incomplete or damaged.');
    try {
      const key = await deriveKey(pass, fromB64(box.salt), Number(box.iterations) || ITERATIONS);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
      return dec.decode(pt);
    } catch (e) {
      throw new Error('Wrong passphrase, or the file has been changed or damaged.');
    }
  }

  return { encrypt, decrypt };
})();
