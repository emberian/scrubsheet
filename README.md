# scrubsheet ✳

Scrub a video. Pick your moments. Make a contact sheet. With a judgmental skaterpunk shrub.

A static, browser-only app: native HTML video, Canvas export, vanilla JavaScript and CSS. No runtime dependencies, build step, backend, uploads, or ffmpeg. All app assets live in this repo, including the animated mascot.

## Run

From this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Python only serves static files; it does not process video. Any static HTTP server works.

For GitHub Pages, choose **Settings → Pages → Deploy from a branch**, then the desired branch and **/(root)**. All asset paths are relative, so a repository subpath works. Nothing has to be built. Publishing is not part of the local setup.

## Use

- Open or drop a local video, or load a direct HTTP(S) video URL.
- Pick a destination cell. Click the video or press **C** to capture and advance. At the end of the grid, explicitly pick another cell to replace it.
- **← / →** pause and scrub; **Shift** moves ten steps. Set the step size below the player. **Space** plays/pauses when focus isn't on a control. Enter a timestamp to jump directly.
- Click a cell to select it; double-click to revisit its timestamp in the original video. Drag filled cells to swap. **[ / ]** select adjacent cells, **Delete** clears the selected cell, and **⌘/Ctrl Z** undoes sheet edits.
- Set grid rows/columns independently of total output width/height. Choose whole-frame letterboxing or fill/crop, gutter size, background, and timestamps. **Match video ratio** calculates a height that fits the video's shape.
- Export a PNG or JPEG. Unfilled cells export as the chosen background, without the editor's cell numbers or outlines.
- **Save sheet** downloads an editable `.scrubsheet` file containing the captures and layout. **Open sheet** restores it without needing the video. Reopen the original video to take more captures or revisit times. There is no autosave: save before closing or refreshing.

Shrinking the grid keeps overflow captures in the project; enlarging the grid restores them. Undo retains the most recent 30 edits in this tab. Sheet files include source names and source URLs/identifiers; avoid sharing a project with a private or signed URL if you don't want to share that URL. Exported images only contain frames and optional timestamps.

## Browser limits

- A remote server must allow CORS for Canvas to capture its video. A URL must point to media, not a YouTube/Vimeo watch page. If loading fails, download the video and open the local file. No proxy is used.
  [MDN explains the browser's cross-origin Canvas restriction.](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)
- Codec support depends on your browser/OS. H.264 MP4 is a useful starting point. No conversion is performed.
- Small scrub steps seek by time. The browser does not expose a reliable frame index, so the 1/24, 1/30, and 1/60 options are approximate time steps, not promises of exact frame stepping, especially for variable-frame-rate footage.
  [Seeking uses the media element's currentTime.](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
- Captures retain native resolution up to 16 megapixels per image, encoded as JPEG at 96% quality. Export is limited to 8192 pixels per side and 32 megapixels overall. Large sources, many captures, and saved projects can use substantial memory; editable project imports are capped at 100 MB.
- The shrub uses CSS transforms on the generated illustration, including idle motion and a capture hop. The pause button and `prefers-reduced-motion` disable animation. It isn't a separately rigged character.

## Files

`index.html` is the UI, `style.css` its styling and animation, and `app.js` the video/capture/editor/export behavior. `assets/shrubenby.png` is the generated raster mascot; its production prompt is recorded in `assets/mascot-prompt.md`.
