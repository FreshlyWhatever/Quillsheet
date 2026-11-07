'use strict';
/*
 * Importer — turns text or JSON copied from 5etools (or similar sites) into "entities"
 * the user can review before anything touches their sheet.
 *
 * parse(input) -> { entities: Entity[], errors: ImportError[], warnings: string[] }
 *   Entity      = { id, type, typeLabel, name, summary, text, source, origin, actions, defaultAction, payload }
 *   ImportError = { title, detail, hint? }
 *
 * Pure: no DOM, no sheet access. The app decides what each action does.
 */
const Importer = (() => {
  const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const SCHOOLS = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation' };
  const DAMAGE = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' };
  const ITEM_TYPES = {
    M: 'Melee weapon', R: 'Ranged weapon', A: 'Ammunition', LA: 'Light armor', MA: 'Medium armor', HA: 'Heavy armor',
    S: 'Shield', G: 'Adventuring gear', P: 'Potion', RD: 'Rod', RG: 'Ring', WD: 'Wand', SC: 'Scroll', ST: 'Staff',
    W: 'Wondrous item', AT: "Artisan's tools", T: 'Tools', INS: 'Instrument', GS: 'Gaming set', SCF: 'Spellcasting focus',
    TAH: 'Tack and harness', MNT: 'Mount', VEH: 'Vehicle', TG: 'Trade good', FD: 'Food and drink', $: 'Treasure',
    EXP: 'Explosive', OTH: 'Other', AF: 'Ammunition (futuristic)', EM: 'Eldritch machine', GV: 'Generic variant',
  };
  const PROPERTIES = { A: 'ammunition', F: 'finesse', H: 'heavy', L: 'light', LD: 'loading', R: 'reach', S: 'special', T: 'thrown', '2H': 'two-handed', V: 'versatile', RLD: 'reload', BF: 'burst fire' };
  // Top-level keys used by 5etools data files and homebrew collections.
  const COLLECTIONS = {
    spell: 'spell', item: 'item', baseitem: 'item', magicvariant: 'item', itemGroup: 'item',
    feat: 'feat', optionalfeature: 'feature', classFeature: 'feature', subclassFeature: 'feature',
    reward: 'feature', charoption: 'feature', boon: 'feature', condition: 'feature',
    monster: 'monster', race: 'race', subrace: 'race', background: 'background',
    class: 'class', subclass: 'subclass',
  };
  const TYPE_LABELS = {
    spell: 'Spell', item: 'Item', feat: 'Feat', feature: 'Feature', monster: 'Statblock',
    race: 'Race / species', background: 'Background', sheet: 'Character sheet', text: 'Text',
    class: 'Class', subclass: 'Subclass',
  };
  const ACTIONS = {
    spell: [['spell', 'Add to spells'], ['feature', 'Add as feature'], ['note', 'Append to notes']],
    item: [['item', 'Add to inventory'], ['feature', 'Add as feature'], ['note', 'Append to notes']],
    weapon: [['item+attack', 'Inventory + attack'], ['item', 'Inventory only'], ['attack', 'Attack only'], ['note', 'Append to notes']],
    feat: [['feature', 'Add as feature'], ['note', 'Append to notes']],
    feature: [['feature', 'Add as feature'], ['note', 'Append to notes']],
    race: [['race', 'Set as race + add traits'], ['feature', 'Add as one feature'], ['note', 'Append to notes']],
    background: [['background', 'Set as background'], ['feature', 'Add as feature'], ['note', 'Append to notes']],
    monster: [['newCharacter', 'New character from statblock'], ['applyStats', 'Apply stats to current character'], ['note', 'Append to notes']],
    sheet: [['newCharacter', 'Add as new character']],
    text: [['feature', 'Add as feature'], ['item', 'Add to inventory'], ['spell', 'Add to spells'], ['note', 'Append to notes']],
    subclass: [['subclass', 'Set as subclass + add features'], ['feature', 'Add as one feature'], ['note', 'Append to notes']],
    class: [['classFeatures', 'Add class features up to my level'], ['note', 'Append to notes']],
  };
  const ORIGINS = { spell: 'Other', item: 'Other', feat: 'Feat', feature: 'Class', monster: 'Statblock', race: 'Race', background: 'Background', text: 'Other', class: 'Class', subclass: 'Class' };
  const SKILL_BY_NAME = Object.fromEntries(Rules.SKILLS.map(s => [s.name.toLowerCase(), s.key]));

  let counter = 0;
  function entity(type, name, payload, extra = {}) {
    const actions = extra.actions || ACTIONS[type];
    return {
      id: `e${++counter}`, type, typeLabel: TYPE_LABELS[type], name: String(name || 'Unnamed').trim() || 'Unnamed',
      summary: '', text: '', source: '', origin: ORIGINS[type] || 'Other',
      payload, ...extra, actions, defaultAction: actions[0][0],
    };
  }

  // ---------- 5etools markup ----------

  /** Replace {@tag text|source|display} markup with readable text (handles nesting). */
  function stripTags(input) {
    if (input == null) return '';
    let s = String(input);
    let prev;
    do {
      prev = s;
      s = s.replace(/\{@(\w+)\s*([^{}]*?)\}/g, (m, tag, body) => {
        const parts = body.split('|');
        const first = parts[0].trim();
        switch (tag) {
          case 'dc': return `DC ${first}`;
          case 'hit': return /^[+-]/.test(first) ? first : `+${first}`;
          case 'h': return 'Hit: ';
          case 'm': return 'Miss: ';
          case 'atk': case 'atkr': return attackLabel(first);
          case 'recharge': return `(Recharge ${first ? `${first}–6` : '6'})`;
          case 'chance': return `${first}%`;
          case 'filter': return first;
          default: return parts[2] ? parts[2].trim() : first;
        }
      });
    } while (s !== prev);
    return s;
  }

  function attackLabel(code) {
    const map = { mw: 'Melee Weapon', rw: 'Ranged Weapon', ms: 'Melee Spell', rs: 'Ranged Spell', m: 'Melee', r: 'Ranged' };
    const kinds = code.split(',').map(c => map[c.trim()]).filter(Boolean);
    return `${kinds.join(' or ') || 'Melee'} ${/^(m|r)$/.test(code) ? 'Attack Roll' : 'Attack'}:`;
  }

  /** Flatten 5etools "entries" (strings, nested sections, lists, tables) into plain text. */
  function renderEntries(entries) {
    const out = [];
    walk(entries, out, 0);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function walk(e, out, depth) {
    if (e == null) return;
    if (typeof e === 'string' || typeof e === 'number') { out.push(stripTags(e)); return; }
    if (Array.isArray(e)) { e.forEach(x => walk(x, out, depth)); return; }
    if (typeof e !== 'object') return;
    switch (e.type) {
      case 'list':
        (e.items || []).forEach(it => { const sub = []; walk(it, sub, depth + 1); out.push(`• ${sub.join(' ')}`); });
        return;
      case 'item': case 'itemSub': case 'itemSpell': {
        const sub = [];
        walk(e.entry != null ? e.entry : e.entries, sub, depth + 1);
        out.push(`${e.name ? `${stripTags(e.name)} ` : ''}${sub.join(' ')}`);
        return;
      }
      case 'table': {
        if (e.caption) out.push(stripTags(e.caption));
        if (e.colLabels) out.push(e.colLabels.map(stripTags).join(' | '));
        (e.rows || []).forEach(r => {
          const cells = (Array.isArray(r) ? r : (r.row || [])).map(c => {
            if (c && typeof c === 'object') {
              if (c.roll) return c.roll.exact != null ? String(c.roll.exact) : `${c.roll.min}–${c.roll.max}`;
              return renderEntries(c);
            }
            return stripTags(c);
          });
          out.push(cells.join(' | '));
        });
        return;
      }
      case 'refClassFeature': case 'refSubclassFeature': case 'refOptionalfeature':
        return; // pointers to other entries; their text arrives as separate objects
      case 'abilityDc':
        out.push(`${e.name || 'Spell'} save DC = 8 + your proficiency bonus + your ${(e.attributes || []).join('/')} modifier`);
        return;
      case 'abilityAttackMod':
        out.push(`${e.name || 'Spell'} attack modifier = your proficiency bonus + your ${(e.attributes || []).join('/')} modifier`);
        return;
      default: {
        if (e.name) out.push(depth > 0 ? `${stripTags(e.name)}.` : stripTags(e.name));
        walk(e.entries != null ? e.entries : e.entry != null ? e.entry : e.items, out, depth + 1);
      }
    }
  }

  const fmtSource = o => o.source ? `${String(o.source).split('|')[0]}${o.page ? ` p.${o.page}` : ''}` : '';
  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

  // ---------- Mappers (5etools JSON -> entity) ----------

  function fmtTime(time) {
    if (!Array.isArray(time)) return '';
    const units = { bonus: 'bonus action' };
    return time.map(t => `${plural(t.number || 1, units[t.unit] || t.unit)}${t.condition ? `, ${stripTags(t.condition)}` : ''}`).join(' or ');
  }

  function fmtRange(r) {
    if (!r) return '';
    if (r.type === 'special') return 'Special';
    const d = r.distance || {};
    if (['self', 'touch', 'sight', 'unlimited'].includes(d.type)) return d.type[0].toUpperCase() + d.type.slice(1);
    if (r.type === 'point') return `${d.amount != null ? d.amount + ' ' : ''}${d.type || ''}`.trim();
    const unit = d.type === 'feet' ? 'foot' : d.type === 'miles' ? 'mile' : d.type;
    return `Self (${d.amount}-${unit} ${r.type})`;
  }

  function fmtComponents(c) {
    if (!c) return '';
    const parts = [];
    if (c.v) parts.push('V');
    if (c.s) parts.push('S');
    if (c.m) parts.push(typeof c.m === 'string' ? `M (${stripTags(c.m)})` : c.m.text ? `M (${stripTags(c.m.text)})` : 'M');
    if (c.r) parts.push('R');
    return parts.join(', ');
  }

  function fmtDuration(list) {
    if (!Array.isArray(list)) return '';
    return list.map(d => {
      if (d.type === 'instant') return 'Instantaneous';
      if (d.type === 'permanent') return (d.ends || []).length ? `Until ${d.ends.join(' or ')}` : 'Permanent';
      if (d.type === 'special') return 'Special';
      if (d.type === 'timed' && d.duration) {
        return `${d.concentration ? 'Concentration, up to ' : ''}${plural(d.duration.amount || 1, d.duration.type)}`;
      }
      return d.type || '';
    }).join(' or ');
  }

  function mapSpell(s) {
    const spell = {
      name: s.name || 'Unnamed spell',
      level: Math.max(0, Math.min(9, Number(s.level) || 0)),
      school: SCHOOLS[s.school] || s.school || '',
      castingTime: fmtTime(s.time),
      range: fmtRange(s.range),
      components: fmtComponents(s.components),
      duration: fmtDuration(s.duration),
      concentration: Array.isArray(s.duration) && s.duration.some(d => d.concentration),
      ritual: !!(s.meta && s.meta.ritual),
      prepared: false,
      description: [renderEntries(s.entries), renderEntries(s.entriesHigherLevel)].filter(Boolean).join('\n\n'),
      source: fmtSource(s),
    };
    return entity('spell', spell.name, spell, {
      summary: `${spell.level ? `${Rules.ORDINAL[spell.level]}-level` : 'Cantrip'} ${spell.school.toLowerCase()} · ${spell.castingTime || '—'} · ${spell.range || '—'}`,
      text: spell.description, source: spell.source,
    });
  }

  function mapItem(it) {
    const type = String(it.type || '').split('|')[0];
    const dmgType = DAMAGE[it.dmgType] || it.dmgType || '';
    const props = (it.property || []).map(p => {
      const code = typeof p === 'object' && p ? (p.uid || p.name || '') : String(p);
      return PROPERTIES[code.split('|')[0]] || code.split('|')[0];
    }).filter(Boolean);
    const rarity = it.rarity && !['none', 'unknown'].includes(it.rarity) ? it.rarity : '';
    const header = [ITEM_TYPES[type] || '', rarity, it.reqAttune ? `requires attunement${typeof it.reqAttune === 'string' ? ` ${it.reqAttune}` : ''}` : '']
      .filter(Boolean).join(', ');
    const notes = [
      header,
      it.dmg1 ? `Damage: ${it.dmg1} ${dmgType}${it.dmg2 ? ` (versatile ${it.dmg2})` : ''}` : '',
      props.length ? `Properties: ${props.join(', ')}` : '',
      it.range ? `Range: ${it.range}` : '',
      it.ac != null ? `AC: ${it.ac}` : '',
      renderEntries(it.entries),
    ].filter(Boolean).join('\n');
    const acBonus = parseInt(it.bonusAc, 10) || 0;
    const armor = { LA: 'light', MA: 'medium', HA: 'heavy', S: 'shield' }[type] || (acBonus ? 'bonus' : '');
    const acValue = armor === 'bonus' ? acBonus : armor ? (Number(it.ac) || 0) + acBonus : 0;
    const item = { name: it.name || 'Unnamed item', qty: Number(it.quantity) || 1, weight: Number(it.weight) || 0, equipped: false, notes, source: fmtSource(it), armor, acValue };
    const isWeapon = !!it.dmg1 && (type === 'M' || type === 'R' || it.weapon || it.weaponCategory);
    const attack = isWeapon ? {
      name: item.name, dice: it.dmg1, dmgType,
      ability: type === 'R' ? 'dex' : props.includes('finesse') ? 'finesse' : 'str',
      notes: [it.range ? `Range ${it.range}` : '', props.join(', ')].filter(Boolean).join('; '),
    } : null;
    return entity('item', item.name, { item, attack }, {
      actions: isWeapon ? ACTIONS.weapon : ACTIONS.item,
      summary: [header, it.weight ? `${it.weight} lb` : ''].filter(Boolean).join(' · ') || 'Item',
      text: notes, source: item.source,
    });
  }

  function mapFeature(o, type) {
    const prereq = Array.isArray(o.prerequisite) ? renderPrereq(o.prerequisite) : '';
    const text = [prereq ? `Prerequisite: ${prereq}` : '', renderEntries(o.entries != null ? o.entries : o.entry)].filter(Boolean).join('\n');
    const origin = o.className ? 'Class' : ORIGINS[type];
    const where = o.className ? `${o.className}${o.level ? ` ${o.level}` : ''}` : '';
    return entity(type, o.name, null, {
      text, origin, source: [where, fmtSource(o)].filter(Boolean).join(' · '),
      summary: text.slice(0, 160),
      meta: { className: o.className || '', subclassShortName: o.subclassShortName || '', level: Number(o.level) || 0 },
    });
  }

  function mapSubclass(o) {
    return entity('subclass', o.name, {
      name: o.name || 'Subclass', shortName: o.shortName || o.name || '', className: o.className || '', features: [],
    }, { source: fmtSource(o) });
  }

  function mapClass(o) {
    const sp = o.startingProficiencies || {};
    const profText = list => (Array.isArray(list) ? list : []).map(x => stripTags(typeof x === 'string' ? x : (x && (x.proficiency || x.full)) || '')).filter(Boolean);
    let skillChoice = null;
    const sk = Array.isArray(sp.skills) ? sp.skills.find(x => x && x.choose) : null;
    if (sk && sk.choose) {
      const from = (sk.choose.from || []).map(n => SKILL_BY_NAME[String(n).toLowerCase()]).filter(Boolean);
      skillChoice = { choose: sk.choose.count || 2, from: from.length ? from : Rules.SKILLS.map(s => s.key) };
    } else if (sk && sk.any) {
      skillChoice = { choose: sk.any, from: Rules.SKILLS.map(s => s.key) };
    }
    const primary = (Array.isArray(o.primaryAbility) ? o.primaryAbility : []).flatMap(x => Object.keys(x || {})).filter(k => ABIL.includes(k));
    return entity('class', o.name, {
      name: o.name || 'Class', hitDie: (o.hd && Number(o.hd.faces)) || null, features: [],
      saves: (Array.isArray(o.proficiency) ? o.proficiency : []).filter(k => ABIL.includes(k)),
      primary, spellAbility: ABIL.includes(o.spellcastingAbility) ? o.spellcastingAbility : '',
      casterProgression: o.casterProgression || '', skillChoice,
      armor: profText(sp.armor), weapons: profText(sp.weapons),
    }, { source: fmtSource(o) });
  }

  /**
   * Attach class/subclass features found in the same paste to their class or subclass entry,
   * so a whole class file shows up as a few pickable entries instead of dozens of loose features.
   */
  function groupClassContent(out) {
    const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const classes = out.entities.filter(e => e.type === 'class');
    const subs = out.entities.filter(e => e.type === 'subclass');
    out.classCount = classes.length;
    out.subclassCount = subs.length;
    if (!classes.length && !subs.length) return;
    const used = new Set();
    const loose = out.entities.filter(e => e.type === 'feature' && e.meta && e.meta.className);
    const asFeature = e => ({ name: e.name, level: e.meta.level || 1, description: e.text, source: e.source });
    const describe = (ent, feats) => {
      feats.sort((a, b) => a.level - b.level);
      ent.text = feats.map(f => `Level ${f.level}: ${f.name}. ${f.description}`).join('\n\n');
      const levels = [...new Set(feats.map(f => f.level))].join(', ');
      return feats.length ? `${feats.length} feature${feats.length === 1 ? '' : 's'} (level ${levels})` : '';
    };
    for (const sc of subs) {
      for (const e of loose) {
        if (!e.meta.subclassShortName || !eq(e.meta.className, sc.payload.className)) continue;
        if (eq(e.meta.subclassShortName, sc.payload.shortName) || eq(e.meta.subclassShortName, sc.payload.name)) {
          sc.payload.features.push(asFeature(e));
          used.add(e);
        }
      }
      const feats = describe(sc, sc.payload.features);
      sc.summary = `${sc.payload.className || 'Class'} subclass · ${feats || 'no feature text in this paste, so paste its features too to add them'}`;
    }
    for (const cl of classes) {
      for (const e of loose) {
        if (!e.meta.subclassShortName && eq(e.meta.className, cl.name)) { cl.payload.features.push(asFeature(e)); used.add(e); }
      }
      const feats = describe(cl, cl.payload.features);
      cl.summary = [cl.payload.hitDie ? `d${cl.payload.hitDie} hit die` : '', feats || 'no class feature text in this paste'].filter(Boolean).join(' · ');
    }
    out.entities = out.entities.filter(e => !used.has(e));
  }

  function renderPrereq(list) {
    return list.map(p => Object.entries(p).map(([k, v]) => {
      if (k === 'level') return `Level ${typeof v === 'object' ? v.level : v}`;
      if (k === 'ability' && Array.isArray(v)) return v.map(a => Object.entries(a).map(([ab, n]) => `${ab.toUpperCase()} ${n}+`).join(', ')).join(' or ');
      if (k === 'spellcasting' || k === 'spellcasting2020') return 'Spellcasting feature';
      if (k === 'race' && Array.isArray(v)) return v.map(r => r.name).join(' or ');
      if (k === 'other') return stripTags(v);
      return '';
    }).filter(Boolean).join(', ')).filter(Boolean).join('; or ');
  }

  function speedOf(sp) {
    if (typeof sp === 'number') return sp;
    if (sp && typeof sp === 'object') {
      const w = sp.walk;
      if (typeof w === 'number') return w;
      if (w && typeof w === 'object' && typeof w.number === 'number') return w.number;
    }
    return null;
  }

  function mapRace(o) {
    const features = [];
    for (const e of o.entries || []) {
      if (e && typeof e === 'object' && e.name) features.push({ name: stripTags(e.name), description: renderEntries(e.entries) });
    }
    const abilityText = Array.isArray(o.ability) && o.ability[0]
      ? Object.entries(o.ability[0]).filter(([k]) => ABIL.includes(k)).map(([k, v]) => `${k.toUpperCase()} ${v >= 0 ? '+' : ''}${v}`).join(', ')
      : '';
    if (abilityText) features.unshift({ name: 'Ability Score Increase', description: `${abilityText} (Quick Build applies this; on an existing sheet, add it on the Overview tab)` });
    const speed = speedOf(o.speed);
    const name = o.raceName && o.name !== o.raceName ? `${o.name} ${o.raceName}`.trim() : o.name;
    const asi = Array.isArray(o.ability) && o.ability[0]
      ? Object.entries(o.ability[0]).filter(([k, v]) => ABIL.includes(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])
      : [];
    return entity('race', name, { name, speed, features, asi }, {
      summary: [speed ? `Speed ${speed} ft` : '', `${features.length} trait${features.length === 1 ? '' : 's'}`, abilityText].filter(Boolean).join(' · '),
      text: features.map(f => `${f.name}. ${f.description}`).join('\n\n'), source: fmtSource(o),
    });
  }

  function mapBackground(o) {
    const skills = Object.keys((o.skillProficiencies && o.skillProficiencies[0]) || {})
      .map(k => SKILL_BY_NAME[k.toLowerCase()]).filter(Boolean);
    const text = renderEntries(o.entries);
    return entity('background', o.name, { name: o.name, skills }, {
      text, source: fmtSource(o),
      summary: skills.length ? `Skills: ${skills.map(k => Rules.SKILLS.find(s => s.key === k).name).join(', ')}` : text.slice(0, 160),
    });
  }

  function mapMonster(m) {
    const abilities = Object.fromEntries(ABIL.map(k => [k, Number(m[k]) || 10]));
    let ac = null;
    if (Array.isArray(m.ac)) ac = typeof m.ac[0] === 'number' ? m.ac[0] : (m.ac[0] && m.ac[0].ac) || null;
    else if (m.ac != null) ac = Number(m.ac) || null;
    const hp = m.hp && typeof m.hp === 'object' ? (m.hp.average != null ? m.hp.average : null) : (Number(m.hp) || null);
    const skills = Object.keys(m.skill || {}).map(k => SKILL_BY_NAME[k.toLowerCase()]).filter(Boolean);
    const saves = Object.keys(m.save || {}).filter(k => ABIL.includes(k));
    const traits = [m.trait, m.action, m.bonus, m.reaction, m.legendary].filter(Array.isArray).flat()
      .filter(t => t && t.name).map(t => ({ name: stripTags(t.name), description: renderEntries(t.entries) }));
    return monsterEntity({ name: m.name || 'Creature', abilities, ac, hp, speed: speedOf(m.speed), skills, saves, traits }, fmtSource(m));
  }

  function monsterEntity(p, source) {
    return entity('monster', p.name, p, {
      source,
      summary: `AC ${p.ac != null ? p.ac : '?'} · HP ${p.hp != null ? p.hp : '?'} · ${ABIL.map(k => `${k.toUpperCase()} ${p.abilities[k]}`).join(' ')}`,
      text: [`AC ${p.ac != null ? p.ac : '?'}, HP ${p.hp != null ? p.hp : '?'}, Speed ${p.speed != null ? p.speed : '?'} ft`,
        ABIL.map(k => `${k.toUpperCase()} ${p.abilities[k]}`).join(', '),
        ...p.traits.map(t => `${t.name}. ${t.description}`)].join('\n'),
    });
  }

  function mapSheet(o, out) {
    const { sheet, warnings } = Schema.normalize(o);
    warnings.forEach(w => out.warnings.push(`${sheet.name || 'Character'}: ${w}`));
    return entity('sheet', sheet.name || 'Unnamed character', sheet, {
      summary: `${Rules.classSummary(sheet) || 'No class'} · ${sheet.race || 'no race'}`,
    });
  }

  const MAPPERS = {
    spell: mapSpell, item: mapItem, feat: o => mapFeature(o, 'feat'), feature: o => mapFeature(o, 'feature'),
    race: mapRace, background: mapBackground, monster: mapMonster, sheet: mapSheet,
    class: mapClass, subclass: mapSubclass,
  };

  function detectType(o) {
    if (Schema.isSheetLike(o)) return 'sheet';
    if ('level' in o && 'school' in o) return 'spell';
    if (ABIL.every(k => k in o)) return 'monster';
    if ('className' in o && 'shortName' in o && !('level' in o)) return 'subclass';
    if ('hd' in o && ('classFeatures' in o || 'proficiency' in o)) return 'class';
    const itemType = typeof o.type === 'string' && ITEM_TYPES[o.type.split('|')[0]];
    if ('rarity' in o || 'dmg1' in o || 'weaponCategory' in o || 'reqAttune' in o || itemType || ('weight' in o && 'value' in o)) return 'item';
    if ('startingEquipment' in o || ('skillProficiencies' in o && 'toolProficiencies' in o && !('size' in o))) return 'background';
    if ('size' in o && 'speed' in o) return 'race';
    if ('prerequisite' in o) return 'feat';
    if ('className' in o || 'featureType' in o) return 'feature';
    if ('name' in o && ('entries' in o || 'entry' in o)) return 'feature';
    return null;
  }

  // ---------- JSON ----------

  function balanced(t) {
    let depth = 0; let inStr = false; let esc = false;
    for (const ch of t) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
    return depth === 0 && !inStr;
  }

  function jsonError(text, e) {
    let where = '';
    const pos = /position (\d+)/i.exec(e.message);
    const lc = /line (\d+) column (\d+)/i.exec(e.message);
    if (lc) where = ` (line ${lc[1]}, column ${lc[2]})`;
    else if (pos) {
      const before = text.slice(0, Number(pos[1]));
      where = ` (line ${before.split('\n').length}, column ${Number(pos[1]) - before.lastIndexOf('\n')})`;
    }
    let hint = 'Make sure you copied the whole entry, from the first { to the last }.';
    if (!balanced(text)) hint = "The brackets don't balance, so the paste looks cut off. Copy the entry again, including its final } or ].";
    else if (/,\s*[}\]]/.test(text)) hint = "There's a comma right before a closing } or ]. JSON doesn't allow trailing commas, so delete it.";
    else if (/'[^'\n]*'\s*:/.test(text)) hint = 'JSON needs double quotes (") around names and text, not single quotes.';
    return { title: `This looks like JSON, but it couldn't be read${where}.`, detail: e.message, hint };
  }

  function addObject(o, out, forcedType, label) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) { out.warnings.push(`Skipped ${label || 'an entry'}: it isn't an object.`); return; }
    const type = forcedType || detectType(o);
    if (!type) { out.warnings.push(`Skipped "${o.name || label || 'unnamed entry'}": couldn't tell whether it's a spell, item, feat, creature, race or background.`); return; }
    if (o._copy) out.warnings.push(`"${o.name || 'Entry'}" is a "_copy" of another entry, so only the fields included in your paste were imported.`);
    if (!o.name && type !== 'sheet') out.warnings.push('An entry had no "name", so it was called "Unnamed".');
    try { out.entities.push(MAPPERS[type](o, out)); } catch (err) {
      out.errors.push({ title: `Couldn't read "${o.name || label || 'entry'}"`, detail: err.message });
    }
  }

  function fromJson(data, out) {
    if (Array.isArray(data)) { data.forEach((d, i) => addObject(d, out, null, `entry ${i + 1}`)); return; }
    if (!data || typeof data !== 'object') {
      out.errors.push({ title: 'Unsupported JSON', detail: `Expected an object or a list of objects, but got ${data === null ? 'null' : typeof data}.` });
      return;
    }
    if (data.format === 'quillsheet-encrypted') {
      out.errors.push({ title: 'This is an encrypted character file', detail: 'Use "Open file…" in the character list to unlock it with its passphrase.' });
      return;
    }
    if (data.format === 'quillsheet-backup' && Array.isArray(data.sheets)) { data.sheets.forEach((s, i) => addObject(s, out, 'sheet', `character ${i + 1}`)); return; }
    if (data.format === 'quillsheet' && data.sheet) { addObject(data.sheet, out, 'sheet'); return; }
    const type = detectType(data);
    if (type) { addObject(data, out, type); return; }
    for (const [key, t] of Object.entries(COLLECTIONS)) {
      if (Array.isArray(data[key])) data[key].forEach((o, i) => addObject(o, out, t, `${key} ${i + 1}`));
    }
  }

  // ---------- Plain text (selected & copied from a page) ----------

  const META_LINE = /^(classes|subclasses|races|species|backgrounds|source|optional\/variant classes|damage types?|damage inflicted|conditions? inflicted|saving throws?|spell attacks?|area types?|miscellaneous tags|feats)\s*:/i;

  function spellFromText(lines) {
    let last = 0;
    const field = label => {
      const i = lines.findIndex(l => l.toLowerCase().startsWith(label));
      if (i < 0) return '';
      let v = lines[i].slice(label.length).replace(/^\s*:?\s*/, '').trim();
      last = Math.max(last, i);
      if (!v && lines[i + 1]) { v = lines[i + 1]; last = Math.max(last, i + 1); }
      return v;
    };
    const castingTime = field('casting time');
    const range = field('range');
    const components = field('components');
    const duration = field('duration');
    const head = lines.slice(0, Math.min(4, lines.length)).join(' ');
    let level = 0; let school = '';
    let m;
    if ((m = /\b(\d)(?:st|nd|rd|th)[- ]level\s+([a-z]+)/i.exec(head))) { level = +m[1]; school = m[2]; }
    else if ((m = /\blevel\s+(\d)\s+([a-z]+)/i.exec(head))) { level = +m[1]; school = m[2]; }
    else if ((m = /\b([a-z]+)\s+cantrip\b/i.exec(head))) { school = m[1]; }
    else if ((m = /\bcantrip\s*\(?\s*([a-z]+)/i.exec(head))) { school = m[1]; }
    school = school ? school[0].toUpperCase() + school.slice(1).toLowerCase() : '';
    const description = lines.slice(last + 1).filter(l => !META_LINE.test(l)).join('\n');
    const spell = {
      name: lines[0], level, school, castingTime, range, components, duration,
      concentration: /concentration/i.test(duration), ritual: /ritual/i.test(head), prepared: false, description, source: '',
    };
    return entity('spell', spell.name, spell, {
      summary: `${level ? `${Rules.ORDINAL[level]}-level` : 'Cantrip'} ${school.toLowerCase()} · ${castingTime || '—'} · ${range || '—'}`,
      text: description,
    });
  }

  function statblockFromText(raw, lines) {
    const abilities = {};
    const header = /STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA/i.exec(raw);
    if (header) {
      const nums = [...raw.slice(header.index + header[0].length).matchAll(/(\d{1,2})\s*\(\s*[+\-−–]?\s*\d+\s*\)/g)].slice(0, 6).map(m => +m[1]);
      if (nums.length === 6) ABIL.forEach((k, i) => { abilities[k] = nums[i]; });
    }
    if (Object.keys(abilities).length < 6) {
      for (const m of raw.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\b\s*:?\s+(\d{1,2})\b/gi)) {
        const k = m[1].toLowerCase();
        if (!(k in abilities)) abilities[k] = +m[2];
      }
    }
    if (ABIL.some(k => !(k in abilities))) return null;
    const num = re => { const m = re.exec(raw); return m ? +m[1] : null; };
    const skillsLine = /\bSkills\s*:?\s*([^\n]+)/i.exec(raw);
    const savesLine = /\bSaving Throws\s*:?\s*([^\n]+)/i.exec(raw);
    return monsterEntity({
      name: lines[0],
      abilities,
      ac: num(/(?:Armor Class|\bAC)\s*:?\s*(\d+)/i),
      hp: num(/(?:Hit Points|\bHP)\s*:?\s*(\d+)/i),
      speed: num(/\bSpeed\s*:?\s*(\d+)/i),
      skills: skillsLine ? skillsLine[1].split(',').map(x => SKILL_BY_NAME[x.replace(/[+\-−–]?\s*\d+/g, '').trim().toLowerCase()]).filter(Boolean) : [],
      saves: savesLine ? [...savesLine[1].matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\b/gi)].map(m => m[1].toLowerCase()) : [],
      traits: [],
    }, '');
  }

  // Page sources like "PHB'24 p101" or "TCE p49", and the [−] collapse toggles copied next to headings.
  const SOURCE_LINE = /^[A-Z][A-Za-z]{1,9}(?:'\d{2})?\s+p\.?\s*\d{1,4}$/;
  const TRAILING_SOURCE = /^(.+?)\s+([A-Z][A-Za-z]{1,9}(?:'\d{2})?\s+p\.?\s*\d{1,4})$/;
  const LEVEL_HEAD = /^level\s+(\d{1,2})\s*[:.\-–—]\s*(.+)$/i;
  const TOGGLE = /\s*\[[−–+\-]\]\s*$/;
  const headingLike = l => l.length <= 80 && !/[.,;:!?]$/.test(l);
  const titleCase = l => l.split(' ').every(w => /^[A-Z0-9('"]/.test(w) || /^(of|the|and|or|a|an|in|on|to|for|with)$/.test(w));

  /**
   * Split pasted text into headed sections. A heading is a "Level N: Name" line, or a short line
   * followed by (or ending with) a page source. Lines before the first heading are the intro.
   */
  function splitSections(lines) {
    const intro = [];
    const sections = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].replace(TOGGLE, '');
      if (!line || SOURCE_LINE.test(line)) continue;
      let source = '';
      const trail = TRAILING_SOURCE.exec(line);
      if (trail && (LEVEL_HEAD.test(trail[1]) || (headingLike(trail[1]) && titleCase(trail[1])))) { line = trail[1]; source = trail[2]; }
      const next = (lines[i + 1] || '').replace(TOGGLE, '');
      if (!source && headingLike(line) && SOURCE_LINE.test(next)) source = next;
      const lv = LEVEL_HEAD.exec(line);
      if ((lv && headingLike(lv[2])) || (source && headingLike(line))) {
        cur = { name: lv ? lv[2].trim() : line, level: lv ? Number(lv[1]) : null, source, body: [] };
        sections.push(cur);
      } else if (cur) cur.body.push(line);
      else intro.push(line);
    }
    return { intro, sections };
  }

  /** Several headed features pasted together (e.g. a whole class or subclass page). */
  function featureGroup(intro, sections) {
    // A level-less first heading before "Level N:" ones is the subclass/class title, not a feature.
    if (!intro.length && sections[0].level == null && sections.slice(1).some(sec => sec.level)) {
      intro = [sections[0].name, ...sections[0].body];
      sections = sections.slice(1);
    }
    let lastLevel = null;
    const features = sections.map(sec => {
      if (sec.level) lastLevel = sec.level;
      return { name: sec.name, level: sec.level || lastLevel, description: sec.body.join('\n'), source: sec.source };
    });
    const name = intro.length ? intro[0] : `${features.length} features`;
    const actions = [
      ['features', `Add as ${features.length} separate features`],
      ...(features[0].level ? [['classFeatures', 'Add to a class (each at its level)']] : []),
      ['feature', 'Add as one feature'],
      ['note', 'Append to notes'],
    ];
    const text = [intro.slice(1).join('\n'), ...features.map(f => `${f.level ? `Level ${f.level}: ` : ''}${f.name}\n${f.description}`)].filter(Boolean).join('\n\n');
    const summary = features.map(f => (f.level ? `${f.name} (${f.level})` : f.name)).join(', ');
    return entity('text', name, { name: '', className: '', features }, {
      typeLabel: `${features.length} features`, text, actions,
      summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    });
  }

  function fromText(text, out) {
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const { intro, sections } = splitSections(lines);
    if (sections.length >= 2) {
      // Several spells copied at once: every section has its own casting time.
      if (sections.every(sec => sec.body.some(l => /^casting time\b/i.test(l)))) {
        sections.forEach(sec => {
          const ent = spellFromText([sec.name, ...sec.body]);
          ent.source = ent.payload.source = sec.source;
          out.entities.push(ent);
        });
        return;
      }
      out.entities.push(featureGroup(intro, sections));
      return;
    }
    if (lines.some(l => /^casting time\b/i.test(l))) { out.entities.push(spellFromText(lines)); return; }
    const sb = statblockFromText(text, lines);
    if (sb) { out.entities.push(sb); return; }
    const name = lines[0].length > 120 ? `${lines[0].slice(0, 117)}…` : lines[0];
    const body = (lines[0].length > 120 ? lines : lines.slice(1)).join('\n');
    if (!body) out.warnings.push('Only one line was pasted, so it became the name with no description.');
    out.warnings.push("This text wasn't recognised as a spell or statblock. Pick where it should go with \"Add as\".");
    const looksLikeItem = /\b(wondrous item|weapon|armor|shield|potion|ring|rod|staff|wand|scroll|adventuring gear|tools?)\b/i.test(lines.slice(1, 3).join(' '));
    const actions = looksLikeItem ? [ACTIONS.text[1], ACTIONS.text[0], ...ACTIONS.text.slice(2)] : ACTIONS.text;
    out.entities.push(entity('text', name, null, { text: body, summary: body.slice(0, 160), actions }));
  }

  // ---------- Entry point ----------

  function parse(input) {
    const out = { entities: [], errors: [], warnings: [] };
    const text = String(input == null ? '' : input).trim();
    if (!text) {
      out.errors.push({ title: 'Nothing to import yet', detail: 'Paste homebrew text or JSON, or drop a .json file here.' });
      return out;
    }
    if (text.length > 2000000) {
      out.errors.push({ title: 'That paste is too large', detail: 'Paste under 2 MB at a time — for example one class or one source book rather than the whole site.' });
      return out;
    }
    if (/^[[{]/.test(text)) {
      let data;
      try { data = JSON.parse(text); } catch (e) { out.errors.push(jsonError(text, e)); return out; }
      fromJson(data, out);
      groupClassContent(out);
      if (!out.entities.length && !out.errors.length) {
        out.errors.push({
          title: 'No recognisable D&D content found',
          detail: "The JSON is valid, but it doesn't contain spells, items, feats, features, creatures, races, backgrounds or a character sheet.",
          hint: 'Each entry needs a "name" plus fields like "entries", "level" and "school" (spells), or "str"/"dex"/… (creatures).',
        });
      }
    } else {
      fromText(text, out);
    }
    return out;
  }

  return { parse, stripTags, renderEntries };
})();
