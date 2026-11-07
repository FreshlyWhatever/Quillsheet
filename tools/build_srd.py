"""
Convert the 5e-bits SRD JSON (2014 = SRD 5.1, 2024 = SRD 5.2) into one compact JS bundle per
ruleset for Quillsheet's Quick Build. Both rulesets are mapped onto the same shape so the app
only needs one code path.

Usage: python -I build_srd.py <srd-root containing 2014/ and 2024/> <output dir>
"""
import json, re, sys, pathlib

SRC, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha']

CREDITS = {
    '2014': ('This file includes material taken from the System Reference Document 5.1 ("SRD 5.1") by '
             'Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. '
             'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at '
             'https://creativecommons.org/licenses/by/4.0/legalcode.'),
    '2024': ('This file includes material taken from the System Reference Document 5.2 ("SRD 5.2") by '
             'Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the '
             'Creative Commons Attribution 4.0 International License, available at '
             'https://creativecommons.org/licenses/by/4.0/legalcode.'),
}
DATA_CREDIT = ('Data structured by the 5e-bits 5e SRD API project (https://github.com/5e-bits/5e-srd-api), '
               'MIT License, Copyright (c) 2018-2020 Adrian Padua, Christopher Ward. '
               'Converted and abridged for Quillsheet; see THIRD_PARTY_NOTICES.md.')


def load(v, name):
    p = SRC / v / f'5e-SRD-{name}.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else []


def text(o):
    """Description text from either schema (2014 `desc` list, 2024 `description` string)."""
    d = o.get('desc', o.get('description', ''))
    if isinstance(d, list):
        d = '\n'.join(str(x) for x in d)
    return re.sub(r'\*\*(.+?)\*\*', r'\1', str(d or '')).strip()


def skill_key(index):
    words = index.replace('skill-', '').split('-')
    return words[0] + ''.join(w.capitalize() for w in words[1:])


def option_list(opts):
    return ((opts or {}).get('from') or {}).get('options') or []


def conv_option(o):
    """One equipment option -> list of entries: {i,q} item, {cat,q} category pick, {gp} money."""
    t = o.get('option_type')
    if t == 'multiple':
        return [e for x in o.get('items', []) for e in conv_option(x)]
    if t == 'money':
        return [{'gp': o.get('count', 0)}]
    if t == 'counted_reference':
        ref = o['of']
        if '/equipment-categories/' in ref.get('url', ''):
            return [{'cat': ref['index'], 'q': o.get('count', 1)}]
        return [{'i': ref['index'], 'q': o.get('count', 1)}]
    if t == 'reference':
        return [{'i': o['item']['index'], 'q': 1}]
    if t == 'choice':
        ch = o['choice']
        src = ch.get('from', {})
        if src.get('option_set_type') == 'equipment_category':
            return [{'cat': src['equipment_category']['index'], 'q': ch.get('choose', 1)}]
        first = option_list(ch)
        return conv_option(first[0]) if first else []
    return []


def conv_equipment_options(lst):
    out = []
    for opt in lst or []:
        src = opt.get('from', {})
        if src.get('option_set_type') == 'equipment_category':
            choices = [[{'cat': src['equipment_category']['index'], 'q': opt.get('choose', 1)}]]
        else:
            choices = [conv_option(o) for o in src.get('options', [])]
        choices = [c for c in choices if c]
        if choices:
            out.append({'desc': opt.get('desc', ''), 'choices': choices})
    return out


def split_profs(profs):
    armor, weapons, tools = [], [], []
    for p in profs:
        n, i = p['name'], p['index']
        if i.startswith('skill-') or i.startswith('saving-throw'):
            continue
        n = n.replace('Tool: ', '')
        if 'armor' in i or i in ('shields', 'all-armor'):
            armor.append(n)
        elif 'weapon' in i or i in ('clubs', 'daggers', 'darts', 'javelins', 'maces', 'quarterstaffs', 'sickles', 'spears',
                                    'light-crossbows', 'slings', 'hand-crossbows', 'longswords', 'rapiers', 'shortswords',
                                    'scimitars', 'longbows', 'shortbows', 'battleaxes', 'handaxes', 'light-hammers', 'warhammers'):
            weapons.append(n)
        else:
            tools.append(n)
    return armor, weapons, tools


def build(v):
    features = {f['index']: f for f in load(v, 'Features')}
    levels = load(v, 'Levels')
    subclasses_raw = {s['index']: s for s in load(v, 'Subclasses')}
    traits = {t['index']: t for t in load(v, 'Traits')}
    feats_raw = load(v, 'Feats')

    # ---------- equipment ----------
    equipment, cats = {}, {}
    for e in load(v, 'Equipment'):
        item = {'n': e['name'], 'w': e.get('weight', 0) or 0}
        cost = e.get('cost')
        if cost:
            item['c'] = f"{cost.get('quantity')} {cost.get('unit')}"
        ecats = [c['index'] for c in e.get('equipment_categories', [])]
        for c in ecats:
            cats.setdefault(c, []).append(e['index'])
        if e.get('damage'):
            props = [p['name'] for p in e.get('properties', [])]
            ranged = 'ranged' in ' '.join(ecats) or e.get('weapon_range') == 'Ranged'
            wpn = {'dice': e['damage'].get('damage_dice', ''), 'type': e['damage'].get('damage_type', {}).get('name', '').lower(),
                   'props': props, 'ranged': ranged,
                   'cat': 'Martial' if any('martial' in c for c in ecats) or e.get('weapon_category') == 'Martial' else 'Simple'}
            rng = e.get('range') or {}
            if rng.get('long'):
                wpn['range'] = f"{rng.get('normal')}/{rng.get('long')}"
            thr = e.get('throw_range')
            if thr:
                wpn['range'] = f"{thr.get('normal')}/{thr.get('long')}"
            if e.get('two_handed_damage'):
                wpn['twoH'] = e['two_handed_damage'].get('damage_dice')
            if e.get('mastery'):
                wpn['mastery'] = e['mastery']['name']
            item['wpn'] = wpn
        ac = e.get('armor_class')
        if ac:
            cat = e.get('armor_category') or next((c.split('-')[0].capitalize() for c in ecats if c.endswith('-armor')), None)
            if 'shields' in ecats or e['index'] == 'shield':
                cat = 'Shield'
            mx = ac.get('max_bonus')
            if mx is None and cat == 'Medium':
                mx = 2
            item['arm'] = {'base': ac.get('base', 10), 'dex': bool(ac.get('dex_bonus')), 'max': mx, 'cat': cat,
                           'stealth': bool(e.get('stealth_disadvantage')), 'str': e.get('str_minimum') or 0}
        if e.get('contents'):
            item['contents'] = [[x['item']['index'], x.get('quantity', 1)] for x in e['contents'] if x.get('item')]
        equipment[e['index']] = item
    # pack weight = sum of contents
    for it in equipment.values():
        if it.get('contents') and not it['w']:
            it['w'] = round(sum((equipment.get(i, {}).get('w', 0) or 0) * q for i, q in it['contents']), 2)

    # ---------- classes ----------
    classes = []
    for c in load(v, 'Classes'):
        cid = c['index']
        lv = sorted((l for l in levels if l['class']['index'] == cid and not l.get('subclass')), key=lambda l: l['level'])
        out_levels, asi_levels, slots20 = {}, [], [0] * 9
        prev_asi = 0
        for l in lv:
            names = []
            for f in l.get('features', []):
                full = features.get(f['index'], {})
                n = full.get('name', f['name'])
                if n.startswith('Ability Score Improvement'):
                    asi_levels.append(l['level'])
                    continue
                # "Subclass Feature" (2024) and "Martial Archetype feature" (2014) only say "your subclass
                # grants something now"; the real subclass features are listed separately.
                if n in ('Subclass Feature',) or n.endswith(' Subclass Feature') or n.endswith(' feature'):
                    continue
                names.append({'n': n, 'd': text(full)})
            if 'ability_score_bonuses' in l and l['ability_score_bonuses'] > prev_asi:
                if l['level'] not in asi_levels:
                    asi_levels.append(l['level'])
                prev_asi = l['ability_score_bonuses']
            entry = {'f': names}
            sc = l.get('spellcasting')
            if sc:
                slots = [sc.get(f'spell_slots_level_{i}', 0) or 0 for i in range(1, 10)]
                entry['slots'] = slots
                for k, short in (('cantrips_known', 'cantrips'), ('spells_known', 'known'), ('prepared_spells', 'prepared')):
                    if sc.get(k) is not None:
                        entry[short] = sc[k]
                if l['level'] == 20:
                    slots20 = slots
            out_levels[l['level']] = entry
        if cid == 'warlock':
            caster = 'pact'
        elif slots20[8] > 0:
            caster = 'full'
        elif any(slots20):
            caster = 'half'
        else:
            caster = 'none'
        skill_choice = None
        for pc in c.get('proficiency_choices', []):
            opts = option_list(pc)
            keys = [skill_key(o['item']['index']) for o in opts if o.get('item', {}).get('index', '').startswith('skill-')]
            if keys:
                skill_choice = {'choose': pc.get('choose', 2), 'from': keys}
                break
        armor, weapons, tools = split_profs(c.get('proficiencies', []))
        primary = []
        pa = c.get('primary_ability')
        if pa:
            primary = [o['item']['index'] for o in option_list(pa.get('ability_score_options'))] or \
                      [a['index'] for a in pa.get('all_of', [])]
        if not primary:
            prereq = (c.get('multi_classing') or {}).get('prerequisites') or []
            primary = [p['ability_score']['index'] for p in prereq if p.get('ability_score')]
            if not primary:
                po = (c.get('multi_classing') or {}).get('prerequisite_options')
                primary = [o['ability_score']['index'] for o in option_list(po) if o.get('ability_score')]

        subs = []
        for ref in c.get('subclasses', []):
            s = subclasses_raw.get(ref['index'])
            if not s:
                continue
            sfeat = []
            if s.get('features'):  # 2024: inline
                for f in s['features']:
                    sfeat.append({'lv': f.get('level', 3), 'n': f['name'], 'd': text(f)})
            else:  # 2014: via levels + features
                for l in levels:
                    if (l.get('subclass') or {}).get('index') == s['index']:
                        for f in l.get('features', []):
                            full = features.get(f['index'], {})
                            sfeat.append({'lv': l['level'], 'n': full.get('name', f['name']), 'd': text(full)})
            sfeat.sort(key=lambda x: x['lv'])
            subs.append({'id': s['index'], 'n': s['name'], 'flavor': s.get('subclass_flavor', ''),
                         'd': text(s) or s.get('summary', ''), 'f': sfeat})
        sub_level = min((f['lv'] for s in subs for f in s['f']), default=3)
        if v == '2024':
            sub_level = 3
        classes.append({
            'id': cid, 'n': c['name'], 'hd': c['hit_die'],
            'saves': [s['index'] for s in c.get('saving_throws', [])],
            'primary': primary, 'caster': caster,
            'spellAbility': ((c.get('spellcasting') or {}).get('spellcasting_ability') or {}).get('index', ''),
            'skills': skill_choice, 'armor': armor, 'weapons': weapons, 'tools': tools,
            'equip': [{'i': x['equipment']['index'], 'q': x.get('quantity', 1)} for x in c.get('starting_equipment', [])],
            'equipOptions': conv_equipment_options(c.get('starting_equipment_options')),
            'asi': sorted(set(asi_levels)), 'subLevel': sub_level, 'levels': out_levels, 'subclasses': subs,
        })

    # ---------- races / species ----------
    def trait_out(ref):
        t = traits.get(ref['index'], {})
        return {'n': t.get('name', ref['name']), 'd': text(t), 'lv': ref.get('level', 1)}

    def trait_skills(refs):
        out = []
        for ref in refs:
            for p in traits.get(ref['index'], {}).get('proficiencies', []) or []:
                if p['index'].startswith('skill-'):
                    out.append(skill_key(p['index']))
        return out

    races = []
    if v == '2014':
        subraces = {s['index']: s for s in load(v, 'Subraces')}
        for r in load(v, 'Races'):
            asi = [[b['ability_score']['index'], b['bonus']] for b in r.get('ability_bonuses', [])]
            asi_opt = None
            if r.get('ability_bonus_options'):
                o = r['ability_bonus_options']
                asi_opt = {'choose': o.get('choose', 2), 'from': [x['ability_score']['index'] for x in option_list(o)],
                           'bonus': (option_list(o) or [{}])[0].get('bonus', 1)}
            subs = []
            for ref in r.get('subraces', []):
                s = subraces.get(ref['index'])
                if s:
                    subs.append({'id': s['index'], 'n': s['name'],
                                 'asi': [[b['ability_score']['index'], b['bonus']] for b in s.get('ability_bonuses', [])],
                                 'traits': [trait_out(t) for t in s.get('racial_traits', [])],
                                 'skills': trait_skills(s.get('racial_traits', []))})
            races.append({'id': r['index'], 'n': r['name'], 'speed': r.get('speed', 30), 'size': r.get('size', 'Medium'),
                          'asi': asi, 'asiOptions': asi_opt, 'languages': [l['name'] for l in r.get('languages', [])],
                          'traits': [trait_out(t) for t in r.get('traits', [])], 'skills': trait_skills(r.get('traits', [])),
                          'subs': subs})
    else:
        subspecies = {s['index']: s for s in load(v, 'Subspecies')}
        for r in load(v, 'Species'):
            subs = []
            for ref in r.get('subspecies', []) or []:
                s = subspecies.get(ref['index'])
                if s:
                    subs.append({'id': s['index'], 'n': s['name'], 'asi': [], 'traits': [trait_out(t) for t in s.get('traits', [])], 'skills': []})
            races.append({'id': r['index'], 'n': r['name'], 'speed': r.get('speed', 30), 'size': r.get('size', 'Medium'),
                          'asi': [], 'asiOptions': None, 'languages': ['Common'],
                          'traits': [trait_out(t) for t in r.get('traits', [])], 'skills': [], 'subs': subs})

    # ---------- backgrounds ----------
    backgrounds = []
    feats_by_index = {f['index']: f for f in feats_raw}
    for b in load(v, 'Backgrounds'):
        profs = b.get('starting_proficiencies') or b.get('proficiencies') or []
        armor, weapons, tools = split_profs(profs)
        out = {'id': b['index'], 'n': b['name'],
               'skills': [skill_key(p['index']) for p in profs if p['index'].startswith('skill-')],
               'tools': tools,
               'equip': [{'i': x['equipment']['index'], 'q': x.get('quantity', 1)} for x in b.get('starting_equipment', [])],
               'equipOptions': conv_equipment_options(b.get('starting_equipment_options') or b.get('equipment_options')),
               'gold': (b.get('starting_gold') or {}).get('quantity', 0)}
        lo = b.get('language_options')
        if lo:
            out['languageChoices'] = lo.get('choose', 0)
        if b.get('feature'):
            out['feature'] = {'n': b['feature']['name'], 'd': text(b['feature'])}
        if b.get('ability_scores'):
            out['asi'] = [a['index'] for a in b['ability_scores']]
        if b.get('feat'):
            f = feats_by_index.get(b['feat']['index'], {})
            out['feat'] = {'n': b['feat']['name'] + (f" ({b['feat']['note']})" if b['feat'].get('note') else ''), 'd': text(f)}
        backgrounds.append(out)

    feats = [{'n': f['name'], 'type': f.get('type', 'general'), 'd': text(f)} for f in feats_raw]

    # ---------- spells ----------
    spells = []
    for s in load(v, 'Spells'):
        comps = ', '.join(s.get('components', []))
        if s.get('material'):
            comps += f" ({s['material'].rstrip('.')})"
        hl = s.get('higher_level', '')
        if isinstance(hl, list):
            hl = '\n'.join(hl)
        spells.append({'n': s['name'], 'l': s.get('level', 0), 's': (s.get('school') or {}).get('name', ''),
                       't': s.get('casting_time', ''), 'r': s.get('range', ''), 'c': comps, 'd': s.get('duration', ''),
                       'cc': bool(s.get('concentration')), 'rt': bool(s.get('ritual')),
                       'cls': [x['index'] for x in s.get('classes', [])], 'x': text(s), 'hl': re.sub(r'\*\*(.+?)\*\*', r'\1', hl or '')})
    spells.sort(key=lambda x: (x['l'], x['n']))

    conditions = [{'n': c['name'], 'd': text(c)} for c in load(v, 'Conditions')]

    return {
        'meta': {'ruleset': v, 'label': '2014 rules (SRD 5.1)' if v == '2014' else '2024 rules (SRD 5.2)',
                 'credit': CREDITS[v], 'dataCredit': DATA_CREDIT},
        'classes': classes, 'races': races, 'backgrounds': backgrounds, 'feats': feats,
        'spells': spells, 'equipment': equipment, 'categories': cats, 'conditions': conditions,
    }


OUT.mkdir(parents=True, exist_ok=True)
for v in ('2014', '2024'):
    data = build(v)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    header = (f'/*\n * Quillsheet rules content: {data["meta"]["label"]}.\n * {CREDITS[v]}\n * {DATA_CREDIT}\n */\n')
    js = header + "'use strict';\nwindow.QS_SRD = window.QS_SRD || {};\nwindow.QS_SRD['" + v + "'] = " + body + ';\n'
    path = OUT / f'srd-{v}.js'
    path.write_text(js, encoding='utf-8')
    print(f'{path.name}: {len(js.encode("utf-8")):,} bytes | classes {len(data["classes"])}, races {len(data["races"])}, '
          f'backgrounds {len(data["backgrounds"])}, feats {len(data["feats"])}, spells {len(data["spells"])}, '
          f'equipment {len(data["equipment"])}, conditions {len(data["conditions"])}')
    for c in data['classes']:
        print('   ', c['id'], c['caster'], 'hd', c['hd'], 'primary', c['primary'], 'asi', c['asi'], 'subLv', c['subLevel'],
              'skills', (c['skills'] or {}).get('choose'), 'subs', [s['n'] + f"({len(s['f'])})" for s in c['subclasses']],
              'equipOpts', len(c['equipOptions']), 'lv1 feats', [f['n'] for f in c['levels'].get(1, {}).get('f', [])])
