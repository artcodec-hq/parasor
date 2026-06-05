# Third-Party Notices

This product bundles the following third-party assets or copied code snippets.
Each is used under the terms of its respective license as described below.

---

## Symbols Nerd Font

- **File**: `packages/web/src/assets/fonts/SymbolsNerdFontMono-Regular.woff2`
- **Version**: Nerd Fonts v3.2.1 (`patched-fonts/NerdFontsSymbolsOnly`)
- **Source**: <https://github.com/ryanoasis/nerd-fonts>
- **License**: MIT License -- Copyright (c) 2014 Ryan L McIntyre
- **License file**: `packages/web/src/assets/fonts/LICENSE-SymbolsNerdFont.txt`

Symbols Nerd Font is a compilation of glyph sets from multiple upstream icon
font projects. The glyphs included are aggregated and redistributed by the
Nerd Fonts project under the MIT license. Notable upstream sources include:

| Source | Original license |
| --- | --- |
| [Powerline Symbols](https://github.com/powerline/powerline) | MIT |
| [Font Awesome](https://github.com/FortAwesome/Font-Awesome) | OFL-1.1 / MIT |
| [Devicons](https://github.com/vorillaz/devicons) | MIT |
| [Octicons](https://github.com/primer/octicons) | MIT |
| [Codicons](https://github.com/microsoft/vscode-codicons) | CC-BY-4.0 |
| [Font Logos](https://github.com/Lukas-W/font-logos) | MIT |
| [Material Design Icons](https://github.com/Templarian/MaterialDesign) | Apache-2.0 |
| [Weather Icons](https://github.com/erikflowers/weather-icons) | OFL-1.1 |
| [Pomicons](https://github.com/gabrielelana/pomicons) | MIT |
| [Seti-UI + Custom](https://github.com/jesseweed/seti-ui) | MIT |
| [IEC Power Symbols](https://unicodepowersymbol.com/) | OFL-1.1 |

All upstream licenses permit redistribution as part of a bundled application
when the applicable copyright notices and license terms are preserved. The
MIT license text that governs the `NerdFontsSymbolsOnly` package is included
in full alongside the font file.

---

## Vendored color themes

- **Files**:
  - `packages/web/src/vendor/themes/tokyo-night.json`
  - `packages/web/src/vendor/themes/solarized-light.json`
  - `packages/web/src/vendor/themes/monokai.json`
- **Sources**:
  - Tokyo Night: <https://github.com/tokyo-night/tokyo-night-vscode-theme>
  - Microsoft VS Code built-in themes: <https://github.com/microsoft/vscode>
- **License**: MIT
- **License file**: `packages/web/src/vendor/themes/LICENSE`

The vendored theme JSON files are distributed under the MIT License. The
aggregated upstream notices are kept in
`packages/web/src/vendor/themes/LICENSE`.

---

## Symbols (FileTree icons)

- **Package**: `@react-symbols/icons`
- **Source**: <https://github.com/pheralb/react-symbols>
- **License**: MIT -- Copyright (c) pheralb
- **Origin**: React port of the [Symbols VSCode icon theme](https://marketplace.visualstudio.com/items?itemName=miguelsolorio.symbols) by Miguel Solorio (MIT). Used for file-type and folder icons in the FileTree pane.

The package ships individually-importable React SVG components, so parasor
only bundles the subset of icons it actually references in
`packages/web/src/lib/file-icons.tsx`.

---

## Lucide icons

- **Source**: <https://github.com/lucide-icons/lucide>
- **License**: ISC -- Copyright (c) 2026 Lucide Icons and Contributors
- **Origin files**:
  - `packages/web/src/components/primitives/PaGlyph.tsx`
  - `packages/web/src/components/mobile/MobileKeyBar.tsx`

The icon paths in the listed files are adapted from individual Lucide SVG
files. Lucide is a community-maintained fork of Feather Icons; some glyphs
trace back to Feather (MIT, Copyright (c) 2013-present Cole Bemis). Both
upstream licenses permit redistribution with the copyright notices preserved.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Glyphs in `PaGlyph.tsx` derived from icons originally introduced by Feather
also fall under the Feather MIT terms:

```
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## Runtime-downloaded font presets

The settings UI can download optional monospace font presets from upstream
GitHub Releases at user request. Those preset font files are not bundled in
the parasor source tree or npm package; parasor only stores a whitelist of
approved release asset URLs and extracts one Regular TTF into the user's local
font cache after the user starts the download.
