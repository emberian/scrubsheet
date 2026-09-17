# Browser verification

Verified in Chromium/Google Chrome through Playwright on 2026-09-17, using MDN's small CC0 flower video and the user's local `genotr2.mp4` (1440 × 1080, about 154 seconds). No test dependencies are required by the app at runtime.

Run the repeatable suite with `npm ci` then `npm test -- /path/to/video.mp4`. It uses an installed Google Chrome, launches its own server on a free port, and runs in isolated contexts. `tests/browser-regression.mjs` can also be called with an existing Playwright Browser.

The expanded suite checks filmstrip generation, zoom/pan, scrubber-focus shortcuts, keep-rolling capture, tray replacement/drag/stash/undo, seeding only empty cells within the visible range, unchanged main playhead during sampling, whole-pass undo, seeding cancellation, version 1/2 project import, editable tray roundtrips, reload recovery, source-video reattachment at the saved time, New sheet/Undo, mobile overflow, and reduced motion. Clipboard writes are intercepted to validate a real 1920 × 1440 PNG and the denied-permission fallback without altering the system clipboard; an actual paste into another app has not been automated.

Storage fault tests also pass: separate tabs recover their own drafts, a fresh tab recovers the most recent draft, simulated quota exhaustion reports an autosave failure while preserving the last committed draft, and blocked IndexedDB does not prevent editing or manual export.

- Local file load; player-click and keyboard capture; automatic advancement to the next cell.
- Focused timeline regression: click the range slider, press C, and verify capture and advancement without moving focus. Arrow scrubbing still works with the slider focused; C in URL/text inputs continues editing text without capturing.
- Arrow and Shift-arrow scrubbing (0 → 0.1 → 1.1 seconds), timestamp entry, and double-clicking a cell to revisit its time.
- Destination selection, drag-to-swap, removal, button and keyboard undo.
- End-of-grid capture guard: capturing the last cell disarms capture until a cell is selected explicitly.
- Grid shrink preserves hidden captures; undo restores the previous layout. Invalid output dimensions roll back without losing images.
- PNG download decoded at 1920 × 1440; JPEG download decoded at 1000 × 800. Visually inspected the exported contact sheet.
- Editable project save/reload preserves captures and layout; a restored sheet exports without loading the source video.
- Remote URL load/capture succeeded with `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`.
- The supplied genomatrix URL returned no CORS permission and correctly displayed recovery instructions. The user's local copy subsequently loaded, scrubbed, captured, and exported successfully. Neither the source video nor test captures are committed to the repo.
- Desktop and 390px viewport layouts inspected; no horizontal page overflow at 390px.
- Mascot capture/interaction animation starts; the animation toggle and reduced-motion preference disable it.
- No JavaScript exceptions during the successful editing flows. Syntax and Git whitespace checks pass.

Local test downloads and screenshots are in ignored `.artifacts/`. Safari/Firefox and real touch-device interactions have not been tested. Browser codec support and precision of time-based seeking remain browser-dependent.

To repeat the main smoke check: open a video, capture at two different times, select a later cell and capture again, swap two cells, shrink and restore the grid, export at a custom size, save the editable sheet, reload the page, and reopen that sheet. Confirm that its images still export without reopening the source.
