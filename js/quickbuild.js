'use strict';
/*
 * QuickBuild — turns a handful of choices plus an SRD bundle (js/srd/srd-2014.js or srd-2024.js)
 * into a complete character sheet. Pure: no DOM and no app state, so it is easy to test.
 *
 *   QuickBuild.defaults(data, classId)       -> sensible choices for a class
 *   QuickBuild.scores(data, choices)         -> { base, bonus, asi, final, notes }
 *   QuickBuild.build(data, choices)          -> a sheet ready for Schema.normalize
 *
 * choices = { ruleset, name, classId, subclassId, level, raceId, subraceId, backgroundId,
 *             method: 'standard'|'pointbuy'|'roll'|'manual', base: {str..cha},
 *             skills: [skillKey], equip: { o<i>: choiceIndex (class option i), b<i>: (background option i) },
 *             picks: { 'o<i>-<entry>': itemId } for "any martial weapon"-style category entries }
 */
const QuickBuild = (() => {
  const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const STANDARD = [15, 14, 13, 12, 10, 8];
  const POINT_BUY_DEFAULT = [15, 15, 14, 10, 8, 8]; // 9 + 9 + 7 + 2 = 27 points
  const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

  // Ability priority per class: first is where the highest score goes.
  const PRIORITY = {
    barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
    bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
    cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'],
    druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
    fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
    monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
    paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'],
    ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
    rogue: ['dex', 'con', 'int', 'wis', 'cha', 'str'],
    sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
    warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
    wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  };
  const SKILL_POPULARITY = ['perception', 'stealth', 'insight', 'athletics', 'acrobatics', 'persuasion', 'arcana',
    'investigation', 'survival', 'deception', 'religion', 'history', 'medicine', 'nature', 'intimidation',
    'animalHandling', 'sleightOfHand', 'performance'];
  const RACE_FOR_ABILITY_2014 = { str: 'half-orc', dex: 'elf', con: 'dwarf', int: 'gnome', wis: 'dwarf', cha: 'half-elf' };
  const SUBRACE_DEFAULT_2014 = { dwarf: 'hill-dwarf', elf: 'high-elf', halfling: 'lightfoot-halfling', gnome: 'rock-gnome' };
  const CATEGORY_DEFAULTS = {
    'martial-weapons': 'longsword', 'martial-melee-weapons': 'longsword', 'simple-weapons': 'spear',
    'simple-melee-weapons': 'mace', 'musical-instruments': 'lute', 'arcane-foci': 'crystal', 'druidic-foci': 'sprig-of-mistletoe',
    'holy-symbols': 'amulet', 'artisans-tools': 'smiths-tools', 'gaming-sets': 'dice-set',
  };
  // Good first picks when a caster needs spells; anything else on the class list fills in alphabetically.
  const SPELL_FAVOURITES = [
    'Eldritch Blast', 'Fire Bolt', 'Sacred Flame', 'Guidance', 'Vicious Mockery', 'Sorcerous Burst', 'Starry Wisp', 'Produce Flame',
    'Shillelagh', 'Ray of Frost', 'Mage Hand', 'Light', 'Prestidigitation', 'Minor Illusion', 'Thaumaturgy', 'Druidcraft',
    'Spare the Dying', 'Mending',
    'Shield', 'Magic Missile', 'Healing Word', 'Cure Wounds', 'Bless', 'Guiding Bolt', 'Sleep', 'Hex', "Hunter's Mark",
    'Faerie Fire', 'Thunderwave', 'Entangle', 'Goodberry', 'Mage Armor', 'Divine Smite', 'Searing Smite', 'Shield of Faith',
    'Command', 'Detect Magic', 'Burning Hands', 'Chromatic Orb', 'Ice Knife', 'Charm Person', 'Heroism', 'Dissonant Whispers',
    'Misty Step', 'Spiritual Weapon', 'Hold Person', 'Scorching Ray', 'Invisibility', 'Mirror Image', 'Aid', 'Moonbeam',
    'Lesser Restoration', 'Pass without Trace', 'Shatter', 'Web', 'Spike Growth', 'Suggestion', 'Flaming Sphere',
    'Fireball', 'Counterspell', 'Spirit Guardians', 'Revivify', 'Hypnotic Pattern', 'Haste', 'Fly', 'Lightning Bolt',
    'Mass Healing Word', 'Dispel Magic', 'Call Lightning', 'Conjure Animals', 'Fear',
    'Polymorph', 'Greater Invisibility', 'Banishment', 'Wall of Fire', 'Dimension Door', 'Guardian of Faith', 'Death Ward',
    'Wall of Force', 'Cone of Cold', 'Mass Cure Wounds', 'Animate Objects', 'Greater Restoration', 'Hold Monster', 'Raise Dead',
  ].map(n => n.toLowerCase());
  const NAMES = ['Aric', 'Brenna', 'Corin', 'Dara', 'Eldon', 'Fiora', 'Garrick', 'Hale', 'Isolde', 'Jory', 'Kaelen', 'Lira',
    'Maren', 'Nyx', 'Orin', 'Petra', 'Quinn', 'Rowan', 'Sable', 'Tamsin', 'Ulric', 'Vesna', 'Wren', 'Yara', 'Zane'];

  const mod = s => Math.floor((s - 10) / 2);
  const byId = (list, id) => list.find(x => x.id === id) || null;
  const priorityOf = cls => PRIORITY[cls.id] || [...(cls.primary || []), ...ABIL.filter(a => !(cls.primary || []).includes(a))];
  const randomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];
  const roll4d6 = () => {
    const d = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
    return d[1] + d[2] + d[3];
  };

  function assignByPriority(values, priority) {
    const sorted = [...values].sort((a, b) => b - a);
    const out = {};
    priority.forEach((a, i) => { out[a] = sorted[i]; });
    return out;
  }

  function pointBuyCost(base) {
    return ABIL.reduce((sum, a) => sum + (POINT_COST[base[a]] != null ? POINT_COST[base[a]] : 99), 0);
  }

  function defaultRace(data, cls) {
    if (data.meta.ruleset === '2024') return { raceId: 'human', subraceId: '' };
    const raceId = RACE_FOR_ABILITY_2014[priorityOf(cls)[0]] || 'human';
    const race = byId(data.races, raceId) || data.races[0];
    const sub = race.subs.length ? (byId(race.subs, SUBRACE_DEFAULT_2014[race.id]) || race.subs[0]).id : '';
    return { raceId: race.id, subraceId: sub };
  }

  // Thematic first choice when the ruleset offers several backgrounds (2024).
  const BACKGROUND_FOR_CLASS = {
    barbarian: 'soldier', bard: 'acolyte', cleric: 'acolyte', druid: 'sage', fighter: 'soldier', monk: 'soldier',
    paladin: 'soldier', ranger: 'soldier', rogue: 'criminal', sorcerer: 'acolyte', warlock: 'acolyte', wizard: 'sage',
  };

  function defaultBackground(data, cls) {
    const prio = priorityOf(cls);
    if (!data.backgrounds.length) return '';
    if (data.backgrounds.length === 1) return data.backgrounds[0].id;
    if (byId(data.backgrounds, BACKGROUND_FOR_CLASS[cls.id])) return BACKGROUND_FOR_CLASS[cls.id];
    const scored = data.backgrounds.map(b => ({ b, score: (b.asi || []).reduce((s, a) => s + (6 - prio.indexOf(a)), 0) }));
    return scored.sort((x, y) => y.score - x.score)[0].b.id;
  }

  function defaultSkills(data, cls, backgroundId, raceSkills) {
    const bg = byId(data.backgrounds, backgroundId);
    const taken = new Set([...(bg ? bg.skills : []), ...raceSkills]);
    if (!cls.skills) return [];
    const prio = priorityOf(cls);
    const abilityOf = k => (Rules.SKILLS.find(s => s.key === k) || {}).ability;
    const rank = k => prio.indexOf(abilityOf(k)) * 3 + SKILL_POPULARITY.indexOf(k) / 6;
    return cls.skills.from.filter(k => !taken.has(k)).sort((a, b) => rank(a) - rank(b)).slice(0, cls.skills.choose);
  }

  function raceSkills(data, raceId, subraceId) {
    const race = byId(data.races, raceId);
    if (!race) return [];
    const sub = byId(race.subs, subraceId);
    return [...race.skills, ...(sub ? sub.skills : [])];
  }

  function defaults(data, classId) {
    const cls = byId(data.classes, classId) || data.classes[0];
    const { raceId, subraceId } = defaultRace(data, cls);
    const backgroundId = defaultBackground(data, cls);
    return {
      ruleset: data.meta.ruleset, name: '', classId: cls.id, subclassId: cls.subclasses[0] ? cls.subclasses[0].id : '',
      level: 1, raceId, subraceId, backgroundId, method: 'standard',
      base: assignByPriority(STANDARD, priorityOf(cls)),
      skills: defaultSkills(data, cls, backgroundId, raceSkills(data, raceId, subraceId)),
      equip: {}, picks: {},
    };
  }

  /** Ability score breakdown: base + species/background bonuses + ASIs from levels. */
  function scores(data, ch) {
    const cls = byId(data.classes, ch.classId);
    const prio = priorityOf(cls);
    const base = { ...ch.base };
    const bonus = Object.fromEntries(ABIL.map(a => [a, 0]));
    const notes = [];
    const race = byId(data.races, ch.raceId);
    const sub = race && byId(race.subs, ch.subraceId);
    if (race) {
      race.asi.forEach(([a, b]) => { bonus[a] += b; });
      if (sub) sub.asi.forEach(([a, b]) => { bonus[a] += b; });
      if (race.asiOptions) {
        const picks = prio.filter(a => race.asiOptions.from.includes(a) && !race.asi.some(([x]) => x === a)).slice(0, race.asiOptions.choose);
        picks.forEach(a => { bonus[a] += race.asiOptions.bonus; });
        if (picks.length) notes.push(`${race.n}: +${race.asiOptions.bonus} ${picks.map(a => a.toUpperCase()).join(', ')}`);
      }
    }
    const bg = byId(data.backgrounds, ch.backgroundId);
    if (bg && bg.asi && bg.asi.length) {
      const ordered = prio.filter(a => bg.asi.includes(a));
      bonus[ordered[0]] += 2;
      bonus[ordered[1]] += 1;
      notes.push(`${bg.n}: +2 ${ordered[0].toUpperCase()}, +1 ${ordered[1].toUpperCase()}`);
    }
    const asi = Object.fromEntries(ABIL.map(a => [a, 0]));
    const asiLevels = (cls.asi || []).filter(l => l <= ch.level);
    const used = [];
    for (let i = 0; i < asiLevels.length; i++) {
      let points = 2;
      for (const a of prio) {
        while (points > 0 && base[a] + bonus[a] + asi[a] < 20) { asi[a] += 1; points -= 1; }
        if (!points) break;
      }
      used.push(asiLevels[i]);
    }
    if (used.length) {
      const gained = ABIL.filter(a => asi[a]).map(a => `+${asi[a]} ${a.toUpperCase()}`).join(', ');
      notes.push(`Ability Score Improvements at level ${used.join(', ')}: ${gained}`);
    }
    const final = Object.fromEntries(ABIL.map(a => [a, Math.min(20, base[a] + bonus[a] + asi[a])]));
    return { base, bonus, asi, final, notes };
  }

  // ---------- equipment ----------

  /** Default item for an "any X" equipment pick, suited to the class's main ability. */
  function categoryDefault(data, cls, cat) {
    const list = data.categories[cat] || [];
    let pref = CATEGORY_DEFAULTS[cat];
    const top = priorityOf(cls)[0];
    if (cat === 'simple-weapons' || cat === 'simple-melee-weapons') {
      pref = top === 'str' ? (cat === 'simple-weapons' ? 'spear' : 'mace') : top === 'dex' ? 'dagger' : 'quarterstaff';
    }
    return list.includes(pref) ? pref : list[0];
  }

  function resolveEntries(data, cls, bg, ch) {
    const out = [];
    let gp = 0;
    const take = (entries, prefix) => entries.forEach((e, j) => {
      if (e.gp) { gp += e.gp; return; }
      if (e.i) { out.push({ id: e.i, q: e.q }); return; }
      if (e.cat) {
        const chosen = (ch.picks && ch.picks[`${prefix}-${j}`]) || categoryDefault(data, cls, e.cat);
        if (chosen) out.push({ id: chosen, q: e.q });
      }
    });
    take(cls.equip, 'cf');
    cls.equipOptions.forEach((opt, i) => take(opt.choices[(ch.equip && ch.equip[`o${i}`]) || 0] || opt.choices[0], `o${i}`));
    if (bg) {
      take(bg.equip, 'bf');
      bg.equipOptions.forEach((opt, i) => take(opt.choices[(ch.equip && ch.equip[`b${i}`]) || 0] || opt.choices[0], `b${i}`));
      gp += bg.gold || 0;
    }
    return { items: out, gp };
  }

  function itemNotes(it) {
    const bits = [];
    if (it.wpn) {
      bits.push(`${it.wpn.cat} ${it.wpn.ranged ? 'ranged' : 'melee'} weapon · ${it.wpn.dice} ${it.wpn.type}`);
      if (it.wpn.twoH) bits.push(`Versatile: ${it.wpn.twoH}`);
      if (it.wpn.props.length) bits.push(`Properties: ${it.wpn.props.join(', ')}`);
      if (it.wpn.range) bits.push(`Range: ${it.wpn.range} ft`);
      if (it.wpn.mastery) bits.push(`Mastery: ${it.wpn.mastery}`);
    }
    if (it.arm) {
      bits.push(it.arm.cat === 'Shield' ? 'Shield · +2 AC'
        : `${it.arm.cat} armor · AC ${it.arm.base}${it.arm.dex ? ` + DEX${it.arm.max != null ? ` (max ${it.arm.max})` : ''}` : ''}`);
      if (it.arm.stealth) bits.push('Disadvantage on Stealth');
      if (it.arm.str) bits.push(`Needs STR ${it.arm.str}`);
    }
    return bits.join('\n');
  }

  function armorClass(clsId, final, items) {
    const dex = mod(final.dex);
    const armors = items.filter(x => x.arm && x.arm.cat !== 'Shield');
    const shield = items.some(x => x.arm && x.arm.cat === 'Shield');
    let best = null;
    let ac = 10 + dex;
    if (clsId === 'barbarian') ac = 10 + dex + mod(final.con);
    if (clsId === 'monk') ac = 10 + dex + mod(final.wis);
    for (const a of armors) {
      const v = a.arm.base + (a.arm.dex ? (a.arm.max != null ? Math.min(dex, a.arm.max) : dex) : 0);
      if (v > ac) { ac = v; best = a; }
    }
    const useShield = shield && clsId !== 'monk';
    return { ac: ac + (useShield ? 2 : 0), armor: best, shield: useShield };
  }

  function proficientWith(cls, it) {
    const w = cls.weapons.map(x => x.toLowerCase());
    if (w.some(x => x.includes(`${it.wpn.cat.toLowerCase()} weapon`))) return true;
    const name = it.n.toLowerCase();
    return w.some(x => x.replace(/s$/, '') === name || x === `${name}s` || x.includes(name));
  }

  function attackFor(cls, it, final, pb) {
    const str = mod(final.str);
    const dex = mod(final.dex);
    const finesse = it.wpn.props.some(p => /finesse/i.test(p));
    const thrown = it.wpn.props.some(p => /thrown/i.test(p));
    let m = str;
    if (it.wpn.ranged && !thrown) m = dex;
    else if (finesse || cls.id === 'monk') m = Math.max(str, dex);
    const prof = proficientWith(cls, it) ? pb : 0;
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    return {
      name: it.n, bonus: sign(m + prof),
      damage: `${it.wpn.dice}${m ? sign(m) : ''} ${it.wpn.type}`.trim(),
      notes: [it.wpn.range ? `Range ${it.wpn.range} ft` : '', it.wpn.props.join(', '), it.wpn.mastery ? `Mastery: ${it.wpn.mastery}` : '',
        prof ? '' : 'Not proficient'].filter(Boolean).join('; '),
    };
  }

  // ---------- spells ----------

  function spellPlan(cls, level, final, ruleset) {
    const lv = cls.levels[level] || {};
    if (!cls.spellAbility || cls.caster === 'none') return null;
    const slots = lv.slots || [];
    let maxLevel = 0;
    slots.forEach((n, i) => { if (n > 0) maxLevel = i + 1; });
    const abMod = mod(final[cls.spellAbility]);
    let count = lv.known != null ? lv.known : lv.prepared != null ? lv.prepared : 0;
    if (!count && maxLevel > 0 && ruleset === '2014') {
      if (cls.id === 'paladin') count = Math.max(1, abMod + Math.floor(level / 2));
      else if (['cleric', 'druid', 'wizard'].includes(cls.id)) count = Math.max(1, abMod + level);
    }
    return { cantrips: lv.cantrips || 0, count: maxLevel > 0 ? count : 0, maxLevel };
  }

  function pickSpells(data, cls, plan) {
    const rank = s => { const i = SPELL_FAVOURITES.indexOf(s.n.toLowerCase()); return i < 0 ? 1000 : i; };
    const pool = data.spells.filter(s => s.cls.includes(cls.id));
    const sortPool = list => [...list].sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n));
    const cantrips = sortPool(pool.filter(s => s.l === 0)).slice(0, plan.cantrips);
    const byLevel = {};
    for (let l = 1; l <= plan.maxLevel; l++) byLevel[l] = sortPool(pool.filter(s => s.l === l));
    const chosen = [];
    let progress = true;
    while (chosen.length < plan.count && progress) {
      progress = false;
      for (let l = plan.maxLevel; l >= 1 && chosen.length < plan.count; l--) {
        const next = byLevel[l].shift();
        if (next) { chosen.push(next); progress = true; }
      }
    }
    return { cantrips, leveled: chosen };
  }

  const toSheetSpell = (s, prepared) => ({
    name: s.n, level: s.l, school: s.s, castingTime: s.t, range: s.r, components: s.c, duration: s.d,
    concentration: s.cc, ritual: s.rt, prepared, description: [s.x, s.hl ? `At higher levels: ${s.hl}` : ''].filter(Boolean).join('\n\n'),
  });

  // ---------- build ----------

  function build(data, ch) {
    const ruleset = data.meta.ruleset;
    const cls = byId(data.classes, ch.classId);
    if (!cls) throw new Error('Choose a class first.');
    const level = Math.max(1, Math.min(20, Number(ch.level) || 1));
    const race = byId(data.races, ch.raceId);
    const sub = race && byId(race.subs, ch.subraceId);
    const bg = byId(data.backgrounds, ch.backgroundId);
    const subclass = byId(cls.subclasses, ch.subclassId);
    const src = ruleset === '2014' ? 'SRD 5.1' : 'SRD 5.2';
    const { final, notes: scoreNotes } = scores(data, ch);
    const pb = Rules.profBonus(level);

    const s = Schema.blank();
    s.ruleset = ruleset;
    s.name = (ch.name || '').trim() || randomName();
    s.race = race ? (sub ? sub.n : race.n) : '';
    s.background = bg ? bg.n : '';
    s.xp = Rules.XP_THRESHOLDS[level - 1];
    s.abilities = { ...final };
    cls.saves.forEach(a => { s.saveProf[a] = true; });

    const hasSubclass = subclass && level >= cls.subLevel;
    s.classes.push({ name: cls.n, subclass: hasSubclass ? subclass.n : '', level, hitDie: cls.hd, caster: cls.caster });

    // Skills: background + species + class picks; expertise from features
    const skillSet = new Set([...(bg ? bg.skills : []), ...raceSkills(data, ch.raceId, ch.subraceId), ...(ch.skills || [])]);
    skillSet.forEach(k => { if (k in s.skills) s.skills[k] = 1; });
    const expertiseCount = Object.entries(cls.levels).filter(([l, v]) => Number(l) <= level && v.f.some(f => /^Expertise/i.test(f.n))).length * 2;
    if (expertiseCount) {
      const prio = priorityOf(cls);
      const abilityOf = k => (Rules.SKILLS.find(x => x.key === k) || {}).ability;
      [...skillSet].sort((a, b) => prio.indexOf(abilityOf(a)) - prio.indexOf(abilityOf(b)) || SKILL_POPULARITY.indexOf(a) - SKILL_POPULARITY.indexOf(b))
        .slice(0, expertiseCount).forEach(k => { s.skills[k] = 2; });
    }
    s.jackOfAllTrades = cls.id === 'bard' && level >= 2;

    // Hit points: max at level 1, then the fixed average
    const conMod = mod(final.con);
    s.combat.hpMax = Math.max(1, cls.hd + conMod) + (level - 1) * Math.max(1, Math.floor(cls.hd / 2) + 1 + conMod);
    s.combat.hpCurrent = s.combat.hpMax;
    s.combat.speed = race ? race.speed : 30;

    // Equipment, armor class, attacks
    const { items, gp } = resolveEntries(data, cls, bg, ch);
    const merged = new Map();
    for (const { id, q } of items) merged.set(id, (merged.get(id) || 0) + q);
    const full = [...merged.entries()].map(([id, q]) => ({ ...data.equipment[id], id, q })).filter(x => x.n);
    const { ac, armor, shield } = armorClass(cls.id, final, full);
    s.combat.ac = ac;
    s.combat.acAuto = true;
    for (const it of full) {
      const contents = it.contents ? `Contains: ${it.contents.map(([cid, cq]) => `${(data.equipment[cid] || {}).n || cid}${cq > 1 ? ` ×${cq}` : ''}`).join(', ')}` : '';
      s.inventory.push({
        name: it.n, qty: it.q, weight: it.w || 0,
        equipped: !!(it.wpn || (armor && armor.id === it.id) || (shield && it.arm && it.arm.cat === 'Shield')),
        notes: [itemNotes(it), contents].filter(Boolean).join('\n'), source: src,
        armor: it.arm ? it.arm.cat.toLowerCase() : '', acValue: it.arm ? it.arm.base || 0 : 0,
      });
    }
    s.currency.gp = gp;
    full.filter(it => it.wpn && !/arrow|bolt|needle|bullet/i.test(it.n)).forEach(it => s.attacks.push(attackFor(cls, it, final, pb)));

    // Proficiencies & languages
    s.proficiencies.armor = cls.armor.join(', ');
    s.proficiencies.weapons = cls.weapons.join(', ');
    s.proficiencies.tools = [...cls.tools, ...(bg ? bg.tools : [])].join(', ');
    const langs = race ? [...race.languages] : ['Common'];
    const extra = ruleset === '2024' ? 2 : (bg && bg.languageChoices) || 0;
    s.proficiencies.languages = [...langs, extra ? `${extra} more of your choice` : ''].filter(Boolean).join(', ');

    // Features: class & subclass up to this level now, the rest queued for the level-up wizard
    const queue = (name, lv, desc, subName) => s.pendingFeatures.push({ className: cls.n, subclass: subName || '', level: lv, name, description: desc, source: src });
    Object.entries(cls.levels).forEach(([lv, entry]) => {
      const l = Number(lv);
      entry.f.forEach(f => {
        if (l <= level) s.features.push({ name: f.n, origin: 'Class', source: `${cls.n} ${l}`, description: f.d });
        else queue(f.n, l, f.d, '');
      });
    });
    if (subclass) {
      subclass.f.forEach(f => {
        if (f.lv <= level && hasSubclass) s.features.push({ name: f.n, origin: 'Class', source: `${cls.n} (${subclass.n}) ${f.lv}`, description: f.d });
        else queue(f.n, Math.max(f.lv, cls.subLevel), f.d, subclass.n);
      });
    }
    if (race) {
      [...race.traits, ...(sub ? sub.traits : [])].forEach(t => s.features.push({
        name: t.n, origin: 'Race', source: s.race, description: t.lv > level ? `From character level ${t.lv}.\n${t.d}` : t.d,
      }));
    }
    if (bg && bg.feature) s.features.push({ name: bg.feature.n, origin: 'Background', source: bg.n, description: bg.feature.d });
    if (bg && bg.feat) {
      const featName = bg.feat.n.replace(/\s*\(.*\)$/, '');
      const feat = data.feats.find(f => f.n === featName);
      s.features.push({ name: bg.feat.n, origin: 'Feat', source: `${bg.n} background`, description: (feat && feat.d) || bg.feat.d });
    }

    // Spells
    const plan = spellPlan(cls, level, final, ruleset);
    if (plan) {
      s.spellcasting.ability = cls.spellAbility;
      const { cantrips, leveled } = pickSpells(data, cls, plan);
      cantrips.forEach(sp => s.spellcasting.spells.push({ ...toSheetSpell(sp, false), source: src }));
      leveled.forEach(sp => s.spellcasting.spells.push({ ...toSheetSpell(sp, true), source: src }));
    }

    const summary = `Quick-built level ${level} ${s.race ? `${s.race} ` : ''}${cls.n}${s.classes[0].subclass ? ` (${s.classes[0].subclass})` : ''} with ${data.meta.label}`;
    s.history = [{ id: Schema.uid(), date: new Date().toISOString(), type: 'created', summary: [summary, ...scoreNotes].join('. '), snapshot: null }];
    return s;
  }

  return {
    ABIL, STANDARD, POINT_BUY_DEFAULT, POINT_COST, priorityOf, assignByPriority, pointBuyCost, roll4d6,
    defaults, scores, build, defaultSkills, raceSkills, categoryDefault, randomName,
  };
})();
