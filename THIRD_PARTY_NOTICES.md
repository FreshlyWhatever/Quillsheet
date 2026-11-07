# Third-party notices

Quillsheet's own code is original. The rules content in `js/srd/` and the font in `fonts/` come from the sources below.

## OpenDyslexic (`fonts/`)

Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es), with Reserved Font Name OpenDyslexic. Licensed under the SIL Open Font License, Version 1.1; the full licence is in `fonts/OFL.txt`. The Regular and Bold files are unmodified copies from https://github.com/antijingoist/opendyslexic.

## System Reference Document 5.1 (`js/srd/srd-2014.js`)

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## System Reference Document 5.2 (`js/srd/srd-2024.js`)

This work includes material taken from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

**Changes made:** the SRD material was reformatted into a compact JSON structure, and fields the app doesn't use (monsters, magic items, rules glossary, prices of most items, etc.) were left out. Rules text is otherwise unchanged.

## 5e SRD API database (data structure)

The SRD content was obtained in structured form from the 5e-bits "5e SRD API" project, https://github.com/5e-bits/5e-srd-api (`packages/5e-database`), and converted with `tools/build_srd.py`.

```
MIT License

Copyright (c) [2018-2020] [Adrian Padua, Christopher Ward]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
