'use strict';
/*
 * Homebrew — a per-device library of imported classes, subclasses, races/species and backgrounds
 * that Quick Build offers alongside the SRD options.
 *
 *   Homebrew.load() / Homebrew.save(lib)        localStorage key "quillsheet.homebrew.v1"
 *   Homebrew.fromEntity(entity, extra)          importer entity -> { kind, entry } (SRD-shaped entry)
 *   Homebrew.add(lib, kind, entry)              add or replace (same kind + name + class)
 *   Homebrew.merge(srdData, lib)                SRD bundle + library -> data Quick Build can use
 *
 * Library entries use the same shapes as js/srd/*.js, plus { hb: true, src }.
 */
const Homebrew = (() => {
  const KEY = 'quillsheet.homebrew.v1';
  const KINDS = ['classes', 'subclasses', 'races', 'backgrounds'];
  const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const slug = s => String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  const newId = name => `hb-${slug(name)}-${Math.random().toString(36).slice(2, 7)}`;
  const str = (v, max = 20000) => (typeof v === 'string' ? v : '').slice(0, max);

  function empty() { return { version: 1, classes: [], subclasses: [], races: [], backgrounds: [] }; }

  // Light validation: storage can be edited by hand, so keep only well-formed entries.
  function clean(lib) {
    const out = empty();
    if (!lib || typeof lib !== 'object') return out;
    const feats = list => (Array.isArray(list) ? list : []).filter(f => f && typeof f.n === 'string')
      .map(f => ({ n: str(f.n, 200), d: str(f.d), lv: Math.max(1, Math.min(20, Number(f.lv) || 1)) }));
    for (const s of Array.isArray(lib.subclasses) ? lib.subclasses : []) {
      if (s && typeof s.n === 'string') out.subclasses.push({ id: str(s.id, 80) || newId(s.n), n: str(s.n, 200), className: str(s.className, 100), d: str(s.d), f: feats(s.f), hb: true, src: str(s.src, 200) });
    }
    for (const r of Array.isArray(lib.races) ? lib.races : []) {
      if (r && typeof r.n === 'string') {
        out.races.push({
          id: str(r.id, 80) || newId(r.n), n: str(r.n, 200), speed: Number(r.speed) || 30, size: str(r.size, 30) || 'Medium',
          asi: (Array.isArray(r.asi) ? r.asi : []).filter(a => Array.isArray(a) && ABIL.includes(a[0]) && Number.isFinite(Number(a[1]))).map(a => [a[0], Number(a[1])]),
          asiOptions: null, languages: ['Common'], traits: feats(r.traits), skills: [], subs: [], hb: true, src: str(r.src, 200),
        });
      }
    }
    for (const b of Array.isArray(lib.backgrounds) ? lib.backgrounds : []) {
      if (b && typeof b.n === 'string') {
        out.backgrounds.push({
          id: str(b.id, 80) || newId(b.n), n: str(b.n, 200), skills: (Array.isArray(b.skills) ? b.skills : []).filter(k => typeof k === 'string'),
          tools: [], equip: [], equipOptions: [], gold: 0,
          feature: b.feature && typeof b.feature.d === 'string' ? { n: str(b.feature.n, 200) || 'Background feature', d: str(b.feature.d) } : null,
          hb: true, src: str(b.src, 200),
        });
      }
    }
    for (const c of Array.isArray(lib.classes) ? lib.classes : []) {
      if (!c || typeof c.n !== 'string') continue;
      const levels = {};
      for (const [l, v] of Object.entries(c.levels || {})) {
        const lv = Number(l);
        if (lv >= 1 && lv <= 20 && v && Array.isArray(v.f)) levels[lv] = { f: feats(v.f).map(({ n, d }) => ({ n, d })) };
      }
      out.classes.push({
        id: str(c.id, 80) || newId(c.n), n: str(c.n, 200), hd: [6, 8, 10, 12].includes(Number(c.hd)) ? Number(c.hd) : 8,
        saves: (Array.isArray(c.saves) ? c.saves : []).filter(a => ABIL.includes(a)),
        primary: (Array.isArray(c.primary) ? c.primary : []).filter(a => ABIL.includes(a)),
        caster: Rules.CASTER_TYPES[c.caster] ? c.caster : 'none', spellAbility: ABIL.includes(c.spellAbility) ? c.spellAbility : '',
        skills: c.skills && Array.isArray(c.skills.from) ? { choose: Number(c.skills.choose) || 2, from: c.skills.from.filter(k => typeof k === 'string') } : null,
        armor: (c.armor || []).filter(x => typeof x === 'string'), weapons: (c.weapons || []).filter(x => typeof x === 'string'), tools: [],
        equip: [], equipOptions: [], asi: [4, 8, 12, 16, 19], subLevel: Number(c.subLevel) || 3, levels, subclasses: [], hb: true, src: str(c.src, 200),
      });
    }
    return out;
  }

  function load() {
    try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (_) { return empty(); }
  }

  function save(lib) {
    try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch (e) {
      throw new Error(e && e.name === 'QuotaExceededError' ? 'Browser storage is full, so the homebrew couldn\'t be saved.' : `Couldn't save homebrew: ${e.message}`);
    }
  }

  const count = lib => KINDS.reduce((n, k) => n + lib[k].length, 0);

  function add(lib, kind, entry) {
    const list = lib[kind];
    const i = list.findIndex(x => eq(x.n, entry.n) && eq(x.className, entry.className));
    if (i >= 0) { entry.id = list[i].id; list[i] = entry; return 'replaced'; }
    list.push(entry);
    return 'added';
  }

  const CASTER_MAP = { full: 'full', '1/2': 'half', '1/3': 'third', pact: 'pact', artificer: 'artificer' };

  /**
   * Convert an importer entity into a library entry. `extra` supplies what plain text can't:
   * { as: 'subclass'|'race'|'background', className } for pasted text.
   */
  function fromEntity(ent, extra = {}) {
    const p = ent.payload || {};
    const src = ent.source || 'Homebrew';
    const kind = ent.type === 'text' ? extra.as : ent.type;
    // Pasted text with several headed features arrives as a text entity with payload.features.
    const parts = ent.type === 'text' && p.features && p.features.length ? p.features : null;
    if (kind === 'subclass') {
      const feats = ent.type === 'subclass'
        ? p.features.map(f => ({ lv: f.level || 3, n: f.name, d: f.description }))
        : parts ? parts.map(f => ({ lv: f.level || Number(extra.level) || 3, n: f.name, d: f.description }))
          : [{ lv: Number(extra.level) || 3, n: ent.name, d: ent.text }];
      return { kind: 'subclasses', entry: { id: newId(ent.name), n: ent.type === 'subclass' ? p.name : ent.name, className: extra.className || p.className || '', d: '', f: feats, hb: true, src } };
    }
    if (kind === 'race') {
      const traits = ent.type === 'race' || parts ? p.features.map(f => ({ n: f.name, d: f.description, lv: 1 })) : [{ n: ent.name, d: ent.text, lv: 1 }];
      return { kind: 'races', entry: { id: newId(ent.name), n: ent.type === 'race' ? p.name : ent.name, speed: p.speed || 30, size: 'Medium', asi: p.asi || [], asiOptions: null, languages: ['Common'], traits, skills: [], subs: [], hb: true, src } };
    }
    if (kind === 'background') {
      return { kind: 'backgrounds', entry: { id: newId(ent.name), n: ent.type === 'background' ? p.name : ent.name, skills: p.skills || [], tools: [], equip: [], equipOptions: [], gold: 0, feature: ent.text ? { n: 'Background feature', d: ent.text } : null, hb: true, src } };
    }
    if (kind === 'class') {
      const levels = {};
      for (const f of p.features) (levels[f.level] = levels[f.level] || { f: [] }).f.push({ n: f.name, d: f.description });
      const caster = CASTER_MAP[p.casterProgression] || 'none';
      return {
        kind: 'classes',
        entry: {
          id: newId(p.name), n: p.name, hd: p.hitDie || 8, saves: p.saves || [], primary: p.primary && p.primary.length ? p.primary : (p.spellAbility ? [p.spellAbility] : ['str']),
          caster, spellAbility: p.spellAbility || '', skills: p.skillChoice || null, armor: p.armor || [], weapons: p.weapons || [], tools: [],
          equip: [], equipOptions: [], asi: [4, 8, 12, 16, 19], subLevel: 3, levels, subclasses: [], hb: true, src,
        },
      };
    }
    return null;
  }

  /** SRD bundle + library, as one data object for Quick Build. Spell slots for homebrew casters follow the ruleset. */
  function merge(data, lib) {
    const subsFor = name => lib.subclasses.filter(s => eq(s.className, name));
    const classes = data.classes.map(c => ({ ...c, subclasses: [...c.subclasses, ...subsFor(c.n)] }));
    for (const hc of lib.classes) {
      const levels = {};
      for (let l = 1; l <= 20; l++) {
        const base = hc.levels[l] ? { f: hc.levels[l].f } : { f: [] };
        if (hc.caster !== 'none') base.slots = Rules.spellSlots([{ caster: hc.caster, level: l }], data.meta.ruleset).slots;
        levels[l] = base;
      }
      classes.push({ ...hc, levels, subclasses: subsFor(hc.n) });
    }
    return { ...data, classes, races: [...data.races, ...lib.races], backgrounds: [...data.backgrounds, ...lib.backgrounds] };
  }

  /** Subclasses whose class isn't in this ruleset or the library (shown in the manager). */
  function orphans(data, lib) {
    const names = [...data.classes.map(c => c.n), ...lib.classes.map(c => c.n)];
    return lib.subclasses.filter(s => !names.some(n => eq(n, s.className)));
  }

  return { KINDS, load, save, add, count, fromEntity, merge, orphans, empty };
})();
