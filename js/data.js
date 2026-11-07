'use strict';
/*
 * Rules — static D&D 5e reference data and pure calculation helpers.
 * No DOM access and no state: every function takes what it needs as arguments.
 */
const Rules = (() => {
  const ABILITIES = [
    { key: 'str', name: 'Strength', short: 'STR' },
    { key: 'dex', name: 'Dexterity', short: 'DEX' },
    { key: 'con', name: 'Constitution', short: 'CON' },
    { key: 'int', name: 'Intelligence', short: 'INT' },
    { key: 'wis', name: 'Wisdom', short: 'WIS' },
    { key: 'cha', name: 'Charisma', short: 'CHA' },
  ];

  const SKILLS = [
    ['acrobatics', 'Acrobatics', 'dex'],
    ['animalHandling', 'Animal Handling', 'wis'],
    ['arcana', 'Arcana', 'int'],
    ['athletics', 'Athletics', 'str'],
    ['deception', 'Deception', 'cha'],
    ['history', 'History', 'int'],
    ['insight', 'Insight', 'wis'],
    ['intimidation', 'Intimidation', 'cha'],
    ['investigation', 'Investigation', 'int'],
    ['medicine', 'Medicine', 'wis'],
    ['nature', 'Nature', 'int'],
    ['perception', 'Perception', 'wis'],
    ['performance', 'Performance', 'cha'],
    ['persuasion', 'Persuasion', 'cha'],
    ['religion', 'Religion', 'int'],
    ['sleightOfHand', 'Sleight of Hand', 'dex'],
    ['stealth', 'Stealth', 'dex'],
    ['survival', 'Survival', 'wis'],
  ].map(([key, name, ability]) => ({ key, name, ability }));

  // Total XP needed to reach level N is XP_THRESHOLDS[N - 1].
  const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

  const DEFAULT_ASI = [4, 8, 12, 16, 19];

  const CLASSES = {
    Artificer: { hitDie: 8, saves: ['con', 'int'], caster: 'artificer', spellAbility: 'int' },
    Barbarian: { hitDie: 12, saves: ['str', 'con'], caster: 'none' },
    Bard: { hitDie: 8, saves: ['dex', 'cha'], caster: 'full', spellAbility: 'cha' },
    Cleric: { hitDie: 8, saves: ['wis', 'cha'], caster: 'full', spellAbility: 'wis' },
    Druid: { hitDie: 8, saves: ['int', 'wis'], caster: 'full', spellAbility: 'wis' },
    Fighter: { hitDie: 10, saves: ['str', 'con'], caster: 'none', asiLevels: [4, 6, 8, 12, 14, 16, 19] },
    Monk: { hitDie: 8, saves: ['str', 'dex'], caster: 'none' },
    Paladin: { hitDie: 10, saves: ['wis', 'cha'], caster: 'half', spellAbility: 'cha' },
    Ranger: { hitDie: 10, saves: ['str', 'dex'], caster: 'half', spellAbility: 'wis' },
    Rogue: { hitDie: 8, saves: ['dex', 'int'], caster: 'none', asiLevels: [4, 8, 10, 12, 16, 19] },
    Sorcerer: { hitDie: 6, saves: ['con', 'cha'], caster: 'full', spellAbility: 'cha' },
    Warlock: { hitDie: 8, saves: ['wis', 'cha'], caster: 'pact', spellAbility: 'cha' },
    Wizard: { hitDie: 6, saves: ['int', 'wis'], caster: 'full', spellAbility: 'int' },
  };

  const CASTER_TYPES = {
    none: 'Non-caster',
    full: 'Full caster',
    half: 'Half caster (Paladin, Ranger)',
    third: 'Third caster (Eldritch Knight, Arcane Trickster)',
    artificer: 'Artificer (half, rounds up)',
    pact: 'Pact Magic (Warlock)',
  };

  const HIT_DICE = [6, 8, 10, 12];

  // Multiclass spellcaster table, indexed by caster level - 1.
  const FULL_SLOTS = [
    [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2],
    [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
  ];

  // Exhaustion is tracked separately as a 0–6 level.
  const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

  const ORDINAL =['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
  const CURRENCIES = [['cp', 'Copper'], ['sp', 'Silver'], ['ep', 'Electrum'], ['gp', 'Gold'], ['pp', 'Platinum']];

  const mod = score => Math.floor(((Number(score) || 0) - 10) / 2);
  const fmtMod = n => (n >= 0 ? '+' : '') + n;
  const clampLevel = l => Math.max(0, Math.min(20, Math.floor(Number(l) || 0)));

  const totalLevel = sheet => sheet.classes.reduce((sum, c) => sum + clampLevel(c.level), 0);
  const profBonus = level => 2 + Math.floor((Math.max(1, level) - 1) / 4);

  function levelForXp(xp) {
    let level = 0;
    for (const t of XP_THRESHOLDS) if (xp >= t) level++;
    return Math.min(20, Math.max(1, level));
  }

  function classInfo(name) {
    const key = Object.keys(CLASSES).find(k => k.toLowerCase() === String(name || '').trim().toLowerCase());
    return key ? { name: key, ...CLASSES[key] } : null;
  }

  function isAsiLevel(className, classLevel) {
    const info = classInfo(className);
    return (info && info.asiLevels ? info.asiLevels : DEFAULT_ASI).includes(classLevel);
  }

  function classSummary(sheet) {
    return sheet.classes
      .map(c => `${c.name || 'Class'}${c.subclass ? ` (${c.subclass})` : ''} ${clampLevel(c.level)}`)
      .join(' / ');
  }

  /**
   * Spell slots for a set of classes: { slots: [9 counts], pact: {count, level} | null }.
   * ruleset '2024' gives half casters (Paladin, Ranger) slots from level 1 and rounds their
   * multiclass contribution up; 2014 (and custom sheets) start at level 2 and round down.
   */
  function spellSlots(classes, ruleset) {
    const r2024 = ruleset === '2024';
    const casters = classes.filter(c => ['full', 'half', 'third', 'artificer'].includes(c.caster));
    let casterLevel = 0;
    if (casters.length === 1) {
      const c = casters[0];
      const l = clampLevel(c.level);
      if (c.caster === 'full') casterLevel = l;
      else if (c.caster === 'artificer') casterLevel = Math.ceil(l / 2);
      else if (c.caster === 'half') casterLevel = l < 2 && !r2024 ? 0 : Math.ceil(l / 2);
      else if (c.caster === 'third') casterLevel = l < 3 ? 0 : Math.ceil(l / 3);
    } else {
      for (const c of casters) {
        const l = clampLevel(c.level);
        if (c.caster === 'full') casterLevel += l;
        else if (c.caster === 'artificer') casterLevel += Math.ceil(l / 2);
        else if (c.caster === 'half') casterLevel += r2024 ? Math.ceil(l / 2) : Math.floor(l / 2);
        else if (c.caster === 'third') casterLevel += Math.floor(l / 3);
      }
    }
    casterLevel = Math.min(20, casterLevel);
    const row = casterLevel > 0 ? FULL_SLOTS[casterLevel - 1] : [];
    const slots = Array.from({ length: 9 }, (_, i) => row[i] || 0);

    const pactLevel = classes.filter(c => c.caster === 'pact').reduce((s, c) => s + clampLevel(c.level), 0);
    const pact = pactLevel > 0
      ? { count: pactLevel === 1 ? 1 : pactLevel < 11 ? 2 : pactLevel < 17 ? 3 : 4, level: Math.min(5, Math.ceil(pactLevel / 2)) }
      : null;
    return { slots, pact };
  }

  function skillBonus(sheet, key) {
    const skill = SKILLS.find(s => s.key === key);
    const pb = profBonus(totalLevel(sheet));
    const rank = sheet.skills[key] || 0;
    const base = mod(sheet.abilities[skill.ability]);
    if (rank === 2) return base + pb * 2;
    if (rank === 1) return base + pb;
    return base + (sheet.jackOfAllTrades ? Math.floor(pb / 2) : 0);
  }

  function saveBonus(sheet, ability) {
    return mod(sheet.abilities[ability]) + (sheet.saveProf[ability] ? profBonus(totalLevel(sheet)) : 0);
  }

  /** Total levels per hit die size, e.g. { 10: 3, 6: 2 }. */
  function hitDicePools(sheet) {
    const pools = {};
    for (const c of sheet.classes) {
      const die = Number(c.hitDie) || 8;
      pools[die] = (pools[die] || 0) + clampLevel(c.level);
    }
    return pools;
  }

  function inventoryWeight(sheet) {
    const items = sheet.inventory.reduce((s, it) => s + (Number(it.weight) || 0) * (Number(it.qty) || 0), 0);
    const coins = CURRENCIES.reduce((s, [k]) => s + (Number(sheet.currency[k]) || 0), 0) / 50;
    return Math.round((items + coins) * 100) / 100;
  }

  // ---------- armor class ----------

  const ARMOR_BY_NAME = {
    padded: ['light', 11], leather: ['light', 11], 'studded leather': ['light', 12],
    hide: ['medium', 12], 'chain shirt': ['medium', 13], 'scale mail': ['medium', 14], breastplate: ['medium', 14], 'half plate': ['medium', 15],
    'ring mail': ['heavy', 14], 'chain mail': ['heavy', 16], splint: ['heavy', 17], plate: ['heavy', 18],
    shield: ['shield', 2],
  };
  const ARMOR_DEFAULTS = { light: 11, medium: 12, heavy: 14, shield: 2, bonus: 1 };

  /** What an inventory item does for AC: { type, value } or null. Blank `armor` means work it out from the name or notes. */
  function armorOf(item) {
    const type = item.armor || '';
    if (type === 'none') return null;
    if (type) return { type, value: Number(item.acValue) || ARMOR_DEFAULTS[type] || 0 };
    const raw = String(item.name || '').trim().toLowerCase();
    const magic = /^\+(\d)\s+|\s\+(\d)$/.exec(raw);
    const name = raw.replace(/^\+\d\s+|\s\+\d$/, '').replace(/\s*\(.*\)$/, '').replace(/\s+armou?r$/, '');
    const known = ARMOR_BY_NAME[name];
    if (known) return { type: known[0], value: known[1] + (magic ? Number(magic[1] || magic[2]) : 0) };
    const notes = String(item.notes || '');
    const body = /^(Light|Medium|Heavy) armor · AC (\d+)/m.exec(notes);
    if (body) return { type: body[1].toLowerCase(), value: Number(body[2]) };
    const shield = /^Shield · \+(\d+) AC/m.exec(notes);
    return shield ? { type: 'shield', value: Number(shield[1]) } : null;
  }

  /** AC from equipped gear and class: { total, parts: ['Chain Mail 16', 'Shield +2'] }. */
  function armorClass(sheet) {
    const dex = mod(sheet.abilities.dex);
    const worn = sheet.inventory.filter(i => i.equipped).map(i => ({ name: i.name, a: armorOf(i) })).filter(x => x.a);
    const bodyValue = a => a.value + (a.type === 'light' ? dex : a.type === 'medium' ? Math.min(dex, 2) : 0);
    const bodies = worn.filter(x => ['light', 'medium', 'heavy'].includes(x.a.type));
    const shields = worn.filter(x => x.a.type === 'shield');
    const hasClass = n => sheet.classes.some(c => String(c.name).trim().toLowerCase() === n && clampLevel(c.level) > 0);
    let base = 10 + dex;
    let label = 'Unarmored';
    if (bodies.length) {
      const best = bodies.reduce((x, y) => (bodyValue(y.a) > bodyValue(x.a) ? y : x));
      base = bodyValue(best.a);
      label = best.name;
    } else {
      const barb = hasClass('barbarian') ? 10 + dex + mod(sheet.abilities.con) : 0;
      const monk = hasClass('monk') && !shields.length ? 10 + dex + mod(sheet.abilities.wis) : 0;
      if (Math.max(barb, monk) > base) { base = Math.max(barb, monk); label = 'Unarmored Defense'; }
    }
    const parts = [`${label} ${base}`];
    let total = base;
    if (shields.length) {
      const best = shields.reduce((x, y) => (y.a.value > x.a.value ? y : x));
      total += best.a.value;
      parts.push(`${best.name} +${best.a.value}`);
    }
    for (const x of worn.filter(w => w.a.type === 'bonus')) { total += x.a.value; parts.push(`${x.name} +${x.a.value}`); }
    const other = Number(sheet.combat.acBonus) || 0;
    if (other) { total += other; parts.push(`Other ${fmtMod(other)}`); }
    return { total, parts };
  }

  // ---------- class resources (Rage, Focus Points, ...) ----------

  /** Value for a class level from ascending [level, value] pairs; 0 before the first. */
  const tier = (l, pairs) => pairs.reduce((v, [at, n]) => (l >= at ? n : v), 0);

  // recharge: 'short' (all back on a short or long rest), 'short1' (one back on a short rest, all on a long rest), 'long', 'none'
  const CLASS_RESOURCES = {
    artificer: (l, y, ab) => [{ name: 'Flash of Genius', max: l >= 7 ? Math.max(1, ab.int) : 0, recharge: 'long' }],
    barbarian: (l, y) => [{ name: 'Rage', max: !y && l >= 20 ? 0 : tier(l, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]), recharge: y ? 'short1' : 'long' }],
    bard: (l, y, ab) => [{ name: 'Bardic Inspiration', max: Math.max(1, ab.cha), recharge: l >= 5 ? 'short' : 'long' }],
    cleric: (l, y) => [{ name: 'Channel Divinity', max: tier(l, y ? [[2, 2], [6, 3], [18, 4]] : [[2, 1], [6, 2], [18, 3]]), recharge: y ? 'short1' : 'short' }],
    druid: (l, y) => [y
      ? { name: 'Wild Shape', max: tier(l, [[2, 2], [6, 3], [17, 4]]), recharge: 'short1' }
      : { name: 'Wild Shape', max: l >= 2 && l < 20 ? 2 : 0, recharge: 'short' }],
    fighter: (l, y, ab, sub) => [
      y ? { name: 'Second Wind', max: tier(l, [[1, 2], [4, 3], [10, 4]]), recharge: 'short1' } : { name: 'Second Wind', max: 1, recharge: 'short' },
      { name: 'Action Surge', max: tier(l, [[2, 1], [17, 2]]), recharge: 'short' },
      { name: 'Indomitable', max: tier(l, [[9, 1], [13, 2], [17, 3]]), recharge: 'long' },
      { name: 'Superiority Dice', max: /battle\s*master/i.test(sub) ? tier(l, [[3, 4], [7, 5], [15, 6]]) : 0, recharge: 'short' },
    ],
    monk: (l, y) => [{ name: y ? 'Focus Points' : 'Ki Points', max: l >= 2 ? l : 0, recharge: 'short' }],
    paladin: (l, y, ab) => [
      { name: 'Lay on Hands (HP pool)', max: l * 5, recharge: 'long' },
      { name: 'Channel Divinity', max: y ? tier(l, [[3, 2], [11, 3]]) : tier(l, [[3, 1]]), recharge: y ? 'short1' : 'short' },
      { name: 'Divine Sense', max: y ? 0 : 1 + Math.max(0, ab.cha), recharge: 'long' },
    ],
    ranger: (l, y) => [{ name: 'Favored Enemy (free Hunter\'s Mark)', max: y ? tier(l, [[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]]) : 0, recharge: 'long' }],
    rogue: l => [{ name: 'Stroke of Luck', max: l >= 20 ? 1 : 0, recharge: 'short' }],
    sorcerer: (l, y) => [
      { name: 'Sorcery Points', max: l >= 2 ? l : 0, recharge: 'long' },
      { name: 'Innate Sorcery', max: y ? 2 : 0, recharge: 'long' },
    ],
    warlock: (l, y) => [{ name: 'Magical Cunning', max: y && l >= 2 ? 1 : 0, recharge: 'long' }],
    wizard: () => [{ name: 'Arcane Recovery', max: 1, recharge: 'long' }],
  };

  /** Trackers a character's classes grant at their current levels: [{ key, name, max, recharge }]. */
  function classResources(sheet) {
    const y = sheet.ruleset === '2024';
    const ab = Object.fromEntries(ABILITIES.map(a => [a.key, mod(sheet.abilities[a.key])]));
    const out = [];
    for (const c of sheet.classes) {
      const id = String(c.name || '').trim().toLowerCase();
      const l = clampLevel(c.level);
      if (!CLASS_RESOURCES[id] || !l) continue;
      for (const r of CLASS_RESOURCES[id](l, y, ab, c.subclass || '')) {
        if (r.max > 0) out.push({ key: `${id}:${r.name}`, ...r });
      }
    }
    return out;
  }

  // ---------- when things happen at the table ----------

  const spellTiming = castingTime => {
    const t = String(castingTime || '');
    return /bonus/i.test(t) ? 'bonus' : /reaction/i.test(t) ? 'reaction' : /action/i.test(t) ? 'action' : 'other';
  };

  /** Which Play tab group a feature belongs in: its own setting, else read from its text. */
  function featureTiming(f) {
    if (f.timing) return f.timing;
    const t = String(f.description || '');
    if (/bonus action/i.test(t)) return 'bonus';
    if (/\breaction\b/i.test(t)) return 'reaction';
    if (/\b(as an?|use an?|use your|take an?|take the \w+|magic|utilize) action\b|\badditional action\b|\baction to\b/i.test(t)) return 'action';
    return 'passive';
  }

  const d = faces => 1 + Math.floor(Math.random() * faces);

  /** Roll a damage expression such as "1d8+3 slashing" or "2d6 + 1d4 - 1". Crits double the dice. */
  function rollDamage(expr, crit = false) {
    const text = String(expr || '');
    const rolls = [];
    for (const m of text.matchAll(/(\d*)\s*d\s*(\d+)/gi)) {
      const count = (Number(m[1]) || 1) * (crit ? 2 : 1);
      for (let i = 0; i < count; i++) rolls.push(d(Number(m[2])));
    }
    const flat = (text.replace(/(\d*)\s*d\s*(\d+)/gi, '').match(/[+-]\s*\d+/g) || []).reduce((s, x) => s + Number(x.replace(/\s/g, '')), 0);
    const typeMatch = /([a-z]{3,})\s*$/i.exec(text);
    const total = rolls.reduce((s, x) => s + x, 0) + flat;
    return { total: Math.max(0, total), rolls, flat, type: typeMatch ? typeMatch[1].toLowerCase() : '', valid: rolls.length > 0 || /\d/.test(text) };
  }

  return {
    d, rollDamage,
    ABILITIES, SKILLS, XP_THRESHOLDS, CLASSES, CASTER_TYPES, HIT_DICE, ORDINAL, CURRENCIES, CONDITIONS,
    mod, fmtMod, clampLevel, totalLevel, profBonus, levelForXp, classInfo, isAsiLevel,
    classSummary, spellSlots, skillBonus, saveBonus, hitDicePools, inventoryWeight,
    armorOf, armorClass, classResources, spellTiming, featureTiming,
  };
})();
