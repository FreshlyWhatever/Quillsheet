# Quillsheet: D&D 5e Character Sheets

Quillsheet is a private, responsive character sheet for Dungeons & Dragons 5th Edition. **Quick Build** makes a finished, playable character at any level in about a minute, using the free SRD rules for 2014 or 2024. You can also paste homebrew straight onto your sheet, and a "living sheet" timeline tracks your character as it levels up.

- No accounts, server, tracking or build step.
- **Zero dependencies**: plain HTML, CSS and JavaScript (ES2020).
- Works on desktop, tablet and phone.

---

## 1. Running it

Quillsheet is a folder of static files.

| Option | How |
|---|---|
| **Local web server (recommended)** | From this folder run `python -m http.server 8000 --bind 127.0.0.1` and open <http://localhost:8000>. Any static server works (`npx serve`, VS Code Live Server, …). |
| **Open the file directly** | Double-click `index.html`. This should work in Chrome, Edge and Firefox. Some browsers apply stricter rules to `file://` pages, though, so if the page looks unstyled, buttons do nothing, or Quick Build can't load its rules content, use a local server instead (tested setup). |
| **Host it** | Upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3). No server configuration is needed. Serve it over HTTPS. |

Browser support: current Chrome, Edge, Firefox and Safari (desktop and mobile). The app uses `<dialog>`, `crypto.subtle`, CSS `color-mix()` and `localStorage`.

---

## 2. Features

### Start screen
Four large buttons, repeated in the sidebar: **⚡ Quick Build**, **📥 Import Homebrew** (to your homebrew library), **✏️ Fully custom** (a blank sheet), and **📂 Open saved file**.

### Homebrew library (homebrew in Quick Build)
Imported **classes, subclasses, races/species and backgrounds** can be saved to a per-device library (`localStorage` key `quillsheet.homebrew.v1`, module `js/homebrew.js`), and Quick Build then offers them next to the SRD options, labelled "— homebrew".
- **Ways in:** **Import Homebrew** on the start screen or sidebar, or **+ Add homebrew** inside Quick Build, which reopens Quick Build afterwards with every choice kept.
- **What gets saved:** JSON subclasses keep each feature at its own level. Classes keep hit die, saves, skill choices, armor/weapon proficiencies, caster type (spell slots follow the chosen ruleset) and features by level. Races keep speed, ability bonuses and traits.
- **Pasted text:** offers "Save to library as a subclass / race / background". A subclass asks which class it belongs to and at what level.
- **In Quick Build:** homebrew subclass features up to the starting level go on the sheet, and later ones go to **Coming up** for the level-up wizard.
- **Custom… entries:** the subclass, race and background lists each have a **Custom… (type a name)** entry for anything not in the SRD or your library. It sets just the name; add features later.
- **Managing:** **Homebrew library** (sidebar footer, or **Manage** in Quick Build) lists and removes entries. Characters already made keep their features.
- **Import from a character:** when you import from a character's own header, the library option is offered too, after the usual "add to this character" choices.

### Quick Build (players in a rush)
**⚡ Quick Build** (sidebar or start screen) opens a single pre-filled form. Press **Create character** straight away, or change anything first:

| Step | What happens |
|---|---|
| **Rules** | 2024 rules (SRD 5.2) or 2014 rules (SRD 5.1). The choice is remembered, and each sheet stores its ruleset (shown as **Rules** on the Overview tab). |
| **Class, subclass, starting level 1–20** | All 12 SRD classes with their SRD subclass. A hint shows the level the subclass arrives at (3 in 2024; 1–3 in 2014). |
| **Race/species, subrace/lineage, background** | Defaults suit the class (e.g. Rock Gnome Wizard in 2014, Sage Wizard in 2024). |
| **Ability scores** | Standard array, point buy (27 points, with a running total), roll 4d6-drop-lowest, or manual. Scores start in the best spots for the class, and picking a value swaps it with whichever ability had it. Race bonuses (2014), background bonuses (2024: +2/+1), and the ASIs for every level up to the starting level are applied and listed. |
| **Skills** | Class skill picks with sensible defaults. Skills already given by race or background are shown and excluded. |
| **Equipment** | Each starting-gear option as a choice, with a picker for "any martial weapon"-style entries. |

**The finished sheet has:** abilities, saves, skills (with Rogue/Bard expertise and Jack of All Trades), HP (max at level 1, then the average), AC from the best armor and shield (or Barbarian/Monk Unarmored Defense), and attacks with correct bonuses and proficiency. It also has inventory and gold, proficiencies and languages, every class/subclass/race/background feature and origin feat up to the starting level, and a starter spell list. Spells use a favourites list (e.g. Shield, Fireball, Healing Word), are spread across the levels you can cast, sized to your known/prepared count, and marked prepared.

Higher-level class and subclass features go into **Coming up**, so the level-up wizard offers them at the right level. A preview bar at the bottom shows HP, AC, attacks, spells and feature counts as you change things.

### Play tab (session mode)
A one-screen view for the table, first in the tab list:
- **Hit points:** a big HP display with an amount box (−1 / +1 / +5 / +10 chips) and large **Damage**, **Heal** and **Temp HP** buttons. Temp HP absorbs damage first, and new temp HP replaces the old only if it's higher.
- **Death saves:** when HP hits 0, the card turns red and shows the save boxes.
- **Quick stats:** AC, initiative, speed, proficiency, passive Perception, spell DC and spell attack.
- **Resources:** a tracker for each limited-use ability, such as Rage, Focus Points or Superiority Dice. Small counts are tappable pips, and big pools like Lay on Hands use −5 / −1 / +1 / +5 buttons. Rests refill them according to each tracker's rule.
- **Conditions:** tap to toggle the 14 SRD conditions, plus an exhaustion stepper (0–6). **What do these do?** shows the rules text for the character's ruleset, with active conditions first.
- **Concentration:** pick the spell you're concentrating on. Taking damage shows the CON save DC (10 or half the damage). Dropping to 0 HP or taking a long rest ends concentration.
- **Spell slots:** tappable pips.
- **Action / Bonus action / Reaction:** attacks, prepared spells, cantrips and features sorted by when you can use them, each expandable for full text. Spells use their casting time. Features are sorted by reading their text; if one lands in the wrong group, set **Group on the Play tab** on the Features tab. Slow spells go under **Longer to cast**, and everything else under **Always-on features**.
- **Saves & skills:** a folded list of every bonus.
- **Rests:** hit dice, Short rest and Long rest (a long rest also lowers exhaustion by 1).

**Optional digital helpers** (switches at the top of the tab, remembered per device, **off by default** because most players roll real dice):
- **Roll dice for me:** tapping an attack rolls to-hit and damage (a natural 20 doubles the dice). Bonuses for skills, saves, ability checks, initiative and spell attacks become tap-to-roll buttons (dotted underline) here and on the Stats tab. Adds a death-save roll, a d4–d100 dice tray, and hit dice that roll their own healing. When off, hit dice just mark one as spent and remind you what to roll.
- **Cast buttons use up slots:** each prepared spell gets **Cast**, which uses the lowest free slot of its level or higher (then pact slots) and starts concentration when needed. When off, you tap the slot pips yourself.

### Resource trackers
Class trackers appear by themselves and follow the character's class level, scores and ruleset (2014 and 2024 differ). Manage them under **Features → Resource trackers**:
- **Add your own** for homebrew or magic items: name, uses and what refills them.
- **Editing a class tracker** makes it yours, so it stops following your level.
- **Removing one** keeps it removed until you press **Bring back class trackers**.
- Refill rules: short or long rest, one back on a short rest and all on a long rest, long rest only, or no refill.

### Automatic AC
**Work out AC automatically** (Stats tab) calculates AC from equipped gear: the best armor, or unarmored (10 + DEX, or Barbarian/Monk Unarmored Defense), plus a shield, other AC items and an **Other AC bonus** box. It updates as you change scores or equipment, and shows how it got the number. It's on for new characters. Characters made before this feature, and those made from a statblock, keep their typed number until you tick the box.

Standard armor is recognised by name, including "+1 Chain Mail". For homebrew, open the item on the Gear tab and set **Armor type** and **AC it gives**. Imported JSON armor is set up for you.

### Display settings
**Aa** in the top bar sets text size (Normal, Large, Larger, Largest) and **Easy-read text**, which uses the bundled OpenDyslexic font with taller lines and removes capitals-only labels and italics. The font only downloads for people who turn this on, and is part of the offline copy.

### Offline use
After one visit over HTTPS (or localhost), a service worker (`sw.js`) keeps a copy of the site on the device, including both rules bundles, so it opens with no internet. When online it fetches the latest files, falling back to the saved copy if there's no answer within 2.5 seconds. `manifest.webmanifest` lets browsers offer to install it to the home screen. Opening `index.html` directly from disk doesn't get this.

If you add a file to the site, add it to `FILES` in `sw.js`, and change `CACHE` if you remove one.

### Phone navigation
Under 760px wide, the top tabs are replaced by a **bottom tab bar** in thumb reach: **Play · Stats · Spells · Gear · More**. **More** opens Features, Notes and Progression, and while one of those is open, the More button takes its name and icon. Switching sections scrolls to the top of that section. The bar sits above the phone's home indicator (safe-area aware). Toasts and page padding move up to clear it, and printing hides it.

### Character sheet
- **Abilities, saves and skills** with modifiers that update as you type. Skills cycle through none / proficient / expertise, and Jack of All Trades is supported.
- **Combat**: automatic or typed AC, initiative, speed, HP with a damage/heal box (temp HP absorbs damage first), hit dice you can spend (rolls die + CON), death saves, inspiration, and short and long rests.
- **Attacks** table.
- **Spells**: spellcasting ability, save DC, attack bonus and **spell slots calculated automatically** from your classes, using the multiclass caster table for full, half, third, Artificer and Pact Magic casters. Each slot is a tappable pip. Spells are grouped by level and can be marked prepared and filtered.
- **Inventory**: coins, items, equipped flag and carried weight against carrying capacity.
- **Features & traits**, grouped by Class / Race / Background / Feat / Statblock / Other.
- **Notes**: personality, ideals, bonds, flaws, appearance, backstory and campaign notes.

### Living sheet (progression)
- **XP tracker** with a progress bar and a "Level up ready!" badge once you pass the next threshold. Milestone play is supported: just use Level up.
- **Level-up wizard**: choose to advance an existing class or multiclass (SRD classes or custom/homebrew). For HP you can take the average, roll, or enter a value. It applies Ability Score Improvements (+2, +1/+1, or a feat) at the correct levels, including Fighter 6/14 and Rogue 10. You can also set a subclass and list new features.
- **Timeline** of level-ups, XP awards, imports, checkpoints and journal notes.
- **Restore points**: every level-up, import and manual checkpoint stores a snapshot, and **"Restore to before this"** rolls the sheet back. The version you replace becomes a new checkpoint, so a restore can itself be undone. The 15 most recent snapshots are kept per character.

### Import Homebrew
Open **Import Homebrew** from the sheet header (or from the Spells, Inventory or Features tabs) and paste. The importer reads the community JSON format used by 5etools and plain copied text. By design, the app's interface never names external sites: only the privacy policy mentions them, together with the passion-project note and the non-affiliation disclaimer. The README isn't linked from inside the app.

| You paste | Recognised as | Can be added as |
|---|---|---|
| Copied **spell** text (anything with "Casting Time") | Spell | Spell, feature or note |
| Copied text with **several headed features**: "Level 1: Martial Arts" lines, or short headings followed by a page source like "PHB'24 p101" | One entry with every feature split out (a title line such as "Monk" or a subclass name becomes the entry's name) | Separate features, a class (each feature at its level, higher ones go to "Coming up"), one combined feature, a note, or the homebrew library as a subclass (each feature at its level) or race |
| Several **spells** copied at once (each with its own heading and "Casting Time") | One spell per heading | Spell, feature or note |
| Copied **statblock** text (2014 or 2024 layout) | Statblock | New character, or apply stats to the current one |
| 5etools **JSON** for a spell, item, feat, optional feature, class/subclass feature, race/species, background or monster | Matching type | Typed destination (weapons can create an attack with bonuses calculated) |
| A 5etools **data or homebrew file** (`{"spell":[…], "item":[…]}`) | Every entry inside | Per entry |
| A **subclass** entry (optionally with its `subclassFeature` entries) | Subclass | Set as subclass + add features, or one feature, or a note |
| A **class file** (`{"class":[…], "classFeature":[…], "subclass":[…], "subclassFeature":[…]}`) | One Class entry plus one entry per subclass, with features grouped under them | Class: add features up to your level. Subclass: as above. |
| A Quillsheet export or backup | Character sheet | New character |
| Anything else | Text | Feature, item, spell or note (you choose) |

**Classes and subclasses.** Features in the same paste are grouped under their class or subclass, so a whole class file appears as a few choices instead of dozens of loose features. When a paste has several subclasses, only one already set on the character is pre-ticked, so you pick the one you're taking. Importing:
- sets the class's **Subclass** field;
- adds every feature at or below the character's current level in that class (skipping duplicates);
- saves higher-level features in **Coming up** (Progression tab). The **level-up wizard** then offers each one, pre-ticked, when the class reaches that level, and fills in the subclass if it's still blank.

If the character doesn't have the class, a dialog asks which class to attach it to, or offers **Keep for later**, so the features appear once you multiclass into it.

Every entry is **previewed first**. You can untick entries and change where each one goes before anything touches your sheet, and the whole import can be undone from the timeline.

5etools markup such as `{@spell fireball|phb}`, `{@damage 2d6}`, `{@dc 15}` or `{@atk mw}` is converted to plain text. Nested entries, lists and tables are flattened into readable text.

**Clear error messages.** Formatting problems are explained in plain language with a fix:

| Problem | What the user sees |
|---|---|
| Broken JSON | The line and column of the error, plus a specific hint: cut-off paste (brackets don't balance), trailing comma, or single quotes |
| Valid JSON with nothing usable | "No recognisable D&D content found" and what fields are expected |
| Entries that can't be classified, lack a name, or are 5etools `_copy` references | Listed as warnings, and the rest still imports |
| Encrypted file pasted as text | Directs the user to "Open file…" |
| Empty or oversized paste (> 2 MB) | Explains what to do instead |
| Opened character files with bad values | Imports anyway, replacing bad values with defaults and listing each fix |

### Saving & files
- **Autosave** to the browser's `localStorage` (debounced, plus a flush when the tab is hidden or closed). The top bar shows whether the sheet is saved.
- **Export** as `.json`, as an **encrypted** `.json` (AES-256-GCM, passphrase-derived key), copy to the clipboard, **print / PDF** (all sections), or **back up every character** in one file.
- **Open** files with "Open file…" or by dragging them onto the page. Duplicates prompt you to replace or keep both.
- Storage problems (private mode, full quota, damaged data) are reported. Damaged data is preserved under a `.corrupt` key rather than overwritten.

### Accessibility & responsiveness
- Labelled controls, keyboard-navigable tabs (arrow keys, Home and End), focus outlines, live regions for toasts and the import preview, `prefers-reduced-motion` support, and light/dark themes that follow the system with a manual toggle.
- At ≤ 860 px the character list becomes a slide-out drawer. At ≤ 560 px grids collapse to one column, dialogs go full-screen and touch targets get larger.

---

## 3. Code structure

```
dnd-character-sheet/
├── index.html        App shell: top bar, roster sidebar, <main>, <dialog>, toasts, script tags
├── privacy.html      Privacy policy (static, no JS), including the SRD credits
├── sw.js             Service worker: offline copy of the site's own files
├── manifest.webmanifest, icon.svg  Install-to-home-screen details
├── README.md         This document
├── THIRD_PARTY_NOTICES.md  SRD CC-BY-4.0 attribution and the 5e-bits MIT licence
├── fonts/            OpenDyslexic Regular and Bold (easy-read mode) with their licence, OFL.txt
├── css/
│   └── styles.css    Design tokens (light/dark), layout, components, responsive and print rules
├── js/
│   ├── data.js       Rules      – 5e reference data and pure calculations (ruleset-aware spell slots)
│   ├── storage.js    Schema     – data model, defaults, normalisation of untrusted input
│   │                 Store      – localStorage persistence
│   │                 Vault      – passphrase encryption (Web Crypto)
│   ├── importer.js   Importer   – homebrew text/JSON parser → reviewable "entities"
│   ├── quickbuild.js QuickBuild – choices + SRD bundle → complete sheet (pure, no DOM)
│   ├── homebrew.js   Homebrew   – homebrew library: storage, importer-entity conversion, merge into SRD data
│   ├── app.js        UI, state, event handling, Quick Build and level-up wizards, import/export flows
│   └── srd/
│       ├── srd-2014.js  SRD 5.1 content (~490 KB), loaded only when Quick Build needs it
│       └── srd-2024.js  SRD 5.2 content (~500 KB), loaded only when Quick Build needs it
└── tools/
    └── build_srd.py  Regenerates js/srd/*.js from the 5e-bits JSON (developer tool, not shipped logic)
```

Scripts load in dependency order (`data → storage → importer → quickbuild → homebrew → app`). The SRD bundles are added as `<script>` tags on first use, which the `script-src 'self'` CSP allows. Each module is an IIFE that exposes one global object, so no bundler is needed.

### `js/data.js` (`Rules`)
Pure functions with no state and no DOM access.

| Export | Purpose |
|---|---|
| `ABILITIES`, `SKILLS`, `CLASSES`, `XP_THRESHOLDS`, `CASTER_TYPES`, `HIT_DICE`, `CURRENCIES` | Reference data |
| `mod(score)`, `fmtMod(n)`, `profBonus(level)`, `levelForXp(xp)` | Core math |
| `totalLevel(sheet)`, `classSummary(sheet)`, `classInfo(name)`, `isAsiLevel(class, level)` | Class helpers |
| `spellSlots(classes)` | `{ slots: [9], pact: {count, level} \| null }` following the PHB multiclass rules (a single half or third caster rounds up, multiclassing rounds down, Artificer always rounds up) |
| `skillBonus`, `saveBonus`, `hitDicePools`, `inventoryWeight` | Derived sheet values |
| `armorOf(item)`, `armorClass(sheet)` | What an item does for AC, and `{ total, parts }` from equipped gear and class |
| `classResources(sheet)` | Class trackers at the current levels: `[{ key, name, max, recharge }]` |
| `spellTiming(castingTime)`, `featureTiming(feature)` | Which Play tab group something belongs in |

### `js/storage.js`
- **`Schema.blank()`** returns a new sheet. **`Schema.normalize(obj)`** walks a template and coerces every field to the right type. It drops unknown keys, clamps ability scores to 1–30 and returns `{ sheet, warnings }`. **All** external data (imports, opened files and even `localStorage`) goes through it, so the UI can trust the shape of the data.
- **`Store.load()` / `Store.save()`** read and write the key `quillsheet.sheets.v1` (`{version, savedAt, sheets: {id: sheet}}`). Preferences live in `quillsheet.prefs.v1`.
- **`Vault.encrypt(text, pass)` / `Vault.decrypt(box, pass)`** use PBKDF2-SHA-256 (250k iterations, 16-byte salt) and AES-256-GCM (12-byte IV).

### `js/importer.js` (`Importer`)
`Importer.parse(input)` returns `{ entities, errors, warnings }` and never touches the sheet.

1. Empty or oversized input is rejected with an error.
2. Input starting with `{` or `[` is parsed as JSON. On failure, `jsonError()` reports the line/column and diagnoses the likely cause.
3. JSON is classified by `detectType()` from the fields it contains (e.g. `level` + `school` → spell, six ability scores → monster). Collection files are flattened using known 5etools keys.
4. Plain text is first split at headings (`splitSections`). Two or more headings give a feature group, or one spell per heading when each has a "Casting Time". Otherwise the text is classified as a spell (has "Casting Time") or a statblock (has six ability scores in either statblock layout), with a generic text entity as the fallback.
5. `groupClassContent()` attaches `classFeature` / `subclassFeature` entries to the `class` / `subclass` entries from the same paste (matching `className` and `subclassShortName`), and reports `classCount` / `subclassCount`.
6. Each mapper (`mapSpell`, `mapItem`, `mapRace`, `mapSubclass`, …) converts the data to Quillsheet's shapes. Each entity lists its allowed **actions**, and the app executes the one the user picks.

### `js/app.js`
- **State:** `state.sheets`, `state.activeId` and `state.tab`. The sheet object is edited in place.
- **Two-way binding:** inputs carry `data-bind="combat.hpMax"` (plus `data-num`, `data-rerender`, `data-roster` and `data-mirror` modifiers). One delegated `input`/`change` listener writes the value with `setPath()` and calls `commit()`.
- **Derived values:** elements with `data-derived="mod.str"` are refreshed by `renderDerived()` from `derive(sheet)`. This avoids re-rendering inputs, so focus and cursor position are kept while typing.
- **Actions:** buttons carry `data-action="long-rest"`, dispatched by one delegated click listener to the `actions` map.
- **Rendering:** `h(tag, props, ...children)` builds DOM nodes. User text is inserted only through `textContent` / `.value`, never `innerHTML`, which rules out HTML injection from imported content.
- **History:** `logHistory(sheet, type, summary, snapshot)` stores entries. Snapshots are deep copies without the history itself, capped at 15 per sheet (200 entries in total).

### Data model (version 1)

```jsonc
{
  "schemaVersion": 1, "id": "uuid", "createdAt": "ISO", "updatedAt": "ISO",
  "ruleset": "",                                       // "" custom, "2014" SRD 5.1, "2024" SRD 5.2
  "name": "", "player": "", "race": "", "background": "", "alignment": "", "xp": 0, "inspiration": false,
  "classes": [{ "name": "Fighter", "subclass": "", "level": 1, "hitDie": 10, "caster": "none|full|half|third|artificer|pact" }],
  "abilities": { "str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10 },
  "saveProf": { "str": false, "...": false },
  "skills": { "acrobatics": 0, "...": 0 },            // 0 none, 1 proficient, 2 expertise
  "jackOfAllTrades": false,
  "combat": { "ac": 10, "acAuto": false, "acBonus": 0, "initBonus": 0, "speed": 30, "hpMax": 0, "hpCurrent": 0, "hpTemp": 0,
              "hitDiceUsed": { "10": 0 }, "deathSaves": { "success": [false,false,false], "fail": [false,false,false] },
              "conditions": ["Poisoned"], "exhaustion": 0, "concentration": "Bless" },   // Play tab session state
  "attacks": [{ "name": "", "bonus": "", "damage": "", "notes": "" }],
  "spellcasting": { "ability": "int", "slotsUsed": [0,0,0,0,0,0,0,0,0], "pactUsed": 0,
                    "spells": [{ "name": "", "level": 0, "school": "", "castingTime": "", "range": "", "components": "",
                                 "duration": "", "concentration": false, "ritual": false, "prepared": false,
                                 "description": "", "source": "" }] },
  "inventory": [{ "name": "", "qty": 1, "weight": 0, "equipped": false, "notes": "", "source": "",
                  "armor": "", "acValue": 0 }],                  // armor: "" from name/notes, none, light, medium, heavy, shield, bonus
  "currency": { "cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0 },
  "features": [{ "name": "", "origin": "Class|Race|Background|Feat|Statblock|Other", "source": "", "description": "",
                 "timing": "" }],                                // "" from the text, action, bonus, reaction, passive
  "pendingFeatures": [{ "className": "Fighter", "subclass": "Champion", "level": 7, "name": "", "description": "", "source": "" }], // imported, not yet reached
  "resources": [{ "key": "monk:Focus Points", "name": "", "max": 1, "used": 0, "recharge": "short|short1|long|none" }], // key blank = player-managed
  "hiddenResources": ["monk:Focus Points"],                     // class trackers removed or taken over
  "proficiencies": { "armor": "", "weapons": "", "tools": "", "languages": "" },
  "notes": { "appearance": "", "personality": "", "ideals": "", "bonds": "", "flaws": "", "backstory": "", "general": "" },
  "history": [{ "id": "", "date": "ISO", "type": "created|level-up|xp|import|checkpoint|restore|note", "summary": "", "snapshot": { } }]
}
```

File formats:
- Single export: `{ "format": "quillsheet", "version": 1, "exportedAt": "…", "sheet": { … } }`
- Backup: `{ "format": "quillsheet-backup", "version": 1, "sheets": [ … ] }`
- Encrypted: `{ "format": "quillsheet-encrypted", "cipher": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iterations": 250000, "salt", "iv", "data" }` (base64 fields)

To evolve the schema, bump `Schema.VERSION`, add fields to `blank()` (old files pick up the defaults automatically through `normalize`), and add explicit migration steps in `normalize()` for renamed or removed fields.

---

## 4. Libraries and APIs

**Third-party libraries: none.** All functionality uses built-in browser APIs:

| API | Used for |
|---|---|
| DOM, `<dialog>`, `<details>` | UI, modals, collapsible rows |
| Web Storage (`localStorage`) | Autosave and preferences |
| Web Crypto (`crypto.subtle`: PBKDF2, AES-GCM; `getRandomValues`; `randomUUID`) | Encrypted export and IDs |
| File API (`File.text()`, `Blob`, `URL.createObjectURL`) | Opening and downloading files |
| Drag and Drop | Dropping files onto the page or the import box |
| Clipboard API (`navigator.clipboard.writeText`) | "Copy as JSON" |
| `window.print()` + `@media print` | Print / PDF |
| `matchMedia('(prefers-color-scheme)')` | Theme |
| Service Worker, Cache Storage, Web App Manifest | Offline copy and install to home screen |

**Font:** OpenDyslexic by Abbie Gonzalez (SIL Open Font License 1.1), bundled in `fonts/` for easy-read mode.

**Rules content:** the SRD 5.1 and 5.2 (CC-BY-4.0, Wizards of the Coast), in structured form from the 5e-bits 5e SRD API database (MIT). See `THIRD_PARTY_NOTICES.md`. It's bundled as static files, so it isn't fetched from any API at runtime.

**Regenerating the SRD bundles:** download `packages/5e-database/src/{2014,2024}/en/5e-SRD-*.json` from github.com/5e-bits/5e-srd-api into `<folder>/2014` and `<folder>/2024`, then run `python -I tools/build_srd.py <folder> js/srd`. The script prints a summary per class so you can spot-check the output.

**External services: none.** 5etools is *not* called. Users copy content from it themselves, so there is no scraping, no CORS issue and nothing that breaks if the site changes its internals. A Content Security Policy (`connect-src 'none'`) enforces this.

---

## 5. Security & privacy notes
- All imported text is treated as data. It is rendered with `textContent` and never evaluated.
- A strict CSP blocks inline scripts, `eval`, remote scripts and all network connections from the page. The service worker only fetches the site's own files and never sees character data.
- Input size limits: pasted import 2 MB, opened files 5 MB.
- See [privacy.html](privacy.html) for the user-facing policy.

## 6. Ideas for later
- Optional, opt-in sync (for example to a file in the user's own cloud drive) that keeps the privacy model intact.
- A bundled SRD dataset so content can be searched without copying.

*Quillsheet is unofficial fan content and is not affiliated with Wizards of the Coast or 5etools. Dungeons & Dragons is a trademark of Wizards of the Coast.*
