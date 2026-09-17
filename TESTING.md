# Browser verification

Verified in Chromium through Playwright on 2026-09-17, using MDN's small CC0 flower video. No test dependencies are required by the app.

- Local file load; player-click and keyboard capture; automatic advancement to the next cell.
- Arrow and Shift-arrow scrubbing (0 → 0.1 → 1.1 seconds), timestamp entry, and double-clicking a cell to revisit its time.
- Destination selection, drag-to-swap, removal, button and keyboard undo.
- End-of-grid capture guard: capturing the last cell disarms capture until a cell is selected explicitly.
- Grid shrink preserves hidden captures; undo restores the previous layout. Invalid output dimensions roll back without losing images.
- PNG download decoded at 1920 × 1440; JPEG download decoded at 1000 × 800. Visually inspected the exported contact sheet.
- Editable project save/reload preserves captures and layout; a restored sheet exports without loading the source video.
- Remote URL load/capture succeeded with `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`.
- The supplied genomatrix URL returned no CORS permission and correctly displayed recovery instructions. Only headers and the browser load failure were checked; the 198 MiB video was not downloaded into the project.
- Desktop and 390px viewport layouts inspected; no horizontal page overflow at 390px.
- Mascot capture/interaction animation starts; the animation toggle and reduced-motion preference disable it.
- No JavaScript exceptions during the successful editing flows. Syntax and Git whitespace checks pass.

Local test downloads and screenshots are in ignored `.artifacts/`. Safari/Firefox and real touch-device interactions have not been tested. Browser codec support and precision of time-based seeking remain browser-dependent.

To repeat the main smoke check: open a video, capture at two different times, select a later cell and capture again, swap two cells, shrink and restore the grid, export at a custom size, save the editable sheet, reload the page, and reopen that sheet. Confirm that its images still export without reopening the source.
