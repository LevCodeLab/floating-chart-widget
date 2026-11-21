# contributing

Want to hack on `floating-chart-widget`? Pull up a chair and grab some chai, bhai.

## local setup

* You only need Node 18 or newer.
* Zero external npm packages are required.
* Run `npm run build` after editing `src/floating-widget.js` so `dist/` and `extension/` stay fresh.
* Run `npm test` to check SVG path math, ring buffer stats, drag bounds, and Shadow DOM behavior.
* Run `npm run lint:brand` to make sure the monochrome color rules stay clean.

## design rules

* Keep every card, button, and chart strictly monochrome dark obsidian (`#141418` card, `#0D0D10` surface, `#26262E` border, `#FFFFFF` active button with `#000000` text).
* Do not add bright colored buttons, status dots, or colored pills anywhere in CSS, HTML, JS, or SVG.
* Keep all widget styles inside the open Shadow DOM so host websites never break our layout and we never break theirs.

## testing the chrome extension

1. Run `npm run build` first.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` directory.
4. After changing `extension/` or `src/`, click the reload icon on the extension card and refresh your test tab.

## sending a pull request

1. Create a feature branch from `main`.
2. Add or update unit tests in `test/floating-widget.test.mjs` for new math or UI behavior.
3. Make sure `npm run build`, `npm run lint:brand`, and `npm test` all pass before opening your PR.
