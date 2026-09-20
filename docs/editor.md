# VS Code Formatting

.vscode/settings.json selects esbenp.prettier-vscode as the TypeScript and TSX formatter. Install the Prettier VS Code extension to use it.

- Format the whole file on save and the affected region on paste.
- Keep format-on-type disabled to avoid mixing two formatting paths.
- Use two-space indentation with indentation detection disabled.
- Use Ctrl+K, Ctrl+F for a selection or Shift+Alt+F for the whole document.

These workspace settings do not change other languages or global settings. Ordinary indentation, completion, and TypeScript language services remain available.

If settings do not apply immediately, run Developer: Reload Window, confirm the language mode, and check Format Document With... for the selected formatter.
