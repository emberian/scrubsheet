# scrubsheet ✳

Scrub a video. Pick your moments. Make a contact sheet. With a judgmental skaterpunk shrub.

[Open Scrubsheet](https://emberian.github.io/scrubsheet/)

A static, browser-only app: native HTML video, Canvas export, vanilla JavaScript and CSS. No runtime dependencies, build step, backend, uploads, or ffmpeg. All app assets live in this repo, including the animated mascot.

## Run

From this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Python only serves static files; it does not process video. Any static HTTP server works.

GitHub Pages publishes the **dev** branch from **/(root)**. Pushes to that branch update the live app. All asset paths are relative, so a repository subpath works. Nothing has to be built locally.

## Use

- Open or drop a local video, or load a direct HTTP(S) video URL.
- Pick a destination cell. Click the video or press **C** to capture and advance. At the end of the grid, explicitly pick another cell to replace it.
- Enable **keep rolling after capture** to collect moments while playback continues. The default still pauses at each capture.
- **← / →** pause and scrub; **Shift** moves ten steps. Set the step size below the player. **Space** plays/pauses when focus isn't on a control. Enter a timestamp to jump directly.
- The filmstrip shows eight sampled thumbnails. Click one to seek. Zoom up to 32× around the playhead and use the adjacent arrows to pan the range. The scrubber follows this visible range; thumbnail generation never seeks the main player.
- Click a cell to select it; double-click to revisit its timestamp in the original video. Drag filled cells to swap. **[ / ]** select adjacent cells, **Delete** clears the selected cell, and **⌘/Ctrl Z** undoes sheet edits.
- Set **Capture to → frame tray** to collect candidates independently of the grid. Select a cell, then click a tray image or drag it onto a cell. A replaced frame goes back to the tray. **Stash selected cell** moves a frame out of the grid. Tray edits are undoable; the tray holds up to 144 candidates.
- **Seed empty cells** samples evenly across the visible timeline range, preserving filled cells and the main playhead. Zoom first to sample a particular scene. Cancel applies no partial changes; one Undo removes a completed seed pass. Editing the sheet during sampling cancels that pass rather than overwriting your edits.
- Set grid rows/columns independently of total output width/height. Choose whole-frame letterboxing or fill/crop, gutter size, background, and timestamps. **Match video ratio** calculates a height that fits the video's shape.
- Export a PNG or JPEG, or use **Copy image** to put a PNG on the clipboard for pasting. Unfilled cells export as the chosen background, without the editor's cell numbers or outlines. If clipboard permissions are unavailable, download with Export image.
- **Save sheet** downloads an editable `.scrubsheet` file containing the captures, tray, layout, and preferences. **Open sheet** restores it without needing the video. Version 1 files from the first release still open. Reopen the original video to take more captures or revisit times.
- Local autosave stores your sheet, tray, settings, and last saved playhead position in IndexedDB. Wait for **Saved on this device** before closing. Reloads recover this tab's draft; a new tab starts from the latest stored draft and subsequently saves independently. The source video itself is not stored: reattach the same local file to resume at the saved time. Remote URLs are never loaded automatically during recovery.
- **New sheet** clears the grid and tray while keeping the video and layout. Undo brings the previous picks back.

Shrinking the grid keeps overflow captures in the project; enlarging the grid restores them. Undo retains the most recent 30 edits in this tab. Sheet files include source names and source URLs/identifiers; avoid sharing a project with a private or signed URL if you don't want to share that URL. Exported images only contain frames and optional timestamps.

Local recovery is specific to the browser and site origin; clearing site data removes it, and private browsing or storage quotas can prevent it. Failures are shown in the autosave indicator. Keep downloaded sheet files as portable backups. Duplicating a tab may also duplicate its session identity; opening the app in a fresh tab gives it an independent draft. [IndexedDB storage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) and [clipboard writes](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write) use native browser APIs.

## Browser limits

- A remote server must allow CORS for Canvas to capture its video. A URL must point to media, not a YouTube/Vimeo watch page. If loading fails, download the video and open the local file. No proxy is used.
  [MDN explains the browser's cross-origin Canvas restriction.](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)
- Codec support depends on your browser/OS. H.264 MP4 is a useful starting point. No conversion is performed.
- Small scrub steps seek by time. The browser does not expose a reliable frame index, so the 1/24, 1/30, and 1/60 options are approximate time steps, not promises of exact frame stepping, especially for variable-frame-rate footage.
  [Seeking uses the media element's currentTime.](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
- Captures retain native resolution up to 16 megapixels per image, encoded as JPEG at 96% quality. Export is limited to 8192 pixels per side and 32 megapixels overall. Large sources, many captures, and saved projects can use substantial memory; editable project imports are capped at 100 MB.
- The shrub uses CSS transforms on the generated illustration, including idle motion and a capture hop. Their expression of confidence gets progressively more obnoxious as the grid fills. The pause button and `prefers-reduced-motion` disable the idle and hop animations. It isn't a separately rigged character.

## Files

`index.html` is the UI, `style.css` its styling and animation, and `app.js` the editor. `media.js` isolates background video sampling; `drafts.js` handles local recovery. `assets/shrubenby.png` is the generated raster mascot; its production prompt is recorded in `assets/mascot-prompt.md`.

## Regression tests

The app itself needs no dependencies or build. Development tests use Playwright and an installed Google Chrome:

```sh
npm ci
npm test -- /path/to/a/local-video.mp4
```

The test runner starts its own temporary local server and isolated browser contexts. It never touches your open sheet or the system clipboard. Tests intercept clipboard writes to inspect the encoded PNG and exercise permission failures. See `TESTING.md` for coverage and limits.
