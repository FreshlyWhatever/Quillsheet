'use strict';
/*
 * App — UI, state and the "living sheet" behaviour.
 *
 * Data flow:
 *   state.sheets (in memory) --edit--> setPath() --> commit() --> debounced Store.save()
 *   Inputs carry data-bind="path.to.field"; one delegated listener writes them back.
 *   Computed values (modifiers, DCs, totals) live in elements with data-derived="key"
 *   and are refreshed by renderDerived() without rebuilding inputs (so focus is kept).
 *   Buttons carry data-action="name"; one delegated click listener dispatches to `actions`.
 *
 * User text is only ever inserted with textContent / .value, never innerHTML.
 */
(() => {
  const { ABILITIES, SKILLS } = Rules;
  const fmt = Rules.fmtMod;
  const clone = Schema.clone;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = { sheets: {}, activeId: null, tab: 'overview', saveTimer: null, openKeys: new Set(), printing: false };
  state.tab = Store.getPref('tab', 'overview'); // remembered per device
  const MAX_SNAPSHOTS = 15;
  const MAX_HISTORY = 200;

  // ---------------------------------------------------------------- helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = true;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const toNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, p, v) {
    const keys = p.split('.');
    const last = keys.pop();
    const target = keys.reduce((x, k) => x[k], o);
    target[last] = v;
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const slug = s => (s || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  const rollDie = d => 1 + Math.floor(Math.random() * d);
  const dateText = iso => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return iso; } };

  function toast(message, kind = 'info') {
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), kind === 'error' ? 7000 : 3500);
    setTimeout(() => el.remove(), kind === 'error' ? 7600 : 4100);
  }

  function setStatus(text, kind = '') {
    const el = $('#save-status');
    el.textContent = text;
    el.dataset.kind = kind;
  }

  // ---------------------------------------------------------------- modal

  const dialog = $('#dialog');
  let modalClose = null;
  let modalToken = null; // identifies the modal currently shown, so a stale handler can't close a newer one

  function openModal({ title, body, actions = [], wide = false, onClose = null }) {
    if (dialog.open) closeModal();
    const token = {};
    modalToken = token;
    dialog.replaceChildren();
    dialog.className = `modal${wide ? ' wide' : ''}`;
    const foot = h('div', { class: 'modal-foot' }, actions.map(a => h('button', {
      type: 'button', class: `btn ${a.kind || ''}`,
      onclick: async () => { const keep = await (a.onClick ? a.onClick() : undefined); if (keep !== false) closeModal(token); },
    }, a.label)));
    dialog.append(
      h('div', { class: 'modal-head' },
        h('h2', { id: 'dialog-title' }, title),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close dialog', onclick: () => closeModal() }, '✕')),
      h('div', { class: 'modal-body' }, body),
      foot);
    modalClose = onClose;
    dialog.showModal();
    const first = dialog.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    if (first) first.focus();
  }

  function closeModal(token) {
    if (token && token !== modalToken) return;
    modalToken = null;
    const cb = modalClose;
    modalClose = null;
    if (dialog.open) dialog.close();
    if (cb) cb();
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });

  function confirmDialog({ title, message, ok = 'Confirm', danger = false }) {
    return new Promise(resolve => {
      let done = false;
      openModal({
        title, body: h('p', {}, message),
        actions: [
          { label: 'Cancel' },
          { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
        ],
        onClose: () => { if (!done) resolve(false); },
      });
    });
  }

  function passphraseDialog({ title, intro, confirm = false, ok = 'Continue' }) {
    return new Promise(resolve => {
      let done = false;
      const err = h('p', { class: 'field-error', role: 'alert' });
      const p1 = h('input', { type: 'password', id: 'pp1', autocomplete: 'new-password' });
      const p2 = confirm ? h('input', { type: 'password', id: 'pp2', autocomplete: 'new-password' }) : null;
      const body = h('div', {},
        h('p', { class: 'muted' }, intro),
        h('div', { class: 'field' }, h('label', { for: 'pp1' }, 'Passphrase'), p1),
        p2 && h('div', { class: 'field' }, h('label', { for: 'pp2' }, 'Repeat passphrase'), p2),
        err);
      const submit = () => {
        if (p1.value.length < (confirm ? 8 : 1)) { err.textContent = confirm ? 'Use at least 8 characters.' : 'Enter the passphrase.'; return false; }
        if (p2 && p1.value !== p2.value) { err.textContent = "The two passphrases don't match."; return false; }
        done = true; resolve(p1.value); return true;
      };
      body.addEventListener('keydown', e => { if (e.key === 'Enter' && submit()) closeModal(); });
      openModal({
        title, body,
        actions: [{ label: 'Cancel' }, { label: ok, kind: 'primary', onClick: submit }],
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  // ---------------------------------------------------------------- persistence

  const active = () => state.sheets[state.activeId] || null;

  function persist() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try {
      Store.save(state.sheets, state.activeId);
      setStatus('Saved on this device', 'ok');
    } catch (e) {
      setStatus('Not saved', 'error');
      toast(e.message, 'error');
    }
  }

  function scheduleSave() {
    setStatus('Saving…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persist, 350);
  }

  function commit({ rerender = false, roster = false } = {}) {
    const s = active();
    if (s) s.updatedAt = new Date().toISOString();
    scheduleSave();
    if (rerender) renderTab(); else renderDerived();
    if (roster) renderRoster();
  }

  // ---------------------------------------------------------------- history (living sheet)

  function snapshotOf(sheet) {
    const c = clone(sheet);
    delete c.history;
    return c;
  }

  function logHistory(sheet, type, summary, snapshot = null) {
    sheet.history.unshift({ id: Schema.uid(), date: new Date().toISOString(), type, summary, snapshot });
    let kept = 0;
    for (const entry of sheet.history) {
      if (entry.snapshot && ++kept > MAX_SNAPSHOTS) entry.snapshot = null;
    }
    if (sheet.history.length > MAX_HISTORY) sheet.history.length = MAX_HISTORY;
  }

  // ---------------------------------------------------------------- sheet creation

  function createSheet({ name = '', race = '', background = '', className = '', custom = null } = {}) {
    const s = Schema.blank();
    Object.assign(s, { name, race, background });
    s.combat.acAuto = true;
    const info = custom || (className && Rules.classInfo(className));
    if (info) {
      s.classes.push({ name: info.name, subclass: '', level: 1, hitDie: info.hitDie, caster: info.caster || 'none' });
      (info.saves || []).forEach(a => { s.saveProf[a] = true; });
      if (info.spellAbility) s.spellcasting.ability = info.spellAbility;
      s.combat.hpMax = s.combat.hpCurrent = info.hitDie + Rules.mod(s.abilities.con);
    }
    logHistory(s, 'created', `Character created${info ? ` as a level 1 ${info.name}` : ''}`);
    state.sheets[s.id] = s;
    return s;
  }

  function openSheet(id) {
    state.activeId = id;
    state.openKeys.clear();
    closeRoster();
    persist();
    render();
    $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- derived values

  function derive(s) {
    const d = {};
    const lvl = Rules.totalLevel(s);
    const pb = Rules.profBonus(lvl);
    for (const a of ABILITIES) {
      d[`mod.${a.key}`] = fmt(Rules.mod(s.abilities[a.key]));
      d[`save.${a.key}`] = fmt(Rules.saveBonus(s, a.key));
    }
    for (const sk of SKILLS) d[`skill.${sk.key}`] = fmt(Rules.skillBonus(s, sk.key));
    d.passivePerception = String(10 + Rules.skillBonus(s, 'perception'));
    d.passiveInsight = String(10 + Rules.skillBonus(s, 'insight'));
    d.passiveInvestigation = String(10 + Rules.skillBonus(s, 'investigation'));
    d.pb = fmt(pb);
    d.level = String(lvl);
    d.initiative = fmt(Rules.mod(s.abilities.dex) + (Number(s.combat.initBonus) || 0));
    d.classSummary = Rules.classSummary(s) || 'No class yet';
    d.raceLine = [s.race, s.background].filter(Boolean).join(' · ') || 'Race & background not set';
    const next = lvl < 20 ? Rules.XP_THRESHOLDS[Math.max(1, lvl)] : null;
    d.xpText = next ? `${(s.xp || 0).toLocaleString()} / ${next.toLocaleString()} XP` : `${(s.xp || 0).toLocaleString()} XP`;
    const ab = s.spellcasting.ability;
    d.spellDc = ab ? String(8 + pb + Rules.mod(s.abilities[ab])) : '—';
    d.spellAtk = ab ? fmt(pb + Rules.mod(s.abilities[ab])) : '—';
    d.carry = `${Rules.inventoryWeight(s)} / ${s.abilities.str * 15} lb`;
    d.hpText = `${s.combat.hpCurrent}${s.combat.hpTemp ? ` (+${s.combat.hpTemp})` : ''} / ${s.combat.hpMax}`;
    const ac = s.combat.acAuto ? Rules.armorClass(s) : null;
    d.ac = String(ac ? ac.total : s.combat.ac);
    d.acBreakdown = ac ? ac.parts.join(' + ') : '';
    return d;
  }

  /** Keep class trackers in step with the character's classes, levels and scores. */
  function syncResources(s) {
    const auto = Rules.classResources(s);
    const keys = new Set(auto.map(a => a.key));
    s.resources = s.resources.filter(r => !r.key || keys.has(r.key));
    for (const a of auto) {
      if (s.hiddenResources.includes(a.key)) continue;
      const r = s.resources.find(x => x.key === a.key);
      if (r) Object.assign(r, { name: a.name, max: a.max, recharge: a.recharge });
      else if (!s.resources.some(x => sameName(x.name, a.name))) s.resources.push({ ...a, used: 0 });
    }
    for (const r of s.resources) r.used = Math.min(Math.max(1, r.max), r.used);
  }

  function renderDerived() {
    const s = active();
    if (!s) return;
    if (s.combat.acAuto) s.combat.ac = Rules.armorClass(s).total;
    const d = derive(s);
    $$('[data-derived]').forEach(el => {
      const v = d[el.dataset.derived];
      if (v !== undefined && el.textContent !== v) el.textContent = v;
    });
    const lvl = Rules.totalLevel(s);
    const lo = Rules.XP_THRESHOLDS[Math.max(0, lvl - 1)] || 0;
    const hi = lvl < 20 ? Rules.XP_THRESHOLDS[Math.max(1, lvl)] : null;
    const xpPct = hi ? Math.max(0, Math.min(100, ((s.xp - lo) / (hi - lo)) * 100)) : 100;
    $$('[data-bar="xp"]').forEach(el => { el.style.width = `${xpPct}%`; });
    const hpPct = s.combat.hpMax > 0 ? Math.max(0, Math.min(100, (s.combat.hpCurrent / s.combat.hpMax) * 100)) : 0;
    $$('[data-bar="hp"]').forEach(el => {
      el.style.width = `${hpPct}%`;
      el.dataset.level = hpPct <= 25 ? 'low' : hpPct <= 50 ? 'mid' : 'high';
    });
    const ready = lvl > 0 && lvl < 20 && Rules.levelForXp(s.xp) > lvl;
    $$('[data-show="levelReady"]').forEach(el => { el.hidden = !ready; });
  }

  // ---------------------------------------------------------------- form building blocks

  let fieldSeq = 0;
  function field(label, path, value, opts = {}) {
    const id = `f${++fieldSeq}`;
    const data = { bind: path, ...(opts.data || {}) };
    if (opts.type === 'number' || opts.num) data.num = '1';
    let input;
    if (opts.textarea) {
      input = h('textarea', { id, rows: opts.rows || 3, placeholder: opts.placeholder || null, dataset: data });
      input.value = value == null ? '' : value;
    } else if (opts.options) {
      input = h('select', { id, dataset: data },
        opts.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
    } else {
      input = h('input', {
        id, type: opts.type || 'text', value: value == null ? '' : value, min: opts.min, max: opts.max, step: opts.step,
        inputmode: opts.type === 'number' ? (opts.step ? 'decimal' : 'numeric') : null,
        placeholder: opts.placeholder || null, autocomplete: 'off', dataset: data,
      });
    }
    return h('div', { class: `field ${opts.class || ''}` }, h('label', { for: id }, label), input);
  }

  function check(label, path, value, opts = {}) {
    return h('label', { class: `check ${opts.class || ''}` },
      h('input', { type: 'checkbox', checked: !!value, dataset: { bind: path, ...(opts.data || {}) }, 'aria-label': opts.aria || null }),
      h('span', {}, label));
  }

  const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...kids);
  const derived = (key, extra = {}) => h('span', { dataset: { derived: key }, ...extra });
  const btn = (label, action, extra = {}) => {
    const { data, kind, ...rest } = extra;
    return h('button', { type: 'button', class: `btn ${kind || ''}`, dataset: { action, ...(data || {}) }, ...rest }, label);
  };
  /** A computed bonus: plain text normally, or a tap-to-roll button when "Roll dice for me" is on. */
  const rollable = (kind, key, derivedKey, cls = '') => (playPref('diceRoller')
    ? h('button', { type: 'button', class: `roll-val ${cls}`, 'aria-label': `Roll ${checkInfo(active(), kind, key).name}`, dataset: { action: 'roll-check', kind, key } }, derived(derivedKey))
    : derived(derivedKey, { class: cls }));

  function filterBox(group, placeholder) {
    return h('input', { type: 'search', class: 'filter', placeholder, 'aria-label': placeholder, dataset: { filter: group } });
  }

  /** Collapsible editable row used by spells, inventory and features. */
  function rowDetails(key, summaryKids, bodyKids, search) {
    const det = h('details', { class: 'row-details', dataset: { key, filterRow: key.split(':')[0], search: (search || '').toLowerCase() } },
      h('summary', {}, summaryKids), h('div', { class: 'row-body' }, bodyKids));
    if (state.openKeys.has(key) || state.printing) det.open = true;
    return det;
  }

  // ---------------------------------------------------------------- layout rendering

  function render() {
    renderRoster();
    renderMain();
  }

  function renderRoster() {
    const list = $('#roster-list');
    const sheets = Object.values(state.sheets).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    list.replaceChildren(...sheets.map(s => h('li', {},
      h('button', {
        type: 'button', class: `roster-item${s.id === state.activeId ? ' active' : ''}`,
        'aria-current': s.id === state.activeId ? 'true' : null, dataset: { action: 'open', id: s.id },
      },
      h('span', { class: 'roster-name' }, s.name || 'Unnamed hero'),
      h('span', { class: 'roster-meta' }, `Lv ${Rules.totalLevel(s)} · ${Rules.classSummary(s) || 'No class'}`)))));
    if (!sheets.length) list.append(h('li', { class: 'roster-empty' }, 'No characters yet.'));
  }

  function renderMain() {
    const main = $('#main');
    const s = active();
    if (!s) { main.replaceChildren(emptyState()); renderBottomNav(); return; }
    main.replaceChildren(sheetHeader(s), tabBar(), h('div', { id: 'tab-panel', class: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` }));
    renderBottomNav();
    renderTab();
  }

  function renderTab() {
    const s = active();
    const panel = $('#tab-panel');
    if (!s || !panel) return;
    syncResources(s);
    if (state.printing) {
      // The Play tab is a live table view; everything it shows is also on the other tabs.
      panel.replaceChildren(...TABS.filter(t => t[0] !== 'play').map(([, label, build]) => h('div', { class: 'print-section' }, h('h2', { class: 'print-title' }, label), build(s))));
    } else {
      const tab = TABS.find(t => t[0] === state.tab) || TABS[0];
      panel.replaceChildren(tab[2](s));
    }
    renderDerived();
  }

  const startButton = (icon, title, text, action, primary = false) => h('button', {
    type: 'button', class: `start-btn${primary ? ' primary' : ''}`, dataset: { action },
  }, h('span', { class: 'start-icon', 'aria-hidden': 'true' }, icon), h('strong', {}, title), h('span', { class: 'start-text' }, text));

  function emptyState() {
    return h('div', { class: 'empty' },
      h('div', { class: 'card hero' },
        h('h2', {}, 'Your adventuring party starts here'),
        h('p', {}, 'Build a D&D 5e character in minutes, paste in your own homebrew spells, items and features, and keep the sheet growing as your character levels up. Everything is saved in this browser only.'),
        h('div', { class: 'start-grid' },
          startButton('⚡', 'Quick Build', 'A finished character in about a minute: 2014 or 2024 rules, plus your homebrew.', 'quick-build', true),
          startButton('📥', 'Import Homebrew', 'Add your own subclasses, classes, races and backgrounds to pick in Quick Build.', 'import-library'),
          startButton('✏️', 'Fully custom', 'Start from a blank sheet and fill in anything you like.', 'new-character'),
          startButton('📂', 'Open saved file', 'Load a character you exported or backed up.', 'open-file')),
        h('ul', { class: 'hero-points' },
          h('li', {}, h('strong', {}, 'Quick Build: '), 'pick a class, race and level (1–20) and get a finished, playable sheet using the 2014 or 2024 rules.'),
          h('li', {}, h('strong', {}, 'Auto-calculated: '), 'modifiers, saves, skills, spell DCs and slots (including multiclass).'),
          h('li', {}, h('strong', {}, 'Homebrew import: '), 'paste copied text or JSON and review it before it is added.'),
          h('li', {}, h('strong', {}, 'Living sheet: '), 'a level-up wizard and a timeline you can roll back.'),
          h('li', {}, h('strong', {}, 'Private: '), 'no accounts, no tracking, no server. ', h('a', { href: 'privacy.html' }, 'Privacy policy')))));
  }

  function sheetHeader(s) {
    return h('header', { class: 'sheet-head card' },
      h('div', { class: 'identity' },
        h('input', { class: 'name-input', 'aria-label': 'Character name', placeholder: 'Character name', value: s.name, autocomplete: 'off', dataset: { bind: 'name', roster: '1' } }),
        h('p', { class: 'subtitle' }, derived('classSummary'), h('span', { class: 'dot', 'aria-hidden': 'true' }, ' · '), derived('raceLine'))),
      h('div', { class: 'head-stats' },
        h('div', { class: 'stat-pill' }, h('span', { class: 'label' }, 'Level'), derived('level', { class: 'value' })),
        h('div', { class: 'stat-pill' }, h('span', { class: 'label' }, 'Prof.'), derived('pb', { class: 'value' })),
        h('div', { class: 'xp' },
          h('div', { class: 'xp-top' }, derived('xpText'), h('span', { class: 'badge gold', hidden: true, dataset: { show: 'levelReady' } }, 'Level up ready!')),
          h('div', { class: 'bar', role: 'presentation' }, h('div', { class: 'bar-fill xp-fill', dataset: { bar: 'xp' } })))),
      h('div', { class: 'head-actions' },
        btn('Level up', 'level-up', { kind: 'primary' }),
        btn('Import Homebrew', 'import'),
        btn('Save / export', 'export'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete character', title: 'Delete character', dataset: { action: 'delete-character' } }, '🗑')));
  }

  // [key, desktop label, builder, phone label, phone icon]. Phone bar shows the first five keys in
  // BOTTOM_TABS; the rest live under "More".
  const TABS = [
    ['play', 'Play', s => buildPlay(s), 'Play', '⚔️'],
    ['overview', 'Overview', s => buildOverview(s), 'Stats', '📜'],
    ['spells', 'Spells', s => buildSpells(s), 'Spells', '✨'],
    ['inventory', 'Inventory', s => buildInventory(s), 'Gear', '🎒'],
    ['features', 'Features', s => buildFeatures(s), 'Features', '🏅'],
    ['notes', 'Notes', s => buildNotes(s), 'Notes', '📝'],
    ['progression', 'Progression', s => buildProgression(s), 'Progression', '📈'],
  ];
  const BOTTOM_TABS = ['play', 'overview', 'spells', 'inventory'];
  const MORE_TABS = ['features', 'notes', 'progression'];

  function tabBar() {
    return h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sheet sections' },
      TABS.map(([key, label]) => h('button', {
        type: 'button', role: 'tab', id: `tab-${key}`, class: 'tab', 'aria-selected': String(key === state.tab),
        tabindex: key === state.tab ? '0' : '-1', dataset: { action: 'tab', tab: key },
      }, label)));
  }

  /** Thumb-friendly navigation for phones (shown by CSS under 760px; the top tabs hide there). */
  function renderBottomNav() {
    const nav = $('#bottom-nav');
    if (!active()) { nav.hidden = true; return; }
    nav.hidden = false;
    const tab = key => TABS.find(t => t[0] === key);
    const moreActive = MORE_TABS.includes(state.tab);
    const moreLabel = moreActive ? tab(state.tab)[3] : 'More';
    nav.replaceChildren(
      ...BOTTOM_TABS.map(key => {
        const [, , , label, icon] = tab(key);
        return h('button', {
          type: 'button', class: 'bn-item', 'aria-current': key === state.tab ? 'page' : null, dataset: { action: 'tab', tab: key },
        }, h('span', { class: 'bn-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'bn-label' }, label));
      }),
      h('button', {
        type: 'button', class: 'bn-item', 'aria-current': moreActive ? 'page' : null, 'aria-haspopup': 'true',
        'aria-expanded': 'false', 'aria-controls': 'bn-more', dataset: { action: 'more-menu' },
      }, h('span', { class: 'bn-icon', 'aria-hidden': 'true' }, moreActive ? tab(state.tab)[4] : '☰'), h('span', { class: 'bn-label' }, moreLabel)),
      h('div', { id: 'bn-more', class: 'bn-more', hidden: true, role: 'menu' },
        MORE_TABS.map(key => {
          const [, , , label, icon] = tab(key);
          return h('button', { type: 'button', role: 'menuitem', class: `bn-more-item${key === state.tab ? ' on' : ''}`, dataset: { action: 'tab', tab: key } },
            h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`);
        })));
  }

  function closeMoreMenu() {
    const menu = $('#bn-more');
    if (menu) menu.hidden = true;
    const btn0 = $('[data-action="more-menu"]');
    if (btn0) btn0.setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------- Overview tab

  function buildOverview(s) {
    return h('div', { class: 'grid overview' }, abilitiesCard(s), combatCard(s), skillsCard(s), attacksCard(s), identityCard(s), profsCard(s));
  }

  function abilitiesCard(s) {
    return card('Abilities & saves', h('div', { class: 'abilities' }, ABILITIES.map(a => {
      const id = `ab-${a.key}`;
      return h('div', { class: 'ability' },
        h('label', { for: id, class: 'ab-label', title: a.name }, a.short),
        rollable('ability', a.key, `mod.${a.key}`, 'ab-mod'),
        h('input', { id, class: 'ab-score', type: 'number', min: 1, max: 30, inputmode: 'numeric', value: s.abilities[a.key], dataset: { bind: `abilities.${a.key}`, num: '1' } }),
        h('div', { class: 'save' },
          h('label', { class: 'save-prof', title: `${a.name} saving throw proficiency` },
            h('input', { type: 'checkbox', checked: s.saveProf[a.key], dataset: { bind: `saveProf.${a.key}` } }),
            h('span', {}, 'Save ')),
          rollable('save', a.key, `save.${a.key}`, 'strong')));
    })));
  }

  const RANK_LABEL = ['Not proficient', 'Proficient', 'Expertise'];
  const RANK_ICON = ['○', '●', '◉'];

  function skillsCard(s) {
    return card('Skills',
      h('ul', { class: 'skills' }, SKILLS.map(sk => h('li', { class: 'skill' },
        h('button', {
          type: 'button', class: 'rank', dataset: { action: 'cycle-skill', key: sk.key, rank: s.skills[sk.key] },
          'aria-label': `${sk.name}: ${RANK_LABEL[s.skills[sk.key]]}. Click to change.`, title: RANK_LABEL[s.skills[sk.key]],
        }, RANK_ICON[s.skills[sk.key]]),
        h('span', { class: 'skill-name' }, sk.name, h('abbr', { class: 'muted', title: sk.ability.toUpperCase() }, ` ${sk.ability.toUpperCase()}`)),
        rollable('skill', sk.key, `skill.${sk.key}`, 'skill-val')))),
      h('div', { class: 'passives' },
        h('div', {}, h('span', { class: 'muted' }, 'Passive Perception '), derived('passivePerception', { class: 'strong' })),
        h('div', {}, h('span', { class: 'muted' }, 'Insight '), derived('passiveInsight', { class: 'strong' })),
        h('div', {}, h('span', { class: 'muted' }, 'Investigation '), derived('passiveInvestigation', { class: 'strong' }))),
      check('Jack of All Trades (half proficiency on other skills)', 'jackOfAllTrades', s.jackOfAllTrades),
      h('p', { class: 'hint' }, '○ none · ● proficient · ◉ expertise — click to cycle.'));
  }

  function combatCard(s) {
    const c = s.combat;
    const pools = Rules.hitDicePools(s);
    return card('Combat',
      h('div', { class: 'combat-stats' },
        c.acAuto
          ? h('div', { class: 'field big' }, h('span', { class: 'label' }, 'Armor Class'), derived('ac', { class: 'big-value' }))
          : field('Armor Class', 'combat.ac', c.ac, { type: 'number', class: 'big' }),
        h('div', { class: 'field big' }, h('span', { class: 'label' }, 'Initiative'), rollable('init', '', 'initiative', 'big-value')),
        field('Speed (ft)', 'combat.speed', c.speed, { type: 'number', class: 'big' })),
      h('div', { class: 'ac-auto' },
        check('Work out AC automatically', 'combat.acAuto', c.acAuto, { data: { rerender: '1' } }),
        c.acAuto ? h('p', { class: 'hint' }, derived('acBreakdown'), '. Tick armor and shields as equipped on the Gear tab.') : null,
        c.acAuto ? field('Other AC bonus (fighting style, spell…)', 'combat.acBonus', c.acBonus, { type: 'number', class: 'tiny' }) : null),
      h('div', { class: 'hp-block' },
        h('div', { class: 'hp-head' }, h('span', { class: 'label' }, 'Hit points'), derived('hpText', { class: 'strong' })),
        h('div', { class: 'bar hp' }, h('div', { class: 'bar-fill', dataset: { bar: 'hp' } })),
        h('div', { class: 'hp-fields' },
          field('Current', 'combat.hpCurrent', c.hpCurrent, { type: 'number' }),
          field('Max', 'combat.hpMax', c.hpMax, { type: 'number', min: 0 }),
          field('Temp', 'combat.hpTemp', c.hpTemp, { type: 'number', min: 0 })),
        h('div', { class: 'hp-quick' },
          h('label', { for: 'hp-amount', class: 'sr-only' }, 'Amount'),
          h('input', { id: 'hp-amount', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Amount' }),
          btn('Damage', 'hp-damage', { kind: 'danger-soft' }),
          btn('Heal', 'hp-heal', { kind: 'ok-soft' }))),
      h('div', { class: 'sub' },
        h('h4', {}, 'Hit dice'),
        Object.keys(pools).length ? h('ul', { class: 'hd-list' }, Object.entries(pools).map(([die, total]) => {
          const used = Math.min(total, c.hitDiceUsed[die] || 0);
          return h('li', {},
            h('span', {}, `d${die}: `, h('strong', {}, `${total - used}`), ` of ${total} left`),
            btn(playPref('diceRoller') ? 'Spend & roll' : 'Spend one', 'spend-hd', { kind: 'small', data: { die }, disabled: used >= total ? true : null }));
        })) : h('p', { class: 'hint' }, 'Add a class (Level up) to get hit dice.')),
      h('div', { class: 'sub death' },
        h('h4', {}, 'Death saves'),
        h('div', { class: 'ds-row' }, h('span', {}, 'Successes'), [0, 1, 2].map(i => check('', `combat.deathSaves.success.${i}`, c.deathSaves.success[i], { aria: `Death save success ${i + 1}`, class: 'pip ok' }))),
        h('div', { class: 'ds-row' }, h('span', {}, 'Failures'), [0, 1, 2].map(i => check('', `combat.deathSaves.fail.${i}`, c.deathSaves.fail[i], { aria: `Death save failure ${i + 1}`, class: 'pip bad' })))),
      h('div', { class: 'btn-row' },
        check('Inspiration', 'inspiration', s.inspiration, { class: 'inspiration' }),
        field('Initiative bonus', 'combat.initBonus', c.initBonus, { type: 'number', class: 'tiny' })),
      h('div', { class: 'btn-row' }, btn('Short rest', 'short-rest'), btn('Long rest', 'long-rest')));
  }

  function attacksCard(s) {
    return card('Attacks',
      h('div', { class: 'list-table attacks' },
        s.attacks.length ? h('div', { class: 'lt-head', 'aria-hidden': 'true' }, h('span', {}, 'Name'), h('span', {}, 'Bonus'), h('span', {}, 'Damage / type'), h('span', {})) : null,
        s.attacks.map((a, i) => h('div', { class: 'lt-row' },
          field('Name', `attacks.${i}.name`, a.name, { class: 'compact' }),
          field('Bonus', `attacks.${i}.bonus`, a.bonus, { class: 'compact', placeholder: '+5' }),
          field('Damage / type', `attacks.${i}.damage`, a.damage, { class: 'compact', placeholder: '1d8+3 slashing' }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${a.name || 'attack'}`, dataset: { action: 'remove-row', list: 'attacks', index: i } }, '✕'),
          field('Notes', `attacks.${i}.notes`, a.notes, { class: 'compact span-all', placeholder: 'Range, properties…' })))),
      s.attacks.length ? null : h('p', { class: 'hint' }, 'Tip: importing a weapon adds the attack with bonuses calculated.'),
      btn('+ Add attack', 'add-row', { data: { list: 'attacks', template: 'attack' } }));
  }

  const RULESET_OPTIONS = [['', 'Custom / homebrew'], ['2014', '2014 rules (SRD 5.1)'], ['2024', '2024 rules (SRD 5.2)']];

  function identityCard(s) {
    return card('Character',
      h('div', { class: 'grid-2' },
        field('Race / species', 'race', s.race, { data: { roster: '1' } }),
        field('Background', 'background', s.background),
        field('Alignment', 'alignment', s.alignment),
        field('Player', 'player', s.player),
        field('Rules', 'ruleset', s.ruleset, { options: RULESET_OPTIONS, data: { rerender: '1' } })));
  }

  function profsCard(s) {
    return card('Proficiencies & languages',
      field('Armor', 'proficiencies.armor', s.proficiencies.armor, { textarea: true, rows: 2 }),
      field('Weapons', 'proficiencies.weapons', s.proficiencies.weapons, { textarea: true, rows: 2 }),
      field('Tools', 'proficiencies.tools', s.proficiencies.tools, { textarea: true, rows: 2 }),
      field('Languages', 'proficiencies.languages', s.proficiencies.languages, { textarea: true, rows: 2 }));
  }

  // ---------------------------------------------------------------- Play tab (session mode)

  function buildPlay(s) {
    const c = s.combat;
    const down = c.hpMax > 0 && c.hpCurrent === 0;
    const pools = Rules.hitDicePools(s);
    const slotRows = slotRowsFor(s);
    const castable = s.spellcasting.spells.map((sp, i) => [sp, i])
      .filter(([sp]) => sp.level === 0 || sp.prepared)
      .sort((a, b) => a[0].level - b[0].level || a[0].name.localeCompare(b[0].name));
    // Everything you can do, sorted by when you can do it.
    const groups = { action: { attacks: [], rows: [] }, bonus: { attacks: [], rows: [] }, reaction: { attacks: [], rows: [] }, other: { attacks: [], rows: [] }, passive: { attacks: [], rows: [] } };
    s.attacks.forEach((a, i) => groups[/bonus action/i.test(a.notes) ? 'bonus' : 'action'].attacks.push([a, i]));
    castable.forEach(([sp, i]) => groups[Rules.spellTiming(sp.castingTime)].rows.push(['spell', sp, i]));
    s.features.map((f, i) => [f, i]).sort((a, b) => a[0].name.localeCompare(b[0].name))
      .forEach(([f, i]) => groups[Rules.featureTiming(f)].rows.push(['feature', f, i]));
    const concOptions = [['', 'Not concentrating'],
      ...[...new Set(s.spellcasting.spells.filter(sp => sp.concentration).map(sp => sp.name))].map(n => [n, n])];
    if (c.concentration && !concOptions.some(([v]) => v === c.concentration)) concOptions.push([c.concentration, c.concentration]);
    const stat = (label, content) => h('div', { class: 'play-stat' }, h('span', { class: 'label' }, label), content);
    const rolls = playPref('diceRoller');
    const castButtons = playPref('castButtons');
    const toggle = (key, label, on) => h('button', {
      type: 'button', class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), dataset: { action: 'play-pref', key },
    }, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }), label);
    const attackRow = ([a, i]) => h(rolls ? 'button' : 'div', rolls ? {
      type: 'button', class: 'play-attack', dataset: { action: 'roll-attack', index: i }, 'aria-label': `Roll ${a.name || 'attack'}: ${a.bonus || '+0'} to hit, ${a.damage || 'no damage set'}`,
    } : { class: 'play-attack static' },
    h('span', { class: 'pa-name' }, a.name || 'Attack'),
    h('span', { class: 'pa-bonus' }, a.bonus || '+0'),
    h('span', { class: 'pa-dmg' }, a.damage || '—'));
    const playRow = ([kind, x, i]) => (kind === 'spell'
      ? h('li', {},
        h('span', { class: 'badge' }, x.level ? `${Rules.ORDINAL[x.level]}` : 'Cantrip'),
        h('details', {},
          h('summary', {}, h('strong', {}, x.name), x.concentration ? h('span', { class: 'tag', title: 'Concentration' }, 'C') : null,
            h('span', { class: 'muted small' }, ` ${[x.castingTime, x.range].filter(Boolean).join(' · ')}`)),
          h('p', { class: 'small' }, [x.duration, x.components].filter(Boolean).join(' · ')),
          h('p', { class: 'small spell-text' }, x.description)),
        castButtons ? btn('Cast', 'cast', { kind: 'small', data: { index: i } }) : null)
      : h('li', {},
        h('span', { class: 'badge' }, 'Feature'),
        h('details', {},
          h('summary', {}, h('strong', {}, x.name || 'Unnamed feature')),
          h('p', { class: 'small spell-text' }, x.description))));
    const groupCard = (title, g, hint) => (g.attacks.length || g.rows.length || hint ? h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, title),
      g.attacks.length ? h('div', { class: 'play-attacks' }, g.attacks.map(attackRow)) : null,
      g.rows.length ? h('ul', { class: 'play-spells' }, g.rows.map(playRow)) : null,
      g.attacks.length || g.rows.length ? null : h('p', { class: 'hint' }, hint)) : null);
    const checkRow = (kind, key, name, derivedKey) => h('li', { class: 'skill no-rank' }, h('span', { class: 'skill-name' }, name), rollable(kind, key, derivedKey, 'skill-val'));

    return h('div', { class: 'play' },
      h('div', { class: 'play-options', role: 'group', 'aria-label': 'Table options' },
        toggle('diceRoller', 'Roll dice for me', rolls),
        toggle('castButtons', 'Cast buttons use up slots', castButtons)),
      // Hit points: the thing that changes most at the table
      h('section', { class: `card play-hp${down ? ' is-down' : ''}` },
        h('div', { class: 'play-hp-head' },
          h('span', { class: 'label' }, 'Hit points'),
          check('Inspiration', 'inspiration', s.inspiration, { class: 'inspiration' })),
        h('div', { class: 'play-hp-num' }, derived('hpText')),
        h('div', { class: 'bar hp' }, h('div', { class: 'bar-fill', dataset: { bar: 'hp' } })),
        h('div', { class: 'play-amount' },
          h('label', { for: 'play-amount', class: 'sr-only' }, 'Amount'),
          h('button', { type: 'button', class: 'btn chip', dataset: { action: 'play-amt', v: '-1' }, 'aria-label': 'Minus 1' }, '−1'),
          h('input', { id: 'play-amount', type: 'number', min: 0, inputmode: 'numeric', placeholder: '0' }),
          ['+1', '+5', '+10'].map(v => h('button', { type: 'button', class: 'btn chip', dataset: { action: 'play-amt', v }, 'aria-label': `Add ${v.slice(1)}` }, v))),
        h('div', { class: 'play-hp-btns' },
          btn('Damage', 'hp-damage', { kind: 'danger big-btn', data: { input: 'play-amount' } }),
          btn('Heal', 'hp-heal', { kind: 'ok big-btn', data: { input: 'play-amount' } }),
          btn('Temp HP', 'hp-temp', { kind: 'big-btn', data: { input: 'play-amount' } })),
        down ? h('div', { class: 'play-death' },
          h('strong', {}, 'You\'re down! Death saves'),
          h('div', { class: 'ds-row' }, h('span', {}, 'Successes'), [0, 1, 2].map(i => check('', `combat.deathSaves.success.${i}`, c.deathSaves.success[i], { aria: `Death save success ${i + 1}`, class: 'pip ok' }))),
          h('div', { class: 'ds-row' }, h('span', {}, 'Failures'), [0, 1, 2].map(i => check('', `combat.deathSaves.fail.${i}`, c.deathSaves.fail[i], { aria: `Death save failure ${i + 1}`, class: 'pip bad' }))),
          rolls ? btn('🎲 Roll death save', 'death-roll', { kind: 'primary' }) : h('p', { class: 'hint' }, 'Roll a d20: 10 or higher is a success, a natural 20 brings you back with 1 HP, a natural 1 counts as two failures.')) : null),

      // Quick numbers
      h('section', { class: 'card play-stats' },
        stat('AC', derived('ac', { class: 'strong' })),
        stat('Initiative', rollable('init', '', 'initiative', 'strong')),
        stat('Speed', h('strong', {}, `${c.speed} ft`)),
        stat('Prof.', derived('pb', { class: 'strong' })),
        stat('Passive Perc.', derived('passivePerception', { class: 'strong' })),
        s.spellcasting.ability ? stat('Spell DC', derived('spellDc', { class: 'strong' })) : null,
        s.spellcasting.ability ? stat('Spell Atk', rollable('spell', '', 'spellAtk', 'strong')) : null),

      // Class resources: Rage, Focus Points, Superiority Dice...
      s.resources.length ? h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Resources'),
        h('div', { class: 'res-list' }, resourceRows(s)),
        h('p', { class: 'hint' }, 'Tap to mark uses spent. Rests refill them. ', h('button', { type: 'button', class: 'link-btn', dataset: { action: 'tab', tab: 'features' } }, 'Edit trackers'))) : null,

      // Spell slots (the spells themselves sit with the action that casts them)
      slotRows.length ? h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Spell slots'),
        h('div', { class: 'slots' }, slotRows),
        h('p', { class: 'hint' }, castButtons ? 'Cast buttons mark slots for you.' : 'Tap a pip to mark a slot used when you cast.')) : null,

      groupCard('Action', groups.action, 'No attacks yet. Add them on the Stats tab.'),
      groupCard('Bonus action', groups.bonus),
      groupCard('Reaction', groups.reaction),
      groupCard('Longer to cast', groups.other),
      rolls && s.attacks.length ? h('p', { class: 'hint play-wide' }, 'Tap an attack to roll to-hit and damage. A natural 20 doubles the damage dice.') : null,
      groups.passive.rows.length ? h('section', { class: 'card' },
        h('details', {},
          h('summary', { class: 'card-title' }, `Always-on features (${groups.passive.rows.length})`),
          h('ul', { class: 'play-spells' }, groups.passive.rows.map(playRow)),
          h('p', { class: 'hint' }, 'Sorted by reading each feature\'s text. If one is in the wrong group, change it on the Features tab.'))) : null,

      // Saves and skills, kept folded so the table view stays short
      h('section', { class: 'card' },
        h('details', {},
          h('summary', { class: 'card-title' }, 'Saves & skills'),
          h('h4', {}, 'Saving throws'),
          h('ul', { class: 'skills' }, ABILITIES.map(a => checkRow('save', a.key, a.name, `save.${a.key}`))),
          h('h4', {}, 'Skills'),
          h('ul', { class: 'skills' }, SKILLS.map(sk => checkRow('skill', sk.key, sk.name, `skill.${sk.key}`))))),

      // Conditions & concentration
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Conditions'),
        h('div', { class: 'cond-grid' }, Rules.CONDITIONS.map(name => {
          const on = c.conditions.includes(name);
          return h('button', { type: 'button', class: `cond${on ? ' on' : ''}`, 'aria-pressed': String(on), dataset: { action: 'toggle-cond', name } }, name);
        })),
        h('div', { class: 'cond-extra' },
          h('div', { class: 'stepper' },
            h('span', { class: 'label' }, 'Exhaustion'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Less exhaustion', dataset: { action: 'exhaustion', d: '-1' } }, '−'),
            h('strong', { 'aria-live': 'polite' }, String(c.exhaustion)),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More exhaustion', dataset: { action: 'exhaustion', d: '1' } }, '+')),
          h('button', { type: 'button', class: 'link-btn', dataset: { action: 'cond-help' } }, 'What do these do?')),
        h('div', { class: `conc${c.concentration ? ' on' : ''}` },
          field('Concentrating on', 'combat.concentration', c.concentration, { options: concOptions, data: { rerender: '1' } }),
          c.concentration ? h('p', { class: 'hint' }, 'If you take damage, you\'ll get a reminder to make a CON save.') : null)),

      // Rests & dice
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Rest & dice'),
        Object.keys(pools).length ? h('ul', { class: 'hd-list' }, Object.entries(pools).map(([die, total]) => {
          const used = Math.min(total, c.hitDiceUsed[die] || 0);
          return h('li', {},
            h('span', {}, `Hit dice d${die}: `, h('strong', {}, `${total - used}`), ` of ${total}`),
            btn(rolls ? 'Spend & roll' : 'Spend one', 'spend-hd', { kind: 'small', data: { die }, disabled: used >= total ? true : null }));
        })) : null,
        h('div', { class: 'btn-row' }, btn('Short rest', 'short-rest'), btn('Long rest', 'long-rest')),
        rolls ? h('div', { class: 'dice-row', role: 'group', 'aria-label': 'Roll a die' },
          [4, 6, 8, 10, 12, 20, 100].map(f => h('button', { type: 'button', class: 'btn chip', dataset: { action: 'roll-die', faces: f } }, `d${f}`))) : null));
  }

  const RECHARGE_LABEL = { short: 'Short or long rest', short1: '1 back on short rest, all on long', long: 'Long rest', none: 'Doesn\'t refill' };

  /** Tracker rows for the Play tab: pips for small counts, a stepper for big pools like Lay on Hands. */
  function resourceRows(s) {
    return s.resources.map((r, i) => {
      const used = Math.min(r.max, r.used);
      const name = r.name || 'Unnamed tracker';
      const stepBtn = (d, label) => h('button', { type: 'button', class: 'btn chip', 'aria-label': `${name}: ${d > 0 ? 'spend' : 'get back'} ${Math.abs(d)}`, dataset: { action: 'res-step', index: i, d } }, label);
      return h('div', { class: 'res-row' },
        h('div', { class: 'res-head' },
          h('strong', {}, name),
          h('span', { class: 'muted small' }, `${r.max - used}/${r.max} · ${RECHARGE_LABEL[r.recharge]}`)),
        r.max <= 12
          ? h('div', { class: 'pips' }, Array.from({ length: r.max }, (_, j) => h('button', {
            type: 'button', class: `pip-btn${j < used ? ' used' : ''}`, 'aria-pressed': String(j < used),
            'aria-label': `${name} ${j + 1} of ${r.max}${j < used ? ' (spent)' : ''}`, dataset: { action: 'res-pip', index: i, j },
          })))
          : h('div', { class: 'res-steps' }, stepBtn(5, '−5'), stepBtn(1, '−1'), stepBtn(-1, '+1'), stepBtn(-5, '+5')));
    });
  }

  /** Refill trackers after a rest. Returns how many changed. */
  function restoreResources(s, rest) {
    let changed = 0;
    for (const r of s.resources) {
      if (!r.used || r.recharge === 'none') continue;
      if (rest === 'long' || r.recharge === 'short') { r.used = 0; changed++; }
      else if (r.recharge === 'short1') { r.used -= 1; changed++; }
    }
    return changed;
  }

  /** Name and bonus for anything rollable with a d20. */
  function checkInfo(s, kind, key) {
    if (kind === 'skill') { const sk = SKILLS.find(x => x.key === key); return { name: sk.name, bonus: Rules.skillBonus(s, key) }; }
    const ab = ABILITIES.find(a => a.key === key);
    if (kind === 'save') return { name: `${ab.name} save`, bonus: Rules.saveBonus(s, key) };
    if (kind === 'ability') return { name: `${ab.name} check`, bonus: Rules.mod(s.abilities[key]) };
    if (kind === 'init') return { name: 'Initiative', bonus: Rules.mod(s.abilities.dex) + (Number(s.combat.initBonus) || 0) };
    const sa = s.spellcasting.ability;
    return { name: 'Spell attack', bonus: sa ? Rules.profBonus(Rules.totalLevel(s)) + Rules.mod(s.abilities[sa]) : 0 };
  }

  // Per-device table preferences. Both start off: most players roll real dice and tick slots themselves.
  const playPref = key => !!Store.getPref(key, false);

  /** Read the amount box for HP buttons; Overview uses #hp-amount, Play uses #play-amount. */
  function readAmount(el) {
    const input = document.getElementById((el && el.dataset.input) || 'hp-amount');
    const amt = input ? Math.max(0, Math.round(toNum(input.value))) : 0;
    if (!amt) { toast('Enter an amount first.'); if (input) input.focus(); }
    return amt;
  }

  /** Mark a slot used for a prepared spell: lowest free slot of its level or higher, then pact slots. */
  function castSpell(index) {
    const s = active();
    const sp = s.spellcasting.spells[index];
    if (!sp) return;
    const c = s.combat;
    const concNote = () => {
      if (!sp.concentration) return '';
      const prev = c.concentration;
      c.concentration = sp.name;
      return prev && prev !== sp.name ? ` You stop concentrating on ${prev}.` : ' Concentration started.';
    };
    if (sp.level === 0) {
      const note = concNote();
      commit({ rerender: true });
      toast(`Cast ${sp.name} (cantrip).${note}`);
      return;
    }
    const { slots, pact } = Rules.spellSlots(s.classes, s.ruleset);
    const used = s.spellcasting.slotsUsed;
    let label = null;
    for (let l = sp.level; l <= 9 && !label; l++) {
      if ((slots[l - 1] || 0) - (used[l - 1] || 0) > 0) { used[l - 1] = (used[l - 1] || 0) + 1; label = `a ${Rules.ORDINAL[l]}-level slot`; }
      else if (pact && pact.level === l && pact.count - s.spellcasting.pactUsed > 0) { s.spellcasting.pactUsed += 1; label = `a pact slot (${Rules.ORDINAL[l]} level)`; }
    }
    if (!label) { toast(`No ${Rules.ORDINAL[sp.level]}-level or higher slots left for ${sp.name}. A long rest restores them.`, 'error'); return; }
    const note = concNote();
    commit({ rerender: true });
    toast(`Cast ${sp.name} using ${label}.${note}`, 'ok');
  }

  /** Condition rules text, from the character's SRD ruleset (2024 if the sheet has none). */
  async function showConditionHelp() {
    const s = active();
    const ruleset = s.ruleset || '2024';
    let data;
    try { data = await loadSrd(ruleset); } catch (e) { toast(e.message, 'error'); return; }
    const active0 = new Set(s.combat.conditions);
    const list = [...data.conditions].sort((a, b) => (active0.has(b.n) - active0.has(a.n)) || a.n.localeCompare(b.n));
    openModal({
      title: 'Conditions',
      wide: true,
      body: h('div', { class: 'cond-help' },
        h('p', { class: 'hint' }, `Rules text from the ${data.meta.label}. Conditions you have right now are listed first.`),
        list.map(cnd => h('details', { open: active0.has(cnd.n) ? true : null },
          h('summary', {}, h('strong', {}, cnd.n), active0.has(cnd.n) ? h('span', { class: 'badge gold' }, ' active') : null),
          h('p', { class: 'small spell-text' }, cnd.d)))),
      actions: [{ label: 'Close', kind: 'primary' }],
    });
  }

  // ---------------------------------------------------------------- Spells tab

  function buildSpells(s) {
    const sc = s.spellcasting;
    const slotRows = slotRowsFor(s);

    const byLevel = {};
    s.spellcasting.spells.forEach((sp, i) => { (byLevel[sp.level] = byLevel[sp.level] || []).push([sp, i]); });

    return h('div', { class: 'grid spells' },
      card('Spellcasting',
        h('div', { class: 'grid-3' },
          field('Ability', 'spellcasting.ability', sc.ability, { options: [['', '—'], ...ABILITIES.map(a => [a.key, a.name])] }),
          h('div', { class: 'field big' }, h('span', { class: 'label' }, 'Save DC'), derived('spellDc', { class: 'big-value' })),
          h('div', { class: 'field big' }, h('span', { class: 'label' }, 'Attack'), derived('spellAtk', { class: 'big-value' }))),
        h('h4', {}, 'Spell slots'),
        slotRows.length ? h('div', { class: 'slots' }, slotRows)
          : h('p', { class: 'hint' }, 'No spell slots yet. Slots are worked out from each class\'s caster type (Progression → Classes), including multiclassing.'),
        h('p', { class: 'hint' }, 'Tap a pip to mark a slot used. Long rest restores everything; short rest restores pact slots.')),
      card('Spells known & prepared',
        h('div', { class: 'list-tools' }, filterBox('spell', 'Filter spells…'),
          btn('+ Add spell', 'add-row', { data: { list: 'spellcasting.spells', template: 'spell' } }),
          btn('Import Homebrew', 'import')),
        s.spellcasting.spells.length ? null : h('p', { class: 'hint' }, 'No spells yet. Copy the text of a spell from your notes or homebrew document, then use Import Homebrew.'),
        Object.keys(byLevel).sort((a, b) => a - b).map(lvl => h('div', { class: 'spell-group' },
          h('h4', {}, Number(lvl) === 0 ? 'Cantrips' : `${Rules.ORDINAL[lvl]} level`),
          byLevel[lvl].sort((a, b) => a[0].name.localeCompare(b[0].name)).map(([sp, i]) => spellRow(sp, i))))));
  }

  /** Tappable spell-slot pips (regular slots + pact slots), shared by the Spells and Play tabs. */
  function slotRowsFor(s) {
    const { slots, pact } = Rules.spellSlots(s.classes, s.ruleset);
    const sc = s.spellcasting;
    const slotRows = [];
    slots.forEach((max, i) => {
      if (!max) return;
      const used = Math.min(max, sc.slotsUsed[i] || 0);
      slotRows.push(h('div', { class: 'slot-row' },
        h('span', { class: 'slot-label' }, `${Rules.ORDINAL[i + 1]}`),
        h('div', { class: 'pips' }, Array.from({ length: max }, (_, j) => h('button', {
          type: 'button', class: `pip-btn${j < used ? ' used' : ''}`, 'aria-pressed': String(j < used),
          'aria-label': `${Rules.ORDINAL[i + 1]}-level slot ${j + 1}${j < used ? ' (used)' : ''}`,
          dataset: { action: 'slot', level: i, index: j },
        }))),
        h('span', { class: 'muted' }, `${max - used}/${max}`)));
    });
    if (pact) {
      const used = Math.min(pact.count, sc.pactUsed || 0);
      slotRows.push(h('div', { class: 'slot-row pact' },
        h('span', { class: 'slot-label' }, `Pact (${Rules.ORDINAL[pact.level]})`),
        h('div', { class: 'pips' }, Array.from({ length: pact.count }, (_, j) => h('button', {
          type: 'button', class: `pip-btn${j < used ? ' used' : ''}`, 'aria-pressed': String(j < used),
          'aria-label': `Pact slot ${j + 1}${j < used ? ' (used)' : ''}`, dataset: { action: 'slot', level: 'pact', index: j },
        }))),
        h('span', { class: 'muted' }, `${pact.count - used}/${pact.count}`)));
    }
    return slotRows;
  }

  function spellRow(sp, i) {
    const key = `spell:${i}`;
    const tags = [sp.concentration ? 'C' : '', sp.ritual ? 'R' : ''].filter(Boolean);
    const p = `spellcasting.spells.${i}`;
    return h('div', { class: 'spell-row', dataset: { filterRow: 'spell', search: sp.name.toLowerCase() } },
      sp.level > 0 ? check('', `${p}.prepared`, sp.prepared, { aria: `${sp.name} prepared`, class: 'prep' }) : h('span', { class: 'prep-spacer' }),
      rowDetails(key,
        [h('span', { class: 'row-title', id: `mirror-${key}` }, sp.name || 'Unnamed spell'),
          tags.map(t => h('span', { class: 'tag', title: t === 'C' ? 'Concentration' : 'Ritual' }, t)),
          h('span', { class: 'row-meta' }, [sp.castingTime, sp.range].filter(Boolean).join(' · '))],
        [h('div', { class: 'grid-3' },
          field('Name', `${p}.name`, sp.name, { data: { mirror: `mirror-${key}` } }),
          field('Level (0 = cantrip)', `${p}.level`, sp.level, { type: 'number', min: 0, max: 9, data: { rerender: '1' } }),
          field('School', `${p}.school`, sp.school),
          field('Casting time', `${p}.castingTime`, sp.castingTime),
          field('Range', `${p}.range`, sp.range),
          field('Duration', `${p}.duration`, sp.duration)),
        field('Components', `${p}.components`, sp.components),
        h('div', { class: 'btn-row' }, check('Concentration', `${p}.concentration`, sp.concentration), check('Ritual', `${p}.ritual`, sp.ritual)),
        field('Description', `${p}.description`, sp.description, { textarea: true, rows: 6 }),
        field('Source', `${p}.source`, sp.source),
        h('div', { class: 'btn-row end' }, btn('Remove spell', 'remove-row', { kind: 'danger-soft small', data: { list: 'spellcasting.spells', index: i } }))],
        sp.name));
  }

  // ---------------------------------------------------------------- Inventory tab

  function buildInventory(s) {
    return h('div', { class: 'grid inventory' },
      card('Coins',
        h('div', { class: 'coins' }, Rules.CURRENCIES.map(([k, name]) => field(name, `currency.${k}`, s.currency[k], { type: 'number', min: 0, class: `coin coin-${k}` }))),
        h('p', { class: 'hint' }, 'Carried weight ', derived('carry', { class: 'strong' }), ' (coins count at 50 per lb).')),
      card('Equipment',
        h('div', { class: 'list-tools' }, filterBox('item', 'Filter items…'),
          btn('+ Add item', 'add-row', { data: { list: 'inventory', template: 'item' } }),
          btn('Import Homebrew', 'import')),
        s.inventory.length ? null : h('p', { class: 'hint' }, 'Your pack is empty.'),
        s.inventory.map((it, i) => {
          const key = `item:${i}`;
          const p = `inventory.${i}`;
          return h('div', { class: 'spell-row', dataset: { filterRow: 'item', search: it.name.toLowerCase() } },
            check('', `${p}.equipped`, it.equipped, { aria: `${it.name} equipped`, class: 'prep' }),
            rowDetails(key,
              [h('span', { class: 'row-title', id: `mirror-${key}` }, it.name || 'Unnamed item'),
                h('span', { class: 'row-meta' }, `×${it.qty}${it.weight ? ` · ${it.weight} lb` : ''}`)],
              [h('div', { class: 'grid-3' },
                field('Name', `${p}.name`, it.name, { data: { mirror: `mirror-${key}` } }),
                field('Quantity', `${p}.qty`, it.qty, { type: 'number', min: 0 }),
                field('Weight each (lb)', `${p}.weight`, it.weight, { type: 'number', min: 0, step: 'any' })),
              field('Notes', `${p}.notes`, it.notes, { textarea: true, rows: 4 }),
              h('div', { class: 'grid-3' },
                field('Source', `${p}.source`, it.source),
                field('Armor type', `${p}.armor`, it.armor || '', { options: ARMOR_OPTIONS }),
                field('AC it gives', `${p}.acValue`, it.acValue || 0, { type: 'number', min: 0 })),
              h('div', { class: 'btn-row end' }, btn('Remove item', 'remove-row', { kind: 'danger-soft small', data: { list: 'inventory', index: i } }))],
              it.name));
        }),
        s.combat.acAuto
          ? h('p', { class: 'hint' }, 'Checkbox = equipped. Your AC is ', derived('ac', { class: 'strong' }), ' (', derived('acBreakdown'), ') and updates when you change what you wear.')
          : h('p', { class: 'hint' }, 'Checkbox = equipped. AC is typed by hand on this character, so update it when you change armor, or turn on "Work out AC automatically" on the Stats tab.')));
  }

  const ARMOR_OPTIONS = [['', 'Work it out from the name'], ['none', 'Not armor'], ['light', 'Light armor (AC + DEX)'], ['medium', 'Medium armor (AC + DEX, max 2)'],
    ['heavy', 'Heavy armor (AC only)'], ['shield', 'Shield (adds to AC)'], ['bonus', 'Other item that adds to AC']];

  // ---------------------------------------------------------------- Features tab

  function buildFeatures(s) {
    const groups = {};
    s.features.forEach((f, i) => { (groups[f.origin] = groups[f.origin] || []).push([f, i]); });
    return h('div', { class: 'grid one' },
      card('Resource trackers',
        h('p', { class: 'hint' }, 'Limited-use abilities shown on the Play tab. Class ones appear and grow by themselves; changing one here means it stops following your level.'),
        s.resources.map((r, i) => h('div', { class: 'res-edit' },
          field('Name', `resources.${i}.name`, r.name, { data: { detach: i } }),
          field('Uses', `resources.${i}.max`, r.max, { type: 'number', min: 1, data: { detach: i } }),
          field('Refills on', `resources.${i}.recharge`, r.recharge, { options: Object.entries(RECHARGE_LABEL), data: { detach: i } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${r.name || 'tracker'}`, dataset: { action: 'remove-resource', index: i } }, '✕'))),
        h('div', { class: 'btn-row' },
          btn('+ Add tracker', 'add-row', { data: { list: 'resources', template: 'resource' } }),
          s.hiddenResources.length ? btn('Bring back class trackers', 'restore-resources') : null)),
      card('Features & traits',
        h('div', { class: 'list-tools' }, filterBox('feature', 'Filter features…'),
          btn('+ Add feature', 'add-row', { data: { list: 'features', template: 'feature' } }),
          btn('Import Homebrew', 'import')),
        s.features.length ? null : h('p', { class: 'hint' }, 'Class features, racial traits and feats you gain will be listed here.'),
        Schema.FEATURE_ORIGINS.filter(o => groups[o]).map(origin => h('div', { class: 'spell-group' },
          h('h4', {}, origin === 'Other' ? 'Other' : `${origin} features`),
          groups[origin].map(([f, i]) => {
            const key = `feature:${i}`;
            const p = `features.${i}`;
            return h('div', { class: 'spell-row no-check', dataset: { filterRow: 'feature', search: f.name.toLowerCase() } },
              rowDetails(key,
                [h('span', { class: 'row-title', id: `mirror-${key}` }, f.name || 'Unnamed feature'), h('span', { class: 'row-meta' }, f.source)],
                [h('div', { class: 'grid-3' },
                  field('Name', `${p}.name`, f.name, { data: { mirror: `mirror-${key}` } }),
                  field('Type', `${p}.origin`, f.origin, { options: Schema.FEATURE_ORIGINS.map(o => [o, o]), data: { rerender: '1' } }),
                  field('Source / level', `${p}.source`, f.source)),
                field('Description', `${p}.description`, f.description, { textarea: true, rows: 6 }),
                field('Group on the Play tab', `${p}.timing`, f.timing || '', { options: TIMING_OPTIONS }),
                h('div', { class: 'btn-row end' }, btn('Remove feature', 'remove-row', { kind: 'danger-soft small', data: { list: 'features', index: i } }))],
                f.name));
          })))));
  }

  const TIMING_OPTIONS = [['', 'Work it out from the text'], ['action', 'Action'], ['bonus', 'Bonus action'], ['reaction', 'Reaction'], ['passive', 'Always on']];

  // ---------------------------------------------------------------- Notes tab

  function buildNotes(s) {
    const n = s.notes;
    return h('div', { class: 'grid notes' },
      card('Personality',
        field('Personality traits', 'notes.personality', n.personality, { textarea: true }),
        field('Ideals', 'notes.ideals', n.ideals, { textarea: true, rows: 2 }),
        field('Bonds', 'notes.bonds', n.bonds, { textarea: true, rows: 2 }),
        field('Flaws', 'notes.flaws', n.flaws, { textarea: true, rows: 2 })),
      card('Story',
        field('Appearance', 'notes.appearance', n.appearance, { textarea: true, rows: 3 }),
        field('Backstory', 'notes.backstory', n.backstory, { textarea: true, rows: 8 })),
      card('Campaign notes', field('Notes', 'notes.general', n.general, { textarea: true, rows: 14, placeholder: 'NPCs, quests, loot to sell…' })));
  }

  // ---------------------------------------------------------------- Progression tab

  function buildProgression(s) {
    const lvl = Rules.totalLevel(s);
    return h('div', { class: 'grid progression' },
      card('Experience',
        h('div', { class: 'xp big-xp' },
          h('div', { class: 'xp-top' }, derived('xpText', { class: 'strong' }), h('span', { class: 'badge gold', hidden: true, dataset: { show: 'levelReady' } }, 'Level up ready!')),
          h('div', { class: 'bar' }, h('div', { class: 'bar-fill xp-fill', dataset: { bar: 'xp' } }))),
        h('div', { class: 'xp-add' },
          h('label', { for: 'xp-amount', class: 'sr-only' }, 'XP to add'),
          h('input', { id: 'xp-amount', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'XP earned' }),
          h('label', { for: 'xp-reason', class: 'sr-only' }, 'Reason'),
          h('input', { id: 'xp-reason', type: 'text', placeholder: 'For… (optional)', autocomplete: 'off' }),
          btn('Add XP', 'add-xp', { kind: 'primary' })),
        field('Total XP', 'xp', s.xp, { type: 'number', min: 0 }),
        h('p', { class: 'hint' }, 'Using milestone levelling? Ignore XP and use Level up whenever your DM says so.'),
        h('div', { class: 'btn-row' }, btn(lvl ? `Level up to ${lvl + 1}` : 'Choose first class', 'level-up', { kind: 'primary', disabled: lvl >= 20 ? true : null }))),
      card('Classes',
        s.classes.length ? null : h('p', { class: 'hint' }, 'No class yet — use Level up to choose one.'),
        s.classes.map((c, i) => h('div', { class: 'class-row' },
          h('div', { class: 'grid-3' },
            field('Class', `classes.${i}.name`, c.name, { data: { roster: '1' } }),
            field('Subclass', `classes.${i}.subclass`, c.subclass),
            field('Level', `classes.${i}.level`, c.level, { type: 'number', min: 0, max: 20, data: { rerender: '1', roster: '1' } }),
            field('Hit die', `classes.${i}.hitDie`, c.hitDie, { options: Rules.HIT_DICE.map(d => [d, `d${d}`]), num: true, data: { rerender: '1' } }),
            field('Spellcasting', `classes.${i}.caster`, c.caster, { options: Object.entries(Rules.CASTER_TYPES), data: { rerender: '1' } })),
          h('div', { class: 'btn-row end' }, btn('Remove class', 'remove-row', { kind: 'danger-soft small', data: { list: 'classes', index: i } })))),
        h('p', { class: 'hint' }, 'Editing levels here is a direct correction. Level up records history you can roll back.')),
      s.pendingFeatures.length ? card('Coming up',
        h('p', { class: 'hint' }, 'Imported features you haven\'t reached yet. The level-up wizard offers each one when you hit its level.'),
        h('ul', { class: 'pending-list' }, s.pendingFeatures
          .map((p, i) => [p, i])
          .sort((a, b) => a[0].className.localeCompare(b[0].className) || a[0].level - b[0].level)
          .map(([p, i]) => h('li', {},
            h('span', { class: 'badge' }, `Lv ${p.level}`),
            h('span', { class: 'pending-name' }, h('strong', {}, p.name), h('span', { class: 'muted small' }, ` · ${p.className}${p.subclass ? ` (${p.subclass})` : ''}`)),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.name} from upcoming features`, dataset: { action: 'remove-row', list: 'pendingFeatures', index: i } }, '✕'))))) : null,
      card('Timeline',
        h('div', { class: 'xp-add' },
          h('label', { for: 'journal', class: 'sr-only' }, 'Journal entry'),
          h('input', { id: 'journal', type: 'text', placeholder: 'Milestone, session note, loot…', autocomplete: 'off' }),
          btn('Add entry', 'add-journal'),
          btn('Save checkpoint', 'checkpoint', { title: 'Store a restorable copy of the sheet as it is now' })),
        s.history.length ? h('ol', { class: 'timeline' }, s.history.map(e => h('li', { class: `tl-${e.type}` },
          h('div', { class: 'tl-head' },
            h('span', { class: 'badge' }, e.type.replace('-', ' ')),
            h('time', { datetime: e.date }, dateText(e.date))),
          h('p', {}, e.summary),
          e.snapshot ? btn('Restore to before this', 'revert', { kind: 'small', data: { id: e.id } }) : null)))
          : h('p', { class: 'hint' }, 'Level-ups, imports and checkpoints appear here.')));
  }

  // ---------------------------------------------------------------- field events

  function onFieldEvent(e) {
    const el = e.target;
    const path = el.dataset && el.dataset.bind;
    if (!path) return;
    const s = active();
    if (!s) return;
    const isToggle = el.type === 'checkbox' || el.tagName === 'SELECT';
    if (e.type === 'input' && isToggle) return;
    if (e.type === 'change' && !isToggle && !el.dataset.rerender) return;
    let v = el.type === 'checkbox' ? el.checked : el.dataset.num ? toNum(el.value) : el.value;
    if (el.dataset.num) {
      if (el.min !== '' && el.min != null) v = Math.max(Number(el.min), v);
      if (el.max !== '' && el.max != null) v = Math.min(Number(el.max), v);
    }
    setPath(s, path, v);
    if (el.dataset.detach !== undefined) {
      // A class tracker the player edits becomes theirs and stops following the class level.
      const r = s.resources[Number(el.dataset.detach)];
      if (r && r.key) { s.hiddenResources.push(r.key); r.key = ''; }
    }
    if (el.dataset.mirror) {
      const m = document.getElementById(el.dataset.mirror);
      if (m) m.textContent = v || 'Unnamed';
    }
    commit({ rerender: e.type === 'change' && !!el.dataset.rerender, roster: !!el.dataset.roster });
  }

  document.addEventListener('input', onFieldEvent);
  document.addEventListener('change', onFieldEvent);

  document.addEventListener('input', e => {
    const group = e.target.dataset && e.target.dataset.filter;
    if (!group) return;
    const q = e.target.value.trim().toLowerCase();
    $$(`.spell-row[data-filter-row="${group}"]`).forEach(row => { row.hidden = !!q && !row.dataset.search.includes(q); });
  });

  document.addEventListener('toggle', e => {
    const key = e.target.dataset && e.target.dataset.key;
    if (!key || state.printing) return;
    if (e.target.open) state.openKeys.add(key); else state.openKeys.delete(key);
  }, true);

  // ---------------------------------------------------------------- actions

  const actions = {
    'toggle-roster': () => {
      const open = !document.body.classList.contains('roster-open');
      document.body.classList.toggle('roster-open', open);
      $('[data-action="toggle-roster"][aria-controls]').setAttribute('aria-expanded', String(open));
      $('.scrim').hidden = !open;
    },
    'toggle-theme': () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      Store.setPref('theme', next);
    },
    display: () => openDisplaySettings(),
    'new-character': () => openNewCharacter(),
    'quick-build': () => { closeRoster(); openQuickBuild(); },
    'import-library': () => { closeRoster(); openImport('', { library: true }); },
    'homebrew-library': () => { closeRoster(); openHomebrewManager(); },
    'open-file': () => $('#file-input').click(),
    'export-all': () => exportAll(),
    open: el => openSheet(el.dataset.id),
    tab: el => {
      const fromBottom = !!el.closest('#bottom-nav');
      state.tab = el.dataset.tab;
      Store.setPref('tab', state.tab);
      $$('.tab').forEach(t => {
        const on = t.dataset.tab === state.tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      $('#tab-panel').setAttribute('aria-labelledby', `tab-${state.tab}`);
      renderBottomNav();
      renderTab();
      // On phones, jump to the top of the section rather than leaving the reader mid-page.
      if (fromBottom) {
        const panel = $('#tab-panel');
        window.scrollTo({ top: Math.max(0, panel.getBoundingClientRect().top + window.scrollY - 64), behavior: 'auto' });
      }
    },
    'more-menu': el => {
      const menu = $('#bn-more');
      const open = menu.hidden;
      menu.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      if (open) { const first = menu.querySelector('button'); if (first) first.focus(); }
    },
    'level-up': () => openLevelUp(),
    import: () => openImport(),
    export: () => openExport(),
    'delete-character': async () => {
      const s = active();
      const ok = await confirmDialog({
        title: 'Delete character?',
        message: `"${s.name || 'Unnamed hero'}" will be removed from this browser. Export a copy first if you might want it back.`,
        ok: 'Delete', danger: true,
      });
      if (!ok) return;
      delete state.sheets[s.id];
      state.activeId = null;
      persist();
      render();
      toast('Character deleted.');
    },
    'cycle-skill': el => {
      const s = active();
      const k = el.dataset.key;
      const rank = (s.skills[k] + 1) % 3;
      s.skills[k] = rank;
      el.textContent = RANK_ICON[rank];
      el.dataset.rank = rank;
      el.title = RANK_LABEL[rank];
      const sk = SKILLS.find(x => x.key === k);
      el.setAttribute('aria-label', `${sk.name}: ${RANK_LABEL[rank]}. Click to change.`);
      commit();
    },
    'hp-damage': el => {
      const s = active();
      const amt = readAmount(el);
      if (!amt) return;
      const c = s.combat;
      const fromTemp = Math.min(c.hpTemp, amt);
      c.hpTemp -= fromTemp;
      const wasUp = c.hpCurrent > 0;
      c.hpCurrent = Math.max(0, c.hpCurrent - (amt - fromTemp));
      commit({ rerender: true });
      if (c.hpCurrent === 0 && wasUp) {
        toast(`${s.name || 'Your character'} is down! Time for death saves.`, 'error');
        if (c.concentration) { toast(`Concentration on ${c.concentration} ends.`); c.concentration = ''; commit({ rerender: true }); }
      } else if (c.concentration && amt - fromTemp > 0) {
        const dc = Math.max(10, Math.floor(amt / 2));
        toast(`Concentration check for ${c.concentration}: CON save DC ${dc} (your bonus ${fmt(Rules.saveBonus(s, 'con'))}).`, 'error');
      }
    },
    'hp-heal': el => {
      const s = active();
      const amt = readAmount(el);
      if (!amt) return;
      const c = s.combat;
      if (c.hpCurrent === 0) c.deathSaves = { success: [false, false, false], fail: [false, false, false] };
      c.hpCurrent = Math.min(c.hpMax, c.hpCurrent + amt);
      commit({ rerender: true });
    },
    'hp-temp': el => {
      const s = active();
      const amt = readAmount(el);
      if (!amt) return;
      // Temporary HP don't stack: keep the higher value.
      if (amt <= s.combat.hpTemp) { toast(`You already have ${s.combat.hpTemp} temporary HP, which is more, so it stays.`); return; }
      s.combat.hpTemp = amt;
      commit({ rerender: true });
    },
    'play-amt': el => {
      const input = $('#play-amount');
      input.value = Math.max(0, toNum(input.value) + Number(el.dataset.v));
    },
    'death-roll': () => {
      const s = active();
      const c = s.combat;
      const r = Rules.d(20);
      const mark = (list, n) => { for (let i = 0; i < 3 && n > 0; i++) if (!list[i]) { list[i] = true; n--; } };
      let msg;
      if (r === 20) {
        c.hpCurrent = 1;
        c.deathSaves = { success: [false, false, false], fail: [false, false, false] };
        msg = 'Natural 20! You regain 1 HP and are back up.';
      } else if (r === 1) { mark(c.deathSaves.fail, 2); msg = 'Natural 1: two failures.'; }
      else if (r >= 10) { mark(c.deathSaves.success, 1); msg = `${r}: success.`; }
      else { mark(c.deathSaves.fail, 1); msg = `${r}: failure.`; }
      if (c.deathSaves.success.every(Boolean)) { msg += ' Three successes: you are stable at 0 HP.'; }
      if (c.deathSaves.fail.every(Boolean)) { msg += ' Three failures: your character has died.'; }
      commit({ rerender: true });
      toast(`Death save: ${msg}`, r === 20 || r >= 10 ? 'ok' : 'error');
    },
    'toggle-cond': el => {
      const s = active();
      const name = el.dataset.name;
      const list = s.combat.conditions;
      const i = list.indexOf(name);
      if (i >= 0) list.splice(i, 1); else list.push(name);
      el.classList.toggle('on', i < 0);
      el.setAttribute('aria-pressed', String(i < 0));
      commit();
    },
    exhaustion: el => {
      const s = active();
      s.combat.exhaustion = Math.max(0, Math.min(6, s.combat.exhaustion + Number(el.dataset.d)));
      commit({ rerender: true });
      if (s.combat.exhaustion === 6) toast('Exhaustion level 6 means death.', 'error');
    },
    'cond-help': () => showConditionHelp(),
    'roll-attack': el => {
      const s = active();
      const a = s.attacks[Number(el.dataset.index)];
      if (!a) return;
      const bonus = parseInt(String(a.bonus).replace(/\s/g, ''), 10) || 0;
      const r = Rules.d(20);
      const crit = r === 20;
      const dmg = Rules.rollDamage(a.damage, crit);
      const hit = r === 1 ? 'Natural 1: miss!' : `${r + bonus} to hit (${r}${bonus ? fmt(bonus) : ''})${crit ? ' CRITICAL!' : ''}`;
      const damage = dmg.valid ? ` · ${dmg.total}${dmg.type ? ` ${dmg.type}` : ''} damage (${dmg.rolls.join('+') || '0'}${dmg.flat ? fmt(dmg.flat) : ''})` : '';
      toast(`${a.name || 'Attack'}: ${hit}${r === 1 ? '' : damage}`, crit ? 'ok' : 'info');
    },
    'roll-check': el => {
      const { name, bonus } = checkInfo(active(), el.dataset.kind, el.dataset.key);
      const r = Rules.d(20);
      const note = r === 20 ? ' Natural 20!' : r === 1 ? ' Natural 1!' : '';
      toast(`${name}: ${r + bonus} (${r} ${fmt(bonus)})${note}`, r === 20 ? 'ok' : 'info');
    },
    'res-pip': el => {
      const r = active().resources[Number(el.dataset.index)];
      const j = Number(el.dataset.j);
      r.used = j < r.used ? j : j + 1;
      commit({ rerender: true });
    },
    'res-step': el => {
      const r = active().resources[Number(el.dataset.index)];
      r.used = Math.max(0, Math.min(r.max, r.used + Number(el.dataset.d)));
      commit({ rerender: true });
    },
    'remove-resource': el => {
      const s = active();
      const [r] = s.resources.splice(Number(el.dataset.index), 1);
      if (r.key) s.hiddenResources.push(r.key);
      commit({ rerender: true });
      toast(`Removed ${r.name || 'tracker'}.`);
    },
    'restore-resources': () => {
      active().hiddenResources = [];
      commit({ rerender: true });
    },
    cast: el => castSpell(Number(el.dataset.index)),
    'play-pref': el => {
      const key = el.dataset.key;
      Store.setPref(key, !playPref(key));
      renderTab();
    },
    'roll-die': el => {
      const f = Number(el.dataset.faces);
      toast(`d${f}: ${Rules.d(f)}`);
    },
    'spend-hd': el => {
      const s = active();
      const die = el.dataset.die;
      const total = Rules.hitDicePools(s)[die] || 0;
      const used = s.combat.hitDiceUsed[die] || 0;
      if (used >= total) return;
      if (!playPref('diceRoller')) {
        s.combat.hitDiceUsed[die] = used + 1;
        commit({ rerender: true });
        toast(`Hit die spent. Roll your d${die}, add ${fmt(Rules.mod(s.abilities.con))} CON, then use Heal with the total.`);
        return;
      }
      const roll = rollDie(Number(die));
      const heal = Math.max(0, roll + Rules.mod(s.abilities.con));
      s.combat.hitDiceUsed[die] = used + 1;
      s.combat.hpCurrent = Math.min(s.combat.hpMax, s.combat.hpCurrent + heal);
      commit({ rerender: true });
      toast(`Rolled d${die}: ${roll} ${fmt(Rules.mod(s.abilities.con))} CON → healed ${heal}.`);
    },
    'short-rest': () => {
      const s = active();
      const pact = s.spellcasting.pactUsed > 0;
      s.spellcasting.pactUsed = 0;
      const refilled = restoreResources(s, 'short') > 0;
      const back = [pact ? 'pact slots' : '', refilled ? 'trackers' : ''].filter(Boolean).join(' and ');
      commit({ rerender: true });
      toast(`Short rest${back ? `: ${back} restored` : ''}. Spend hit dice to heal.`);
    },
    'long-rest': () => {
      const s = active();
      const c = s.combat;
      c.hpCurrent = c.hpMax;
      c.hpTemp = 0;
      c.deathSaves = { success: [false, false, false], fail: [false, false, false] };
      s.spellcasting.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      s.spellcasting.pactUsed = 0;
      c.exhaustion = Math.max(0, c.exhaustion - 1);
      c.concentration = '';
      let regain =Math.max(1, Math.floor(Rules.totalLevel(s) / 2));
      for (const die of Object.keys(c.hitDiceUsed).sort((a, b) => b - a)) {
        const back = Math.min(regain, c.hitDiceUsed[die]);
        c.hitDiceUsed[die] -= back;
        regain -= back;
      }
      restoreResources(s, 'long');
      commit({ rerender: true });
      toast('Long rest: HP, spell slots, trackers and hit dice restored; exhaustion down by 1.', 'ok');
    },
    'add-row': el => {
      const s = active();
      const list = getPath(s, el.dataset.list);
      const item = clone(Schema.TEMPLATES[el.dataset.template]);
      if (el.dataset.template === 'class') item.name = 'New class';
      list.push(item);
      const prefix = { 'spellcasting.spells': 'spell', inventory: 'item', features: 'feature' }[el.dataset.list];
      if (prefix) state.openKeys.add(`${prefix}:${list.length - 1}`);
      commit({ rerender: true });
      const inputs = $$(`[data-bind^="${el.dataset.list}.${list.length - 1}."]`);
      if (inputs[0]) inputs[0].focus();
    },
    'remove-row': async el => {
      const s = active();
      const list = getPath(s, el.dataset.list);
      const i = Number(el.dataset.index);
      const item = list[i];
      if (el.dataset.list === 'classes') {
        const ok = await confirmDialog({ title: 'Remove class?', message: `Remove ${item.name || 'this class'} (${item.level} levels)? HP and features are not changed automatically.`, ok: 'Remove', danger: true });
        if (!ok) return;
      }
      list.splice(i, 1);
      state.openKeys.clear();
      commit({ rerender: true, roster: el.dataset.list === 'classes' });
      toast(`Removed ${item.name || 'entry'}.`);
    },
    slot: el => {
      const s = active();
      const j = Number(el.dataset.index);
      if (el.dataset.level === 'pact') {
        s.spellcasting.pactUsed = j < s.spellcasting.pactUsed ? j : j + 1;
      } else {
        const i = Number(el.dataset.level);
        s.spellcasting.slotsUsed[i] = j < s.spellcasting.slotsUsed[i] ? j : j + 1;
      }
      commit({ rerender: true });
    },
    'add-xp': () => {
      const s = active();
      const amt = Math.round(toNum($('#xp-amount').value));
      if (!amt) { toast('Enter how much XP was earned.'); $('#xp-amount').focus(); return; }
      const before = Rules.levelForXp(s.xp);
      s.xp = Math.max(0, s.xp + amt);
      const reason = $('#xp-reason').value.trim();
      logHistory(s, 'xp', `${amt > 0 ? '+' : ''}${amt} XP${reason ? ` — ${reason}` : ''} (total ${s.xp.toLocaleString()})`);
      commit({ rerender: true });
      if (Rules.levelForXp(s.xp) > before && Rules.levelForXp(s.xp) > Rules.totalLevel(s)) toast('Enough XP to level up! Use the Level up button.', 'ok');
    },
    'add-journal': () => {
      const s = active();
      const input = $('#journal');
      const text = input.value.trim();
      if (!text) { toast('Write something first.'); input.focus(); return; }
      logHistory(s, 'note', text);
      commit({ rerender: true });
    },
    checkpoint: () => {
      const s = active();
      const label = $('#journal').value.trim();
      logHistory(s, 'checkpoint', label || `Checkpoint at level ${Rules.totalLevel(s)}`, snapshotOf(s));
      commit({ rerender: true });
      toast('Checkpoint saved. You can restore it from the timeline.', 'ok');
    },
    revert: async el => {
      const s = active();
      const entry = s.history.find(e => e.id === el.dataset.id);
      if (!entry || !entry.snapshot) return;
      const ok = await confirmDialog({
        title: 'Restore earlier version?',
        message: `The sheet will go back to how it was before "${entry.summary}". The current version is kept as a checkpoint, so you can undo this.`,
        ok: 'Restore',
      });
      if (!ok) return;
      let restored;
      try { restored = Schema.normalize(entry.snapshot).sheet; } catch (e) { toast(`That checkpoint can't be restored: ${e.message}`, 'error'); return; }
      const current = snapshotOf(s);
      restored.id = s.id;
      restored.history = s.history;
      restored.createdAt = s.createdAt;
      state.sheets[s.id] = restored;
      logHistory(restored, 'restore', `Restored to before "${entry.summary}"`, current);
      commit();
      render();
      toast('Earlier version restored.', 'ok');
    },
    print: () => printSheet(),
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.dataset.action !== 'open' && el.dataset.action.indexOf('toggle') !== 0 && !active()
      && !['display', 'new-character', 'quick-build', 'import-library', 'homebrew-library', 'open-file', 'export-all', 'import'].includes(el.dataset.action)) return;
    e.preventDefault();
    fn(el, e);
  });

  // Close the phone "More" menu on an outside tap or Escape.
  document.addEventListener('click', e => {
    const menu = $('#bn-more');
    if (menu && !menu.hidden && !e.target.closest('#bottom-nav')) closeMoreMenu();
  });
  document.addEventListener('keydown', e => {
    const menu = $('#bn-more');
    if (e.key === 'Escape' && menu && !menu.hidden) { closeMoreMenu(); const b = $('[data-action="more-menu"]'); if (b) b.focus(); }
  });

  // Arrow-key navigation between tabs (WAI-ARIA tabs pattern).
  document.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('tab')) return;
    const tabs = $$('.tab');
    const i = tabs.indexOf(e.target);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n == null) return;
    e.preventDefault();
    tabs[n].focus();
    tabs[n].click();
  });

  function closeRoster() {
    document.body.classList.remove('roster-open');
    const t = $('[data-action="toggle-roster"][aria-controls]');
    if (t) t.setAttribute('aria-expanded', 'false');
    $('.scrim').hidden = true;
  }

  // ---------------------------------------------------------------- new character

  function classPicker(id, includeChooseLater) {
    return h('select', { id },
      includeChooseLater ? h('option', { value: '' }, 'Choose later') : null,
      Object.keys(Rules.CLASSES).map(n => h('option', { value: n }, `${n} (d${Rules.CLASSES[n].hitDie})`)),
      h('option', { value: '__custom' }, 'Custom / homebrew…'));
  }

  function customClassFields(prefix) {
    const box = h('div', { class: 'grid-3 custom-class', hidden: true },
      h('div', { class: 'field' }, h('label', { for: `${prefix}-cname` }, 'Class name'), h('input', { id: `${prefix}-cname`, type: 'text', autocomplete: 'off' })),
      h('div', { class: 'field' }, h('label', { for: `${prefix}-cdie` }, 'Hit die'),
        h('select', { id: `${prefix}-cdie` }, Rules.HIT_DICE.map(d => h('option', { value: d, selected: d === 8 }, `d${d}`)))),
      h('div', { class: 'field' }, h('label', { for: `${prefix}-ccast` }, 'Spellcasting'),
        h('select', { id: `${prefix}-ccast` }, Object.entries(Rules.CASTER_TYPES).map(([v, l]) => h('option', { value: v }, l)))));
    const read = () => ({
      name: $(`#${prefix}-cname`, box).value.trim() || 'Custom class',
      hitDie: Number($(`#${prefix}-cdie`, box).value),
      caster: $(`#${prefix}-ccast`, box).value,
      saves: [],
    });
    return { box, read };
  }

  function openNewCharacter() {
    const name = h('input', { id: 'nc-name', type: 'text', autocomplete: 'off', placeholder: 'e.g. Brannoc Ironfoot' });
    const race = h('input', { id: 'nc-race', type: 'text', autocomplete: 'off', placeholder: 'e.g. Dwarf' });
    const bg = h('input', { id: 'nc-bg', type: 'text', autocomplete: 'off', placeholder: 'e.g. Soldier' });
    const cls = classPicker('nc-class', true);
    const custom = customClassFields('nc');
    cls.addEventListener('change', () => { custom.box.hidden = cls.value !== '__custom'; });
    openModal({
      title: 'New character',
      body: h('div', {},
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', { for: 'nc-name' }, 'Name'), name),
          h('div', { class: 'field' }, h('label', { for: 'nc-class' }, 'Starting class'), cls),
          h('div', { class: 'field' }, h('label', { for: 'nc-race' }, 'Race / species'), race),
          h('div', { class: 'field' }, h('label', { for: 'nc-bg' }, 'Background'), bg)),
        custom.box,
        h('p', { class: 'hint' }, 'You can import race, background and class features with Import Homebrew afterwards. Saving throws and level 1 HP are set from the class.')),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create character', kind: 'primary',
          onClick: () => {
            const s = createSheet({
              name: name.value.trim(), race: race.value.trim(), background: bg.value.trim(),
              className: cls.value === '__custom' ? '' : cls.value,
              custom: cls.value === '__custom' ? custom.read() : null,
            });
            state.tab = 'overview';
            openSheet(s.id);
            toast('Character created. Set ability scores next.', 'ok');
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- quick build (SRD rules content)

  /** Load js/srd/srd-<ruleset>.js on first use (about 0.5 MB each), so the app itself stays light. */
  function loadSrd(ruleset) {
    if (window.QS_SRD && window.QS_SRD[ruleset]) return Promise.resolve(window.QS_SRD[ruleset]);
    return new Promise((resolve, reject) => {
      const tag = h('script', { src: `js/srd/srd-${ruleset}.js` });
      tag.onload = () => (window.QS_SRD && window.QS_SRD[ruleset] ? resolve(window.QS_SRD[ruleset]) : reject(new Error('empty')));
      tag.onerror = () => reject(new Error('missing'));
      document.head.append(tag);
    }).catch(() => {
      throw new Error("Couldn't load the rules content. If you opened index.html directly from a folder, run the site through a local server instead (see README).");
    });
  }

  const prettyCat = id => id.replace(/-/g, ' ').replace(/\bweapons\b/, 'weapon').replace(/s$/, '');

  /**
   * resume: { ruleset, ch, custom, touchedSkills, rolled } to reopen with earlier choices
   * (after adding homebrew or managing the library).
   */
  async function openQuickBuild(resume = null) {
    let ruleset = resume ? resume.ruleset : Store.getPref('ruleset', '2024');
    let srd;
    try { srd = await loadSrd(ruleset); } catch (e) { toast(e.message, 'error'); return; }
    // Typed names for the "Custom…" entries in the subclass, race and background lists.
    const custom = resume ? resume.custom : { sub: '', race: '', bg: '' };
    let lib = Homebrew.load();
    let data;
    const rebuildData = () => {
      const merged = Homebrew.merge(srd, lib);
      data = {
        ...merged,
        classes: merged.classes.map(c => ({ ...c, subclasses: [...c.subclasses, { id: '__custom', n: custom.sub.trim() || 'Custom subclass', d: '', f: [], custom: true }] })),
        races: [...merged.races, { id: '__custom', n: custom.race.trim() || 'Custom race', speed: 30, size: 'Medium', asi: [], asiOptions: null, languages: ['Common'], traits: [], skills: [], subs: [], custom: true }],
        backgrounds: [...merged.backgrounds, { id: '__custom', n: custom.bg.trim() || 'Custom background', skills: [], tools: [], equip: [], equipOptions: [], gold: 0, custom: true }],
      };
    };
    rebuildData();
    const byId = (list, id) => list.find(x => x.id === id) || null;
    let ch = resume && byId(data.classes, resume.ch.classId) ? resume.ch : QuickBuild.defaults(data, 'fighter');
    let touchedSkills = resume ? resume.touchedSkills : false;
    let rolled = resume ? resume.rolled : null;
    const body = h('div', { class: 'qb' });

    const cls = () => byId(data.classes, ch.classId);
    const snapshot = () => ({ ruleset, ch, custom, touchedSkills, rolled });
    const optLabel = x => `${x.n}${x.hb ? ' — homebrew' : ''}`;
    const withCustom = (list, label) => list.map(x => [x.id, x.custom ? label : optLabel(x)]);

    /** A text box under a "Custom…" pick, for the name to use. */
    function customName(key, label, placeholder) {
      return h('input', {
        id: `qb-custom-${key}`, type: 'text', class: 'qb-custom', value: custom[key], placeholder, autocomplete: 'off', 'aria-label': label,
        oninput: e => { custom[key] = e.target.value; },
        onchange: () => { rebuildData(); rerender(); },
      });
    }

    function goAddHomebrew() {
      const back = snapshot();
      openImport('', { library: true, onDone: () => openQuickBuild(back), onCancel: () => openQuickBuild(back) });
    }

    function goManageHomebrew() {
      const back = snapshot();
      openHomebrewManager(() => openQuickBuild(back));
    }

    function resetForClass(classId) {
      const keep = { name: ch.name, level: ch.level };
      ch = { ...QuickBuild.defaults(data, classId), ...keep };
      touchedSkills = false;
      rolled = null;
    }

    function refreshSkills() {
      const c = cls();
      const fixed = new Set([...(byId(data.backgrounds, ch.backgroundId) || { skills: [] }).skills, ...QuickBuild.raceSkills(data, ch.raceId, ch.subraceId)]);
      if (!touchedSkills) { ch.skills = QuickBuild.defaultSkills(data, c, ch.backgroundId, [...fixed]); return; }
      ch.skills = ch.skills.filter(k => !fixed.has(k));
    }

    function baseFor(method) {
      const prio = QuickBuild.priorityOf(cls());
      if (method === 'standard') return QuickBuild.assignByPriority(QuickBuild.STANDARD, prio);
      if (method === 'pointbuy') return QuickBuild.assignByPriority(QuickBuild.POINT_BUY_DEFAULT, prio);
      if (method === 'roll') { rolled = Array.from({ length: 6 }, QuickBuild.roll4d6); return QuickBuild.assignByPriority(rolled, prio); }
      return { ...ch.base };
    }

    const rerender = () => {
      const focusId = document.activeElement && body.contains(document.activeElement) ? document.activeElement.id : null;
      body.replaceChildren(...view());
      if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
    };

    const sel = (id, label, value, options, onChange, extra = {}) => h('div', { class: `field ${extra.class || ''}` },
      h('label', { for: id }, label),
      h('select', { id, onchange: e => { onChange(e.target.value); rerender(); } },
        options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))),
      extra.hint ? h('span', { class: 'hint' }, extra.hint) : null);

    function abilityRow() {
      const sc = QuickBuild.scores(data, ch);
      const pool = ch.method === 'standard' ? QuickBuild.STANDARD : ch.method === 'roll' ? rolled : null;
      const cells = QuickBuild.ABIL.map(a => {
        let control;
        const id = `qb-ab-${a}`;
        if (pool) {
          control = h('select', {
            id, 'aria-label': `${a.toUpperCase()} base score`,
            onchange: e => {
              const v = Number(e.target.value);
              const other = QuickBuild.ABIL.find(x => x !== a && ch.base[x] === v);
              if (other) ch.base[other] = ch.base[a];
              ch.base[a] = v;
              rerender();
            },
          }, [...new Set(pool)].sort((x, y) => y - x).map(v => h('option', { value: v, selected: v === ch.base[a] }, v)));
        } else {
          const [min, max] = ch.method === 'pointbuy' ? [8, 15] : [3, 18];
          control = h('input', {
            id, type: 'number', min, max, inputmode: 'numeric', value: ch.base[a], 'aria-label': `${a.toUpperCase()} base score`,
            onchange: e => { ch.base[a] = Math.max(min, Math.min(max, Math.round(toNum(e.target.value)) || min)); rerender(); },
          });
        }
        const extra = sc.bonus[a] + sc.asi[a];
        return h('div', { class: 'qb-ab' },
          h('span', { class: 'ab-label' }, a.toUpperCase()),
          control,
          h('span', { class: 'muted small' }, extra ? `${extra > 0 ? '+' : ''}${extra}` : '—'),
          h('strong', { class: 'qb-final' }, String(sc.final[a])),
          h('span', { class: 'muted small' }, fmt(Rules.mod(sc.final[a]))));
      });
      const spent = ch.method === 'pointbuy' ? QuickBuild.pointBuyCost(ch.base) : 0;
      return [
        h('div', { class: 'qb-ab-head' },
          sel('qb-method', 'Ability scores', ch.method,
            [['standard', 'Standard array (15, 14, 13, 12, 10, 8)'], ['pointbuy', 'Point buy (27 points)'], ['roll', 'Roll 4d6, drop lowest'], ['manual', 'Enter my own']],
            v => { ch.method = v; ch.base = baseFor(v); }),
          ch.method === 'roll' ? h('button', { type: 'button', class: 'btn small', onclick: () => { ch.base = baseFor('roll'); rerender(); } }, '🎲 Re-roll') : null),
        h('div', { class: 'qb-abilities' }, cells),
        ch.method === 'pointbuy' ? h('p', { class: spent > 27 ? 'field-error' : 'hint' }, `${27 - spent} of 27 points left${spent > 27 ? ' — lower a score' : ''}`) : null,
        sc.notes.length ? h('ul', { class: 'qb-notes' }, sc.notes.map(n => h('li', {}, n))) : null,
        h('p', { class: 'hint' }, 'Scores start in the best spots for your class. Swap any two by picking a different value.'),
      ];
    }

    function skillsBlock() {
      const c = cls();
      if (!c.skills) return [];
      const fixed = [...new Set([...(byId(data.backgrounds, ch.backgroundId) || { skills: [] }).skills, ...QuickBuild.raceSkills(data, ch.raceId, ch.subraceId)])];
      const nameOf = k => (Rules.SKILLS.find(s => s.key === k) || { name: k }).name;
      const full = ch.skills.length >= c.skills.choose;
      return [
        h('h4', {}, `Skills — pick ${c.skills.choose} (${ch.skills.length} chosen)`),
        fixed.length ? h('p', { class: 'hint' }, `Already from race/background: ${fixed.map(nameOf).join(', ')}`) : null,
        h('div', { class: 'qb-skills' }, c.skills.from.filter(k => !fixed.includes(k)).map(k => {
          const on = ch.skills.includes(k);
          return h('label', { class: 'check' },
            h('input', {
              type: 'checkbox', checked: on, disabled: !on && full ? true : null,
              onchange: e => { touchedSkills = true; ch.skills = e.target.checked ? [...ch.skills, k] : ch.skills.filter(x => x !== k); rerender(); },
            }),
            h('span', {}, nameOf(k)));
        })),
      ];
    }

    function equipBlock() {
      const c = cls();
      const bg = byId(data.backgrounds, ch.backgroundId);
      const label = entries => entries.map(e => e.gp ? `${e.gp} gp` : e.cat ? `any ${prettyCat(e.cat)}` : `${e.q > 1 ? `${e.q}× ` : ''}${(data.equipment[e.i] || {}).n || e.i}`).join(', ');
      const rows = [];
      const optionRow = (opt, key, title) => {
        const chosen = Number(ch.equip[key] || 0);
        rows.push(opt.choices.length > 1
          ? sel(`qb-eq-${key}`, title, chosen, opt.choices.map((c2, i) => [i, label(c2)]), v => { ch.equip[key] = Number(v); })
          : h('p', { class: 'hint' }, `${title}: ${label(opt.choices[0])}`));
        (opt.choices[chosen] || []).forEach((e, j) => {
          if (!e.cat) return;
          const list = data.categories[e.cat] || [];
          const pickKey = `${key}-${j}`;
          const current = ch.picks[pickKey] || QuickBuild.categoryDefault(data, c, e.cat);
          rows.push(sel(`qb-pick-${pickKey}`, `Which ${prettyCat(e.cat)}?`, current,
            list.map(id => [id, data.equipment[id].n]), v => { ch.picks[pickKey] = v; }, { class: 'qb-pick' }));
        });
      };
      c.equipOptions.forEach((opt, i) => optionRow(opt, `o${i}`, `${c.n} gear ${c.equipOptions.length > 1 ? i + 1 : ''}`.trim()));
      if (bg) bg.equipOptions.forEach((opt, i) => optionRow(opt, `b${i}`, `${bg.n} gear`));
      const fixed = [...c.equip, ...(bg ? bg.equip : [])];
      return [
        h('h4', {}, 'Starting equipment'),
        fixed.length ? h('p', { class: 'hint' }, `Always included: ${label(fixed)}${bg && bg.gold ? `, ${bg.gold} gp` : ''}`) : null,
        ...rows,
        !fixed.length && !rows.length ? h('p', { class: 'hint' }, 'No starting gear is listed for this choice. Add items on the Gear tab after creating the character.') : null,
      ];
    }

    function view() {
      const c = cls();
      const race = byId(data.races, ch.raceId);
      const sub = byId(c.subclasses, ch.subclassId);
      let preview = null;
      try { preview = QuickBuild.build(data, { ...ch, name: ch.name || 'Preview' }); } catch (_) { /* shown below */ }
      const pc = ch.method === 'pointbuy' && QuickBuild.pointBuyCost(ch.base) > 27;
      return [
        h('div', { class: 'qb-top' },
          h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rules version' },
            [['2024', '2024 rules'], ['2014', '2014 rules']].map(([v, l]) => h('button', {
              type: 'button', role: 'radio', 'aria-checked': String(ruleset === v), class: `seg-btn${ruleset === v ? ' on' : ''}`,
              onclick: async () => {
                if (ruleset === v) return;
                try { srd = await loadSrd(v); } catch (e) { toast(e.message, 'error'); return; }
                rebuildData();
                ruleset = v;
                Store.setPref('ruleset', v);
                const keep = { name: ch.name, level: ch.level };
                ch = { ...QuickBuild.defaults(data, byId(data.classes, ch.classId) ? ch.classId : data.classes[0].id), ...keep };
                touchedSkills = false;
                rerender();
              },
            }, l))),
          h('div', { class: 'field qb-name' },
            h('label', { for: 'qb-name' }, 'Name (optional)'),
            h('div', { class: 'row' },
              h('input', { id: 'qb-name', type: 'text', value: ch.name, placeholder: 'Leave blank for a random name', autocomplete: 'off', oninput: e => { ch.name = e.target.value; } }),
              h('button', { type: 'button', class: 'btn small', 'aria-label': 'Random name', onclick: () => { ch.name = QuickBuild.randomName(); rerender(); } }, '🎲')))),
        h('div', { class: 'qb-homebrew' },
          h('span', {}, '📥 ', h('strong', {}, 'Homebrew: '),
            Homebrew.count(lib)
              ? `${lib.subclasses.length} subclass${lib.subclasses.length === 1 ? '' : 'es'}, ${lib.classes.length} class${lib.classes.length === 1 ? '' : 'es'}, ${lib.races.length} race${lib.races.length === 1 ? '' : 's'}, ${lib.backgrounds.length} background${lib.backgrounds.length === 1 ? '' : 's'} in your library`
              : 'none yet. Add your own subclasses, classes, races and backgrounds to pick them below.'),
          h('span', { class: 'qb-homebrew-btns' },
            h('button', { type: 'button', class: 'btn small', onclick: goAddHomebrew }, '+ Add homebrew'),
            Homebrew.count(lib) ? h('button', { type: 'button', class: 'btn small', onclick: goManageHomebrew }, 'Manage') : null)),
        h('div', { class: 'grid-3' },
          sel('qb-class', 'Class', ch.classId, data.classes.map(x => [x.id, `${x.n} (d${x.hd})${x.hb ? ' — homebrew' : ''}`]), v => resetForClass(v)),
          h('div', { class: 'qb-stack' },
            sel('qb-sub', 'Subclass', ch.subclassId, withCustom(c.subclasses, 'Custom… (type a name)'), v => { ch.subclassId = v; },
              { hint: c.subLevel > 1 ? `Gained at ${c.n} level ${c.subLevel}` : '' }),
            ch.subclassId === '__custom' ? customName('sub', 'Custom subclass name', 'Subclass name') : null),
          sel('qb-level', 'Starting level', ch.level, Array.from({ length: 20 }, (_, i) => [i + 1, `Level ${i + 1}`]), v => { ch.level = Number(v); })),
        sub && sub.d ? h('p', { class: 'hint qb-desc' }, sub.d.split('\n')[0].slice(0, 260)) : null,
        sub && sub.custom ? h('p', { class: 'hint qb-desc' }, 'A custom subclass is just a name. Add its features later with Import Homebrew or the Features tab, or save it to your library first with "+ Add homebrew".') : null,
        h('div', { class: 'grid-3' },
          h('div', { class: 'qb-stack' },
            sel('qb-race', ruleset === '2024' ? 'Species' : 'Race', ch.raceId, withCustom(data.races, 'Custom… (type a name)'), v => {
              ch.raceId = v;
              const r = byId(data.races, v);
              ch.subraceId = r && r.subs.length ? r.subs[0].id : '';
              refreshSkills();
            }),
            ch.raceId === '__custom' ? customName('race', 'Custom race name', ruleset === '2024' ? 'Species name' : 'Race name') : null),
          race && race.subs.length ? sel('qb-subrace', ruleset === '2024' ? 'Lineage / ancestry' : 'Subrace', ch.subraceId, race.subs.map(x => [x.id, x.n]), v => { ch.subraceId = v; refreshSkills(); }) : h('div'),
          h('div', { class: 'qb-stack' },
            sel('qb-bg', 'Background', ch.backgroundId, withCustom(data.backgrounds, 'Custom… (type a name)'), v => { ch.backgroundId = v; ch.equip = Object.fromEntries(Object.entries(ch.equip).filter(([k]) => !k.startsWith('b'))); refreshSkills(); },
              { hint: srd.backgrounds.length === 1 && ch.backgroundId === srd.backgrounds[0].id ? 'The 2014 SRD has one background. Pick Custom… or add homebrew for others.' : '' }),
            ch.backgroundId === '__custom' ? customName('bg', 'Custom background name', 'Background name') : null)),
        h('div', { class: 'sub' }, abilityRow()),
        h('div', { class: 'sub' }, skillsBlock()),
        h('div', { class: 'sub' }, equipBlock()),
        preview ? h('div', { class: 'lu-summary qb-summary', 'aria-live': 'polite' },
          h('strong', {}, `Level ${ch.level} ${preview.race} ${c.n}${preview.classes[0].subclass ? ` (${preview.classes[0].subclass})` : ''}`),
          h('span', {}, ` · HP ${preview.combat.hpMax} · AC ${preview.combat.ac} · ${preview.attacks.length} attack${preview.attacks.length === 1 ? '' : 's'}`
            + `${preview.spellcasting.spells.length ? ` · ${preview.spellcasting.spells.length} spells` : ''} · ${preview.features.length} features`
            + `${preview.pendingFeatures.length ? ` (+${preview.pendingFeatures.length} saved for later levels)` : ''}`)) : null,
        pc ? h('p', { class: 'field-error' }, 'Point buy is over 27 points.') : null,
      ];
    }

    function create() {
      if (ch.method === 'pointbuy' && QuickBuild.pointBuyCost(ch.base) > 27) { toast('Point buy is over 27 points — lower a score first.', 'error'); return false; }
      rebuildData(); // pick up a custom name typed just before pressing Create
      let sheet;
      try { sheet = Schema.normalize(QuickBuild.build(data, ch)).sheet; } catch (e) { toast(`Couldn't build: ${e.message}`, 'error'); return false; }
      state.sheets[sheet.id] = sheet;
      state.tab = 'overview';
      openSheet(sheet.id);
      toast(`${sheet.name} is ready to play!`, 'ok');
      return true;
    }

    body.replaceChildren(...view());
    openModal({
      title: '⚡ Quick Build',
      body: h('div', {},
        h('p', { class: 'qb-intro' }, 'Everything is pre-filled with good choices. Press ', h('strong', {}, 'Create character'), ' now, or change anything first.'),
        body),
      wide: true,
      actions: [{ label: 'Cancel' }, { label: 'Create character', kind: 'primary', onClick: () => create() }],
    });
  }

  /** List and remove homebrew library entries. onClose runs when the dialog closes (e.g. back to Quick Build). */
  function openHomebrewManager(onClose = null) {
    const lib = Homebrew.load();
    const body = h('div', { class: 'hb-manager' });
    const groups = [['subclasses', 'Subclasses'], ['classes', 'Classes'], ['races', 'Races / species'], ['backgrounds', 'Backgrounds']];
    const draw = () => {
      body.replaceChildren(
        Homebrew.count(lib) ? null : h('p', {}, 'Your homebrew library is empty.'),
        ...groups.filter(([k]) => lib[k].length).map(([k, label]) => h('section', {},
          h('h4', {}, label),
          h('ul', { class: 'pending-list' }, lib[k].map((e, i) => h('li', {},
            h('span', { class: 'badge' }, k === 'subclasses' ? e.className || '?' : k === 'classes' ? `d${e.hd}` : 'HB'),
            h('span', { class: 'pending-name' }, h('strong', {}, e.n),
              h('span', { class: 'muted small' }, ` · ${k === 'subclasses' || k === 'races' ? `${(e.f || e.traits || []).length} feature${(e.f || e.traits || []).length === 1 ? '' : 's'}` : e.src || 'Homebrew'}`)),
            h('button', {
              type: 'button', class: 'icon-btn', 'aria-label': `Remove ${e.n}`,
              onclick: () => { lib[k].splice(i, 1); try { Homebrew.save(lib); } catch (err) { toast(err.message, 'error'); } draw(); },
            }, '✕')))))),
        h('p', { class: 'hint' }, 'Removing an entry only takes it out of Quick Build. Characters already made with it keep their features.'));
    };
    draw();
    openModal({ title: 'Homebrew library', body, actions: [{ label: 'Done', kind: 'primary' }], onClose });
  }

  // ---------------------------------------------------------------- level-up wizard

  function openLevelUp() {
    const s = active();
    const total = Rules.totalLevel(s);
    if (total >= 20) { toast('Already level 20 — the pinnacle of adventuring!'); return; }
    const conMod = Rules.mod(s.abilities.con);

    const cls = h('select', { id: 'lu-class' });
    s.classes.forEach((c, i) => cls.append(h('option', { value: `i:${i}` }, `${c.name || 'Unnamed class'} ${c.level} → ${c.level + 1}`)));
    const group = h('optgroup', { label: s.classes.length ? 'Multiclass into…' : 'Choose a class' });
    Object.keys(Rules.CLASSES)
      .filter(n => !s.classes.some(c => c.name.trim().toLowerCase() === n.toLowerCase()))
      .forEach(n => group.append(h('option', { value: `n:${n}` }, `${n} (d${Rules.CLASSES[n].hitDie})`)));
    group.append(h('option', { value: '__custom' }, 'Custom / homebrew…'));
    cls.append(group);
    const custom = customClassFields('lu');

    const hpModes = h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Hit point method' },
      ['avg', 'roll', 'manual'].map(m => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'lu-hp', value: m, checked: m === 'avg' }),
        h('span', {}, { avg: 'Take average', roll: 'Roll', manual: 'Enter total' }[m]))));
    const rollBtn = h('button', { type: 'button', class: 'btn small' }, '🎲 Roll');
    const manual = h('input', { type: 'number', min: 1, inputmode: 'numeric', 'aria-label': 'HP gained', class: 'tiny-input' });
    const hpOut = h('p', { class: 'strong', 'aria-live': 'polite' });
    const hpBox = h('div', { class: 'sub' }, h('h4', {}, 'Hit points'), hpModes, h('div', { class: 'btn-row' }, rollBtn, manual), hpOut);

    const abilityOpts = () => ABILITIES.map(a => h('option', { value: a.key }, `${a.name} (${s.abilities[a.key]})`));
    const asiA = h('select', { 'aria-label': 'Ability to increase' }, abilityOpts());
    const asiB = h('select', { 'aria-label': 'Second ability to increase' }, abilityOpts());
    const featName = h('input', { type: 'text', placeholder: 'Feat name', 'aria-label': 'Feat name', autocomplete: 'off' });
    const featDesc = h('textarea', { rows: 3, placeholder: 'Feat description (or import it later)', 'aria-label': 'Feat description' });
    const asiModes = h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Ability Score Improvement' },
      [['plus2', '+2 to one'], ['split', '+1 to two'], ['feat', 'Take a feat'], ['later', 'Decide later']].map(([v, l]) => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'lu-asi', value: v, checked: v === 'plus2' }), h('span', {}, l))));
    const asiBox = h('div', { class: 'sub asi' }, h('h4', {}, 'Ability Score Improvement'), asiModes,
      h('div', { class: 'grid-2' }, asiA, asiB), h('div', { class: 'feat-fields' }, featName, featDesc));

    const subclass = h('input', { id: 'lu-sub', type: 'text', autocomplete: 'off', placeholder: 'e.g. Battle Master' });
    const features = h('textarea', { id: 'lu-feat', rows: 4, placeholder: 'One per line, e.g.\nAction Surge: Take one additional action.\nExtra Attack' });
    const err = h('p', { class: 'field-error', role: 'alert' });
    const summary = h('p', { class: 'lu-summary', 'aria-live': 'polite' });

    // Imported features waiting for this class level (see "Coming up" on the Progression tab).
    const skipped = new Set();
    const pendingList = h('div', { class: 'pending-picks' });
    const pendingBox = h('div', { class: 'sub pending-box' },
      h('h4', {}, 'Features from your imported homebrew'),
      h('p', { class: 'hint' }, 'These unlock at this level. Untick any you don\'t want to add now.'),
      pendingList);
    function pendingFor(c) {
      const sub = subclass.value.trim() || c.subclass || '';
      return s.pendingFeatures
        .filter(p => sameName(p.className, c.name) && p.level <= c.newLevel && (!p.subclass || !sub || sameName(p.subclass, sub)))
        .sort((a, b) => a.level - b.level);
    }

    let rolled = null;
    const radio = name => (dialog.querySelector(`input[name="${name}"]:checked`) || {}).value;

    function current() {
      const v = cls.value;
      if (v.startsWith('i:')) {
        const i = Number(v.slice(2));
        const c = s.classes[i];
        return { index: i, name: c.name, hitDie: Number(c.hitDie) || 8, caster: c.caster, newLevel: c.level + 1, subclass: c.subclass };
      }
      if (v === '__custom') return { index: -1, ...custom.read(), newLevel: 1, subclass: '' };
      const info = Rules.classInfo(v.slice(2));
      return { index: -1, ...info, newLevel: 1, subclass: '' };
    }

    function hpGain(c) {
      if (total === 0) return Math.max(1, c.hitDie + conMod);
      const mode = radio('lu-hp');
      if (mode === 'manual') return Math.max(1, Math.round(toNum(manual.value)));
      const base = mode === 'roll' ? (rolled || 0) : Math.floor(c.hitDie / 2) + 1;
      return Math.max(1, base + conMod);
    }

    function update() {
      const c = current();
      custom.box.hidden = cls.value !== '__custom';
      const mode = radio('lu-hp');
      rollBtn.hidden = mode !== 'roll';
      manual.hidden = mode !== 'manual';
      hpModes.hidden = total === 0;
      if (total === 0) hpOut.textContent = `First level: max hit die d${c.hitDie} ${fmt(conMod)} CON = ${hpGain(c)} HP`;
      else if (mode === 'avg') hpOut.textContent = `Average d${c.hitDie} (${Math.floor(c.hitDie / 2) + 1}) ${fmt(conMod)} CON = +${hpGain(c)} HP`;
      else if (mode === 'roll') hpOut.textContent = rolled ? `Rolled ${rolled} ${fmt(conMod)} CON = +${hpGain(c)} HP` : `Roll a d${c.hitDie}, or one is rolled when you apply.`;
      else hpOut.textContent = manual.value ? `+${hpGain(c)} HP` : 'Enter the total HP gained (including CON).';
      const asi = Rules.isAsiLevel(c.name, c.newLevel);
      asiBox.hidden = !asi;
      const am = radio('lu-asi');
      asiA.hidden = am === 'feat' || am === 'later';
      asiB.hidden = am !== 'split';
      featName.parentElement.hidden = am !== 'feat';
      summary.textContent = `Level ${total + 1}: ${c.name} ${c.newLevel}${asi ? ' · Ability Score Improvement' : ''} · new proficiency bonus ${fmt(Rules.profBonus(total + 1))}`;
      if (!subclass.dataset.touched) subclass.value = c.index >= 0 ? (c.subclass || '') : '';
      const offered = pendingFor(c);
      pendingBox.hidden = !offered.length;
      pendingList.replaceChildren(...offered.map(p => {
        const box = h('input', { type: 'checkbox', checked: !skipped.has(p), 'aria-label': `Add ${p.name}` });
        box.addEventListener('change', () => { if (box.checked) skipped.delete(p); else skipped.add(p); });
        return h('label', { class: 'check pending-pick' }, box,
          h('span', {}, h('strong', {}, p.name), h('span', { class: 'muted small' }, ` · level ${p.level}${p.subclass ? ` · ${p.subclass}` : ''}`)));
      }));
    }

    rollBtn.addEventListener('click', () => { rolled = rollDie(current().hitDie); update(); });
    subclass.addEventListener('input', () => { subclass.dataset.touched = '1'; update(); });
    cls.addEventListener('change', () => { rolled = null; subclass.dataset.touched = ''; update(); });

    const body = h('div', { class: 'levelup' },
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'lu-class' }, total ? 'Class to advance' : 'Class'), cls),
        h('div', { class: 'field' }, h('label', { for: 'lu-sub' }, 'Subclass (if chosen)'), subclass)),
      custom.box, hpBox, asiBox, pendingBox,
      h('div', { class: 'field' }, h('label', { for: 'lu-feat' }, 'Other new features (optional)'), features),
      h('p', { class: 'hint' }, 'Tip: you can also paste class features with Import Homebrew after levelling.'),
      summary, err);
    body.addEventListener('change', update);
    body.addEventListener('input', e => { if (e.target === manual || e.target.closest('.custom-class')) update(); });

    openModal({
      title: total ? `Level up to ${total + 1}` : 'Choose your first class',
      body, wide: true,
      actions: [{ label: 'Cancel' }, { label: 'Apply level-up', kind: 'primary', onClick: () => applyLevelUp() }],
    });
    update();

    function applyLevelUp() {
      err.textContent = '';
      const c = current();
      const mode = radio('lu-hp');
      if (total > 0 && mode === 'manual' && !(toNum(manual.value) > 0)) { err.textContent = 'Enter how many hit points you gained.'; manual.focus(); return false; }
      if (total > 0 && mode === 'roll' && !rolled) rolled = rollDie(c.hitDie);
      const asi = Rules.isAsiLevel(c.name, c.newLevel) ? radio('lu-asi') : null;
      if (asi === 'split' && asiA.value === asiB.value) { err.textContent = 'Pick two different abilities for +1 each, or choose +2 to one.'; return false; }
      if (asi === 'feat' && !featName.value.trim()) { err.textContent = 'Give the feat a name.'; featName.focus(); return false; }

      const snap = snapshotOf(s);
      const gain = hpGain(c);
      const unlocked = pendingFor(c).filter(p => !skipped.has(p));
      let cls0;
      if (c.index >= 0) {
        cls0 = s.classes[c.index];
        cls0.level += 1;
      } else {
        cls0 = { name: c.name, subclass: '', level: 1, hitDie: c.hitDie, caster: c.caster || 'none' };
        s.classes.push(cls0);
        if (total === 0) (c.saves || []).forEach(a => { s.saveProf[a] = true; });
        if (!s.spellcasting.ability && c.spellAbility) s.spellcasting.ability = c.spellAbility;
      }
      if (subclass.value.trim()) cls0.subclass = subclass.value.trim();
      s.combat.hpMax += gain;
      s.combat.hpCurrent += gain;

      const notes = [`+${gain} HP`];
      if (asi === 'plus2') {
        s.abilities[asiA.value] = Math.min(20, s.abilities[asiA.value] + 2);
        notes.push(`+2 ${asiA.value.toUpperCase()}`);
      } else if (asi === 'split') {
        [asiA.value, asiB.value].forEach(k => { s.abilities[k] = Math.min(20, s.abilities[k] + 1); });
        notes.push(`+1 ${asiA.value.toUpperCase()}, +1 ${asiB.value.toUpperCase()}`);
      } else if (asi === 'feat') {
        s.features.push({ name: featName.value.trim(), origin: 'Feat', source: `${c.name} ${c.newLevel}`, description: featDesc.value.trim() });
        notes.push(`feat: ${featName.value.trim()}`);
      } else if (asi === 'later') {
        notes.push('ASI pending');
      }
      const newFeatures = features.value.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of newFeatures) {
        const idx = line.indexOf(':');
        s.features.push({
          name: idx > 0 ? line.slice(0, idx).trim() : line,
          origin: 'Class', source: `${c.name} ${c.newLevel}`,
          description: idx > 0 ? line.slice(idx + 1).trim() : '',
        });
      }
      for (const p of unlocked) {
        if (p.subclass && !cls0.subclass) cls0.subclass = p.subclass;
        s.features.push({
          name: p.name, origin: 'Class', description: p.description,
          source: `${cls0.name}${p.subclass ? ` (${p.subclass})` : ''} ${p.level}`,
        });
        s.pendingFeatures.splice(s.pendingFeatures.indexOf(p), 1);
      }
      const gained = newFeatures.length + unlocked.length;
      if (gained) notes.push(`${gained} feature${gained > 1 ? 's' : ''}`);
      const text = `Reached level ${total + 1} — ${c.name} ${c.newLevel} (${notes.join(', ')})`;
      logHistory(s, 'level-up', text, snap);
      commit({ roster: true });
      renderMain();
      toast(`🎉 ${text}`, 'ok');
      return true;
    }
  }

  // ---------------------------------------------------------------- display & offline

  const TEXT_SIZES = [['0', 'Normal'], ['1', 'Large'], ['2', 'Larger'], ['3', 'Largest']];

  function applyDisplayPrefs() {
    const root = document.documentElement;
    root.dataset.text = Store.getPref('textSize', '0');
    if (Store.getPref('easyRead', false)) root.dataset.read = 'easy'; else delete root.dataset.read;
  }

  function openDisplaySettings() {
    const sizeBtns = TEXT_SIZES.map(([v, label]) => h('button', {
      type: 'button', class: `seg-btn${Store.getPref('textSize', '0') === v ? ' on' : ''}`, 'aria-pressed': String(Store.getPref('textSize', '0') === v),
      onclick: e => {
        Store.setPref('textSize', v);
        applyDisplayPrefs();
        sizeBtns.forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
        e.currentTarget.classList.add('on');
        e.currentTarget.setAttribute('aria-pressed', 'true');
      },
    }, label));
    const easy = !!Store.getPref('easyRead', false);
    const easyBtn = h('button', {
      type: 'button', class: `switch${easy ? ' on' : ''}`, role: 'switch', 'aria-checked': String(easy),
      onclick: () => {
        const on = !Store.getPref('easyRead', false);
        Store.setPref('easyRead', on);
        applyDisplayPrefs();
        easyBtn.classList.toggle('on', on);
        easyBtn.setAttribute('aria-checked', String(on));
      },
    }, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }), 'Easy-read text');
    openModal({
      title: 'Display',
      body: h('div', { class: 'display-settings' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Text size'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Text size' }, sizeBtns)),
        easyBtn,
        h('p', { class: 'hint' }, 'Easy-read uses the OpenDyslexic font with taller lines and removes capitals-only labels and italics.'),
        h('p', { class: 'hint' }, 'These settings are saved on this device only.')),
      actions: [{ label: 'Done', kind: 'primary' }],
    });
  }

  /** Keep a copy of the site on the device so it opens with no signal. Needs https or localhost. */
  function registerOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      if (Store.getPref('offlineReady', false)) return;
      Store.setPref('offlineReady', true);
      toast('Quillsheet is now saved on this device, so it will open with no internet.', 'ok');
    }).catch(() => { /* offline copy is a bonus; the site still works online */ });
  }

  // ---------------------------------------------------------------- homebrew import

  const LIBRARY_TYPES = ['class', 'subclass', 'race', 'background'];
  const LIBRARY_TEXT_ACTIONS = [['lib-subclass', 'Save to library as a subclass'], ['lib-race', 'Save to library as a race/species'], ['lib-background', 'Save to library as a background']];
  const isLibraryAction = a => a === 'library' || a.startsWith('lib-');

  /** "Where should this go?" options for one entity. Library mode puts the homebrew library first. */
  function importActions(ent, libraryMode) {
    const lib = LIBRARY_TYPES.includes(ent.type) ? [['library', 'Save to homebrew library (for Quick Build)']]
      : ent.type === 'text' ? LIBRARY_TEXT_ACTIONS : [];
    return libraryMode ? [...lib, ...ent.actions] : [...ent.actions, ...lib];
  }

  /**
   * opts.library: opened from the home screen or Quick Build, so content goes to the homebrew library.
   * opts.onDone:  called after a successful import (Quick Build uses it to reopen with your choices).
   */
  function openImport(prefill = '', opts = {}) {
    const libraryMode = !!opts.library;
    const ta = h('textarea', { id: 'imp-text', class: 'mono', rows: 9, spellcheck: 'false', placeholder: 'Paste here — e.g. select the text of a spell, copy (Ctrl/Cmd+C) and paste (Ctrl/Cmd+V).' });
    ta.value = prefill;
    const fileIn = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', hidden: true });
    const errBox = h('div', { class: 'import-errors' });
    const preview = h('div', { class: 'import-preview', 'aria-live': 'polite' });
    let rows = [];

    const help = h('details', { class: 'help' },
      h('summary', {}, 'How to import homebrew'),
      h('ol', {},
        h('li', {}, h('strong', {}, 'Text: '), 'select the whole text of a spell, item, feat or creature (from its name to the last line), copy, and paste here. Spells and statblocks are recognised automatically.'),
        h('li', {}, h('strong', {}, 'JSON (most accurate): '), 'paste homebrew JSON, copying everything from the first { to the last }. Whole homebrew files work too — drop the file here.'),
        h('li', {}, 'Review the list, untick anything you don\'t want, choose where each entry goes, then Import.')),
      h('p', { class: 'hint' }, 'Nothing is sent anywhere: the text is read inside this page only.'));

    function analyze() {
      const res = Importer.parse(ta.value);
      errBox.replaceChildren();
      preview.replaceChildren();
      rows = [];
      if (res.errors.length) {
        errBox.append(h('div', { class: 'alert error', role: 'alert' },
          res.errors.map(er => h('div', { class: 'alert-item' },
            h('strong', {}, er.title), er.detail ? h('p', {}, er.detail) : null, er.hint ? h('p', { class: 'hint' }, `💡 ${er.hint}`) : null))));
      }
      if (res.warnings.length) {
        errBox.append(h('div', { class: 'alert warn', role: 'status' },
          h('strong', {}, `Heads up (${res.warnings.length})`),
          h('ul', {}, res.warnings.slice(0, 12).map(w => h('li', {}, w))),
          res.warnings.length > 12 ? h('p', {}, `…and ${res.warnings.length - 12} more.`) : null));
      }
      if (!res.entities.length) return;
      const cap = 300;
      if (res.entities.length > cap) errBox.append(h('div', { class: 'alert warn' }, `Showing the first ${cap} of ${res.entities.length} entries. Paste smaller batches to import the rest.`));
      if (res.subclassCount > 1) {
        errBox.append(h('div', { class: 'alert info', role: 'status' },
          h('strong', {}, `${res.subclassCount} subclasses found`),
          h('p', {}, libraryMode
            ? 'All of them are ticked to go into your library, so you can pick any of them in Quick Build. Untick any you don\'t want.'
            : 'Tick the one your character is taking. Only a subclass already set on your character is pre-ticked.')));
      }
      const all = h('input', { type: 'checkbox', 'aria-label': 'Select all' });
      all.addEventListener('change', () => rows.forEach(r => { r.check.checked = all.checked; }));
      preview.append(h('div', { class: 'imp-head' },
        h('label', { class: 'check' }, all, h('span', {}, `${Math.min(cap, res.entities.length)} found — choose what to add`))));
      res.entities.slice(0, cap).forEach(ent => {
        const libCapable = LIBRARY_TYPES.includes(ent.type) || ent.type === 'text';
        const checked = libraryMode ? libCapable : defaultChecked(ent, res);
        const check = h('input', { type: 'checkbox', checked, 'aria-label': `Include ${ent.name}` });
        const sel = h('select', { 'aria-label': `Where to add ${ent.name}` }, importActions(ent, libraryMode).map(([v, l]) => h('option', { value: v }, l)));
        rows.push({ ent, check, sel });
        preview.append(h('div', { class: 'imp-row' },
          check,
          h('div', { class: 'imp-main' },
            h('div', {}, h('span', { class: `badge t-${ent.type}` }, ent.typeLabel), ' ', h('strong', {}, ent.name), ent.source ? h('span', { class: 'muted' }, ` · ${ent.source}`) : null),
            ent.summary ? h('div', { class: 'muted small' }, ent.summary) : null,
            libraryMode && !libCapable ? h('div', { class: 'hint' }, active() ? `Goes onto ${active().name || 'the open character'}, not the library.` : 'Spells, items and feats go onto a character. Open one and import them there.') : null),
          sel));
        if (libraryMode && !libCapable && !active()) { check.disabled = true; sel.disabled = true; }
      });
      all.checked = rows.every(r => r.check.checked);
    }

    const analyzeSoon = debounce(analyze, 350);
    ta.addEventListener('input', analyzeSoon);
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      if (!f) return;
      if (f.size > 2e6) { toast('That file is over 2 MB. Try a smaller file.', 'error'); return; }
      ta.value = await f.text();
      analyze();
    });
    const drop = h('div', { class: 'drop-zone' }, ta);
    drop.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) { ta.value = await f.text(); analyze(); }
    });

    let finished = false;
    openModal({
      title: libraryMode ? 'Import Homebrew to your library' : 'Import Homebrew',
      wide: true,
      onClose: () => { if (!finished && opts.onCancel) opts.onCancel(); },
      body: h('div', { class: 'import' },
        libraryMode ? h('p', { class: 'alert info' },
          'Classes, subclasses, races/species and backgrounds you save here appear as choices in ', h('strong', {}, 'Quick Build'),
          ', marked "homebrew". They stay on this device for every character you make.') : null,
        help,
        h('label', { for: 'imp-text', class: 'label' }, 'Paste text or JSON'),
        drop,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small', onclick: analyze }, 'Check paste'),
          h('button', { type: 'button', class: 'btn small', onclick: () => fileIn.click() }, 'Load a .json file…'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { ta.value = ''; analyze(); ta.focus(); } }, 'Clear'),
          fileIn),
        errBox, preview),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import selected', kind: 'primary',
          onClick: async () => {
            if (!rows.length) analyze();
            const chosen = rows.filter(r => r.check.checked).map(r => ({ ent: r.ent, action: r.sel.value }));
            if (!chosen.length) {
              errBox.append(h('div', { class: 'alert error', role: 'alert' }, h('strong', {}, 'Nothing selected'), h('p', {}, 'Tick at least one entry to import.')));
              return false;
            }
            finished = true; // committed: follow-up prompts replacing this dialog aren't a cancel
            await applyImports(chosen);
            if (opts.onDone) opts.onDone();
            return true;
          },
        },
      ],
    });
    if (prefill) analyze();
  }

  /** Ask which class a pasted (text) subclass belongs to. Resolves a class name or null. */
  function chooseClassName(what, grouped) {
    return new Promise(resolve => {
      let done = false;
      const names = [...new Set([...Object.keys(Rules.CLASSES).filter(n => n !== 'Artificer'), ...Homebrew.load().classes.map(c => c.n)])].sort();
      const selEl = h('select', { id: 'ccn-sel' }, names.map(n => h('option', { value: n }, n)), h('option', { value: '__other' }, 'Other…'));
      const other = h('input', { id: 'ccn-other', type: 'text', placeholder: 'Class name', autocomplete: 'off', hidden: true });
      const lvl = h('select', { id: 'ccn-level' }, Array.from({ length: 20 }, (_, i) => h('option', { value: i + 1, selected: i === 2 }, `Level ${i + 1}`)));
      selEl.addEventListener('change', () => { other.hidden = selEl.value !== '__other'; });
      openModal({
        title: `Which class is "${what}" for?`,
        body: h('div', {},
          h('div', { class: 'grid-2' },
            h('div', { class: 'field' }, h('label', { for: 'ccn-sel' }, 'Class'), selEl, other),
            h('div', { class: 'field' }, h('label', { for: 'ccn-level' }, 'Gained at class level'), lvl)),
          h('p', { class: 'hint' }, grouped
            ? 'Features with a "Level N:" heading keep their own level. The level above is used for any without one.'
            : 'The pasted text becomes one subclass feature at that level. JSON imports keep each feature at its own level.')),
        actions: [
          { label: 'Skip this one' },
          {
            label: 'Save', kind: 'primary', onClick: () => {
              const name = selEl.value === '__other' ? other.value.trim() : selEl.value;
              if (!name) { other.focus(); return false; }
              done = true; resolve({ className: name, level: Number(lvl.value) }); return true;
            },
          },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  /** Save one importer entity to the homebrew library. Returns a short summary, or null if skipped. */
  async function saveToLibrary(ent, action) {
    let extra = {};
    if (action.startsWith('lib-')) extra.as = action.slice(4);
    if ((ent.type === 'subclass' && !ent.payload.className) || extra.as === 'subclass') {
      const pick = await chooseClassName(ent.name, !!(ent.payload && ent.payload.features));
      if (!pick) return null;
      extra = { ...extra, className: pick.className, level: pick.level };
    }
    const conv = Homebrew.fromEntity(ent, extra);
    if (!conv) throw new Error("this kind of entry can't go in the library");
    const lib = Homebrew.load();
    const how = Homebrew.add(lib, conv.kind, conv.entry);
    Homebrew.save(lib);
    const kindLabel = { classes: 'class', subclasses: `${conv.entry.className} subclass`, races: 'race/species', backgrounds: 'background' }[conv.kind];
    return `${conv.entry.n} (${kindLabel}) ${how === 'replaced' ? 'updated' : 'saved'}`;
  }

  function attackFromPayload(s, atk) {
    const pb = Rules.profBonus(Rules.totalLevel(s));
    const str = Rules.mod(s.abilities.str);
    const dex = Rules.mod(s.abilities.dex);
    const m = atk.ability === 'dex' ? dex : atk.ability === 'finesse' ? Math.max(str, dex) : str;
    return {
      name: atk.name, bonus: fmt(pb + m),
      damage: `${atk.dice}${m ? (m > 0 ? `+${m}` : m) : ''} ${atk.dmgType}`.trim(),
      notes: atk.notes,
    };
  }

  function applyStats(s, p) {
    Object.assign(s.abilities, p.abilities);
    if (p.ac != null) { s.combat.ac = p.ac; s.combat.acAuto = false; }
    if (p.hp != null) { s.combat.hpMax = p.hp; s.combat.hpCurrent = p.hp; }
    if (p.speed != null) s.combat.speed = p.speed;
    p.skills.forEach(k => { if (!s.skills[k]) s.skills[k] = 1; });
    p.saves.forEach(k => { s.saveProf[k] = true; });
    p.traits.forEach(t => s.features.push({ name: t.name, origin: 'Statblock', source: p.name, description: t.description }));
  }

  // ---------------------------------------------------------------- classes & subclasses from imports

  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== '';
  const findClass = (s, name) => s.classes.findIndex(c => sameName(c.name, name));

  /** Pre-tick sensible entries when a paste contains a whole class file. */
  function defaultChecked(ent, res) {
    const s = active();
    if (ent.type === 'subclass' && res.subclassCount > 1) {
      return !!s && s.classes.some(c => sameName(c.name, ent.payload.className)
        && (sameName(c.subclass, ent.payload.name) || sameName(c.subclass, ent.payload.shortName)));
    }
    if (ent.type === 'class' && (res.classCount > 1 || res.subclassCount > 0)) {
      return !!s && findClass(s, ent.name) >= 0;
    }
    return true;
  }

  /** Ask which of the character's classes an imported subclass/class belongs to. */
  function chooseClassDialog(s, what, className) {
    return new Promise(resolve => {
      let done = false;
      const sel = h('select', { id: 'cc-sel' },
        s.classes.map((c, i) => h('option', { value: i }, `${c.name || 'Unnamed class'} ${c.level}`)),
        className ? h('option', { value: 'later', selected: !s.classes.length }, `Keep for later (when I take ${className})`) : null);
      openModal({
        title: `Which class is "${what}" for?`,
        body: h('div', {},
          h('p', {}, className
            ? `"${what}" belongs to the ${className} class, which this character doesn't have.`
            : `"${what}" doesn't say which class it belongs to.`),
          h('div', { class: 'field' }, h('label', { for: 'cc-sel' }, 'Use it with'), sel),
          className ? h('p', { class: 'hint' }, '"Keep for later" stores its features, and the level-up wizard offers them when you reach the right level in that class.')
            : h('p', { class: 'hint' }, 'Features up to your level in that class are added now. Higher ones wait in "Coming up" for the level-up wizard.')),
        actions: [
          { label: 'Skip this one' },
          { label: 'Continue', kind: 'primary', onClick: () => { done = true; resolve(sel.value === 'later' ? { later: true } : { index: Number(sel.value) }); } },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  /** Add features the class has reached; queue the rest for the level-up wizard. */
  function distributeFeatures(s, features, className, subclassName, classLevel) {
    let added = 0;
    let queued = 0;
    const label = `${className}${subclassName ? ` (${subclassName})` : ''}`;
    for (const f of features) {
      if (f.level <= classLevel) {
        const exists = s.features.some(x => sameName(x.name, f.name) && x.origin === 'Class' && x.source.startsWith(label));
        if (!exists) { s.features.push({ name: f.name, origin: 'Class', source: `${label} ${f.level}`, description: f.description }); added++; }
      } else {
        const exists = s.pendingFeatures.some(p => sameName(p.className, className) && sameName(p.name, f.name) && p.level === f.level);
        if (!exists) { s.pendingFeatures.push({ className, subclass: subclassName || '', level: f.level, name: f.name, description: f.description, source: f.source }); queued++; }
      }
    }
    return { added, queued };
  }

  /** Handles both "Set as subclass" and "Add class features". Returns a summary string, or null if skipped. */
  async function applyClassContent(s, ent) {
    const p = ent.payload;
    const isSub = ent.type === 'subclass';
    const className = isSub ? p.className : p.name;
    // Pasted text has no class name, but its title line ("Monk") often is one.
    let idx = findClass(s, className || ent.name);
    if (idx < 0 && !className && !s.classes.length) return `${ent.name}: skipped, because this character has no class yet. Add one on the Stats tab, then import again`;
    if (idx < 0) {
      const choice = await chooseClassDialog(s, ent.name, className);
      if (!choice) return null;
      if (!choice.later) idx = choice.index;
    }
    const cls = idx >= 0 ? s.classes[idx] : null;
    const targetClass = cls ? cls.name : className;
    if (isSub && cls) cls.subclass = p.name;
    const { added, queued } = distributeFeatures(s, p.features, targetClass, isSub ? p.name : '', cls ? cls.level : 0);
    const bits = [];
    if (isSub && cls) bits.push(`set as ${cls.name} subclass`);
    if (added) bits.push(`${added} feature${added === 1 ? '' : 's'} added`);
    if (queued) bits.push(`${queued} saved for later levels`);
    if (!p.features.length) bits.push('no features were included in the paste');
    return `${ent.name}: ${bits.join(', ') || 'nothing new to add'}`;
  }

  async function applyImports(chosen) {
    // Library entries first: they never touch a character sheet.
    const libNotes = [];
    for (const { ent, action } of chosen.filter(c => isLibraryAction(c.action))) {
      try {
        const note = await saveToLibrary(ent, action);
        if (note) libNotes.push(note);
      } catch (e) {
        toast(`Couldn't save ${ent.name}: ${e.message}`, 'error');
      }
    }
    if (libNotes.length) {
      toast(`Homebrew library: ${libNotes.slice(0, 4).join(' · ')}${libNotes.length > 4 ? ` · and ${libNotes.length - 4} more` : ''}. Pick them in Quick Build.`, 'ok');
    }
    chosen = chosen.filter(c => !isLibraryAction(c.action));
    if (!chosen.length) return;

    let s = active();
    const touchesCurrent = chosen.some(c => c.action !== 'newCharacter');
    if (touchesCurrent && !s) {
      s = createSheet({ name: 'Imported character' });
      state.activeId = s.id;
    }
    const snap = s ? snapshotOf(s) : null;
    const counts = {};
    const failures = [];
    const classNotes = [];
    let lastNew = null;

    for (const { ent, action } of chosen) {
      try {
        if (action === 'subclass' || action === 'classFeatures') {
          const note = await applyClassContent(s, ent);
          if (note) { classNotes.push(note); counts[action] = (counts[action] || 0) + 1; }
          continue;
        }
        const asFeature = () => ({ name: ent.name, origin: ent.origin, source: ent.source, description: ent.text });
        switch (action) {
          case 'spell':
            s.spellcasting.spells.push(ent.type === 'spell' ? clone(ent.payload) : { ...clone(Schema.TEMPLATES.spell), name: ent.name, description: ent.text });
            break;
          case 'item':
            s.inventory.push(ent.type === 'item' ? clone(ent.payload.item) : { ...clone(Schema.TEMPLATES.item), name: ent.name, notes: ent.text });
            break;
          case 'item+attack':
            s.inventory.push(clone(ent.payload.item));
            s.attacks.push(attackFromPayload(s, ent.payload.attack));
            break;
          case 'attack':
            s.attacks.push(attackFromPayload(s, ent.payload.attack));
            break;
          case 'feature':
            s.features.push(asFeature());
            break;
          case 'features':
            ent.payload.features.forEach(f => s.features.push({
              name: f.name, origin: ent.origin,
              source: [f.level ? `Level ${f.level}` : '', f.source].filter(Boolean).join(' · '),
              description: f.description,
            }));
            break;
          case 'note':
            s.notes.general = `${s.notes.general ? `${s.notes.general.trimEnd()}\n\n` : ''}${ent.name}\n${ent.text}`.trim();
            break;
          case 'race':
            s.race = ent.payload.name;
            if (ent.payload.speed) s.combat.speed = ent.payload.speed;
            ent.payload.features.forEach(f => s.features.push({ name: f.name, origin: 'Race', source: ent.payload.name, description: f.description }));
            break;
          case 'background':
            s.background = ent.payload.name;
            ent.payload.skills.forEach(k => { if (!s.skills[k]) s.skills[k] = 1; });
            s.features.push({ name: `Background: ${ent.name}`, origin: 'Background', source: ent.source, description: ent.text });
            break;
          case 'applyStats':
            applyStats(s, ent.payload);
            break;
          case 'newCharacter': {
            if (ent.type === 'sheet') {
              const sheet = clone(ent.payload);
              if (state.sheets[sheet.id]) sheet.id = Schema.uid();
              logHistory(sheet, 'import', 'Imported character file');
              state.sheets[sheet.id] = sheet;
              lastNew = sheet;
            } else {
              const n = createSheet({ name: ent.name });
              applyStats(n, ent.payload);
              lastNew = n;
            }
            break;
          }
          default:
            throw new Error(`unknown action "${action}"`);
        }
        counts[action] = (counts[action] || 0) + 1;
      } catch (e) {
        failures.push(`${ent.name}: ${e.message}`);
      }
    }

    const done = Object.values(counts).reduce((a, b) => a + b, 0);
    if (s && touchesCurrent && done) logHistory(s, 'import', `Imported ${chosen.filter(c => c.action !== 'newCharacter').map(c => c.ent.name).slice(0, 6).join(', ')}${chosen.length > 6 ? '…' : ''}`, snap);
    if (lastNew && !touchesCurrent) state.activeId = lastNew.id;
    commit();
    render();
    if (classNotes.length) toast(classNotes.join(' · '), 'ok');
    if (done) toast(`Imported ${done} entr${done === 1 ? 'y' : 'ies'}. You can undo this from Progression → Timeline.`, 'ok');
    if (failures.length) toast(`Couldn't import: ${failures.join('; ')}`, 'error');
  }

  // ---------------------------------------------------------------- export / files

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const exportPayload = s => JSON.stringify({ format: 'quillsheet', version: Schema.VERSION, exportedAt: new Date().toISOString(), sheet: s }, null, 2);

  function openExport() {
    const s = active();
    const name = slug(s.name);
    openModal({
      title: 'Save & export',
      body: h('div', { class: 'export' },
        h('p', {}, 'Your sheet is saved automatically in this browser. Export a file to keep a backup, move it to another device, or share it with your DM.'),
        h('div', { class: 'export-grid' },
          h('button', {
            type: 'button', class: 'export-opt',
            onclick: () => { download(`${name}.quillsheet.json`, exportPayload(s)); toast('Downloaded.', 'ok'); closeModal(); },
          }, h('strong', {}, 'Download file (.json)'), h('span', {}, 'Readable by Quillsheet on any device.')),
          h('button', {
            type: 'button', class: 'export-opt',
            onclick: async () => {
              const pass = await passphraseDialog({ title: 'Encrypt export', intro: 'Choose a passphrase. You will need it to open the file — it cannot be recovered.', confirm: true, ok: 'Encrypt & download' });
              if (pass == null) return;
              try {
                const box = await Vault.encrypt(exportPayload(s), pass);
                download(`${name}.encrypted.json`, JSON.stringify(box));
                toast('Encrypted file downloaded.', 'ok');
              } catch (e) { toast(e.message, 'error'); }
            },
          }, h('strong', {}, 'Download encrypted file'), h('span', {}, 'AES-256, protected by a passphrase you choose.')),
          h('button', {
            type: 'button', class: 'export-opt',
            onclick: async () => {
              try { await navigator.clipboard.writeText(exportPayload(s)); toast('Copied JSON to the clipboard.', 'ok'); closeModal(); } catch (e) { toast("Couldn't access the clipboard. Use Download instead.", 'error'); }
            },
          }, h('strong', {}, 'Copy as JSON'), h('span', {}, 'Paste into a message or notes app.')),
          h('button', { type: 'button', class: 'export-opt', onclick: () => { closeModal(); printSheet(); } },
            h('strong', {}, 'Print / save as PDF'), h('span', {}, 'All sections on paper-friendly pages.')),
          h('button', { type: 'button', class: 'export-opt', onclick: () => { closeModal(); exportAll(); } },
            h('strong', {}, 'Back up every character'), h('span', {}, 'One file containing your whole roster.'))),
        h('p', { class: 'hint' }, 'Open files with "Open file…" in the character list, or drag them onto the page.')),
      actions: [{ label: 'Done' }],
    });
  }

  function exportAll() {
    const list = Object.values(state.sheets);
    if (!list.length) { toast('No characters to back up yet.'); return; }
    download(`quillsheet-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ format: 'quillsheet-backup', version: Schema.VERSION, exportedAt: new Date().toISOString(), sheets: list }, null, 2));
    toast(`Backed up ${list.length} character${list.length > 1 ? 's' : ''}.`, 'ok');
  }

  function extractSheets(data) {
    if (data && data.format === 'quillsheet-backup' && Array.isArray(data.sheets)) return data.sheets;
    if (data && data.format === 'quillsheet' && data.sheet) return [data.sheet];
    if (Schema.isSheetLike(data)) return [data];
    return null;
  }

  async function openFile(file) {
    if (!file) return;
    if (file.size > 5e6) { toast(`"${file.name}" is larger than 5 MB, which is too big for a character file.`, 'error'); return; }
    let text;
    try { text = await file.text(); } catch (e) { toast(`Couldn't read "${file.name}".`, 'error'); return; }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      // Not JSON (or broken JSON): let the importer explain what's wrong.
      openImport(text);
      return;
    }
    if (data && data.format === 'quillsheet-encrypted') {
      const pass = await passphraseDialog({ title: 'Unlock encrypted file', intro: `"${file.name}" is encrypted. Enter its passphrase.`, ok: 'Unlock' });
      if (pass == null) return;
      try { data = JSON.parse(await Vault.decrypt(data, pass)); } catch (e) { toast(e.message, 'error'); return; }
    }
    const sheets = extractSheets(data);
    if (!sheets) { openImport(JSON.stringify(data, null, 2)); return; }
    const warnings = [];
    let added = 0;
    let last = null;
    for (const raw of sheets) {
      try {
        const { sheet, warnings: w } = Schema.normalize(raw);
        if (state.sheets[sheet.id]) {
          const keep = await confirmDialog({
            title: 'Character already exists',
            message: `"${sheet.name || 'Unnamed'}" is already in your list. Replace it with the version from the file, or keep both?`,
            ok: 'Replace',
          });
          if (!keep) sheet.id = Schema.uid();
        }
        w.forEach(x => warnings.push(`${sheet.name || 'Unnamed'}: ${x}`));
        state.sheets[sheet.id] = sheet;
        last = sheet;
        added++;
      } catch (e) {
        warnings.push(e.message);
      }
    }
    if (last) { state.activeId = last.id; persist(); render(); }
    if (added) toast(`Opened ${added} character${added > 1 ? 's' : ''} from "${file.name}".`, 'ok');
    if (warnings.length) {
      openModal({
        title: added ? 'Opened with some fixes' : "Couldn't open file",
        body: h('div', {},
          h('p', {}, added ? 'Some values in the file were missing or invalid and were replaced with defaults:' : 'The file could not be used:'),
          h('ul', { class: 'warn-list' }, warnings.slice(0, 30).map(w => h('li', {}, w)))),
        actions: [{ label: 'OK', kind: 'primary' }],
      });
    }
  }

  $('#file-input').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });

  // Drag a file anywhere onto the page.
  let dragDepth = 0;
  const overlay = $('#drop-overlay');
  window.addEventListener('dragenter', e => { if (dialog.open || !e.dataTransfer.types.includes('Files')) return; dragDepth++; overlay.hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.hidden = true; } });
  window.addEventListener('dragover', e => { if (!dialog.open) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (dialog.open) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    openFile(e.dataTransfer.files[0]);
  });

  // ---------------------------------------------------------------- print

  function printSheet() {
    state.printing = true;
    renderTab();
    setTimeout(() => window.print(), 50);
  }
  window.addEventListener('afterprint', () => { if (state.printing) { state.printing = false; renderTab(); } });

  // ---------------------------------------------------------------- boot

  function boot() {
    const theme = Store.getPref('theme', null);
    if (theme) document.documentElement.dataset.theme = theme;
    applyDisplayPrefs();
    registerOffline();
    const loaded = Store.load();
    state.sheets = loaded.sheets;
    state.activeId = loaded.activeId || (Object.keys(loaded.sheets)[0] || null);
    render();
    setStatus(Object.keys(state.sheets).length ? 'Saved on this device' : 'Stored on this device only', 'ok');
    if (loaded.error) { setStatus('Not saving', 'error'); toast(loaded.error, 'error'); }
    if (loaded.warnings && loaded.warnings.length) toast(`Some saved characters couldn't be loaded: ${loaded.warnings.join('; ')}`, 'error');
    window.addEventListener('pagehide', () => { if (state.saveTimer) persist(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && state.saveTimer) persist(); });
    window.addEventListener('storage', e => {
      if (e.key === 'quillsheet.sheets.v1') toast('Characters were changed in another tab. Reload this page to see the latest version.', 'error');
    });
  }

  boot();
})();
