# Vendored color themes

Built-in themes shipped with parasor. Each file is a VS Code--compatible color
theme JSON (`{ name, type, colors, ... }`); the parasor loader
(`packages/web/src/lib/theme`) only consumes the `colors` map -- `tokenColors` /
`semanticTokenColors` are kept verbatim for forward compatibility but currently
unused.

## Files

- `parasor-dark.json` -- parasor's own dark theme (in-tree)
- `parasor-light.json` -- parasor's own light theme (in-tree)
- `tokyo-night.json` -- "Tokyo Night" (Enkia, MIT). Modern dark theme. Source:
  https://github.com/tokyo-night/tokyo-night-vscode-theme
- `solarized-light.json` -- Microsoft VS Code built-in "Solarized (light)" (MIT).
  Source: https://github.com/microsoft/vscode (`extensions/theme-solarized-light`)
- `monokai.json` -- Microsoft VS Code built-in "Monokai" (MIT). Source:
  https://github.com/microsoft/vscode (`extensions/theme-monokai`). The upstream
  JSON omits `name` (it ships `%themeLabel%` resolved via `package.json`); we
  inject `"name": "Monokai"` at the top of the vendored copy so the theme
  picker shows the right label.

## How to refresh a vendored theme

Each upstream is shallow-cloneable. Replace the file in place, then re-run
`pnpm --filter @parasor/web test`. Sparse themes are fine -- unspecified keys
fall through to the per-mode VSCode baseline (`lib/theme/_baseline/`) and the
reference table (`lib/theme/references.ts`).

```sh
# Tokyo Night
curl -sL "https://api.github.com/repos/tokyo-night/tokyo-night-vscode-theme/contents/themes/tokyo-night-color-theme.json" \
  | jq -r '.content' | base64 -d > packages/web/src/vendor/themes/tokyo-night.json

# Solarized Light (Microsoft VS Code)
curl -sL "https://api.github.com/repos/microsoft/vscode/contents/extensions/theme-solarized-light/themes/solarized-light-color-theme.json" \
  | jq -r '.content' | base64 -d > packages/web/src/vendor/themes/solarized-light.json

# Monokai (Microsoft VS Code) -- re-inject name after copy
curl -sL "https://api.github.com/repos/microsoft/vscode/contents/extensions/theme-monokai/themes/monokai-color-theme.json" \
  | jq -r '.content' | base64 -d \
  | awk 'NR==FNR{print;next}/^\t"type"/{print "\t\"name\": \"Monokai\","}1' /dev/stdin /dev/stdin \
  > packages/web/src/vendor/themes/monokai.json
```

`LICENSE` aggregates the upstream MIT notices and must stay in sync when
themes are added or removed.
