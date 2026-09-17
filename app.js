import { createSampler, snapshot, decodeFrame } from "./media.js";
import { createDraftStore } from "./drafts.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const defaults = {
  columns: 3,
  rows: 4,
  width: 1920,
  height: 1440,
  gutter: 8,
  fit: "contain",
  timestamps: true,
  background: "#161913",
};
let settings = { ...defaults };
let cells = Array(12).fill(null);
let selected = 0;
let source = null;
let objectURL = null;
let ready = false;
let busy = false;
let revision = 0;
let seekTarget = null;
let dragIndex = null;
let dragTray = null;
let tray = [];
let recoveredSource = null;
let resume = null;
let sampler = null;
let filmToken = 0;
let filmTimer;
let windowStart = 0;
let windowEnd = 0;
let seeding = false;
let seedToken = 0;
let editSerial = 0;
let booted = false;
let saveTimer;
let saveSerial = 0;
let savedSerial = 0;
let saveQueue = Promise.resolve();
const drafts = createDraftStore();
const history = [];
const capacity = () => settings.columns * settings.rows;
const visible = () => cells.slice(0, capacity());
const pad = (n) => String(n).padStart(2, "0");

function timeLabel(value, precise = false) {
  const ms = Math.max(
    0,
    Math.round((Number.isFinite(value) ? value : 0) * 1000),
  );
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${pad(hours)}:` : ""}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}${precise ? `.${String(ms % 1000).padStart(3, "0")}` : ""}`;
}

function notice(message, kind = "") {
  $("notice").textContent = message;
  $("notice").className = kind;
}

function remember() {
  editSerial++;
  history.push({
    settings: { ...settings },
    cells: [...cells],
    tray: [...tray],
    selected,
  });
  if (history.length > 30) history.shift();
  $("undo").disabled = false;
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  editSerial++;
  ({ settings, cells, tray, selected } = previous);
  syncSettings();
  render();
  notice("Undone. Your previous sheet is back.");
}

function validSettings(input) {
  const result = { ...defaults };
  for (const [key, min, max] of [
    ["columns", 1, 12],
    ["rows", 1, 12],
    ["width", 128, 8192],
    ["height", 128, 8192],
    ["gutter", 0, 80],
  ]) {
    const number = Number(input[key]);
    if (!Number.isInteger(number) || number < min || number > max)
      throw new Error(`${key} must be a whole number from ${min} to ${max}.`);
    result[key] = number;
  }
  if (result.width * result.height > 32_000_000)
    throw new Error(
      "Keep the export under 32 megapixels (for example, 7680 × 4096).",
    );
  if (
    (result.width - (result.columns + 1) * result.gutter) / result.columns <
      8 ||
    (result.height - (result.rows + 1) * result.gutter) / result.rows < 8
  )
    throw new Error(
      "That gutter leaves no room for your frames. Reduce the gutter or increase the image size.",
    );
  result.fit = input.fit === "cover" ? "cover" : "contain";
  result.timestamps = Boolean(input.timestamps);
  if (
    typeof input.background !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(input.background)
  )
    throw new Error("Choose a valid background color.");
  result.background = input.background;
  return result;
}

function syncSettings() {
  for (const key of Object.keys(defaults)) {
    if (key === "timestamps") $(key).checked = settings[key];
    else $(key).value = settings[key];
  }
}

function changeSettings() {
  const input = {};
  for (const key of Object.keys(defaults))
    input[key] = key === "timestamps" ? $(key).checked : $(key).value;
  try {
    const next = validSettings(input);
    remember();
    settings = next;
    while (cells.length < capacity()) cells.push(null);
    if (selected === null || selected >= capacity()) {
      const empty = visible().findIndex((cell) => !cell);
      selected = empty >= 0 ? empty : 0;
    }
    render();
    const hidden = cells.slice(capacity()).filter(Boolean).length;
    notice(
      hidden
        ? `${hidden} captured frame${hidden === 1 ? " is" : "s are"} outside this smaller grid. Enlarge it to bring them back; Save sheet keeps them too.`
        : "Layout updated. Captured frames keep their original resolution.",
    );
  } catch (error) {
    notice(error.message, "error");
    syncSettings();
  }
}

function gridGeometry() {
  return {
    w:
      (settings.width - (settings.columns + 1) * settings.gutter) /
      settings.columns,
    h:
      (settings.height - (settings.rows + 1) * settings.gutter) / settings.rows,
  };
}

function scaleGrid() {
  const grid = $("grid");
  const scale = grid.clientWidth / settings.width;
  grid.style.gap = `${settings.gutter * scale}px`;
  grid.style.padding = `${settings.gutter * scale}px`;
}

function render() {
  const grid = $("grid");
  grid.style.gridTemplateColumns = `repeat(${settings.columns}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${settings.rows}, minmax(0, 1fr))`;
  grid.style.aspectRatio = `${settings.width} / ${settings.height}`;
  grid.style.background = settings.background;
  grid.replaceChildren();
  visible().forEach((cell, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cell${selected === index ? " selected" : ""}`;
    button.dataset.index = index;
    button.setAttribute("aria-pressed", String(selected === index));
    button.setAttribute(
      "aria-label",
      `Cell ${index + 1}${cell ? `, ${timeLabel(cell.time, true)}, ${cell.sourceName}` : ", empty"}`,
    );
    button.title = cell
      ? `Cell ${index + 1} · ${timeLabel(cell.time, true)} · double-click to revisit`
      : `Put your next capture in cell ${index + 1}`;
    button.draggable = Boolean(cell);
    if (cell) {
      const image = document.createElement("img");
      image.src = cell.src;
      image.alt = "";
      image.style.objectFit = settings.fit;
      button.style.background = settings.background;
      button.style.border = "0";
      button.append(image);
      if (settings.timestamps) {
        const timestamp = document.createElement("span");
        timestamp.className = "cell-time";
        timestamp.textContent = timeLabel(cell.time, true);
        button.append(timestamp);
      }
    } else {
      const number = document.createElement("span");
      number.className = "number";
      number.textContent = pad(index + 1);
      button.append(number);
    }
    if (selected === index) {
      const target = document.createElement("span");
      target.className = "target";
      target.textContent = "+";
      button.append(target);
    }
    grid.append(button);
  });
  scaleGrid();
  const count = visible().filter(Boolean).length;
  $("count").textContent = `${count} / ${capacity()} FRAMES`;
  $("selection-label").textContent =
    selected === null
      ? count === capacity()
        ? "Sheet full · pick a cell to replace"
        : "Pick a cell to continue"
      : `Next: cell ${pad(selected + 1)}`;
  $("remove").disabled = !cells[selected];
  $("undo").disabled = !history.length;
  $("export").disabled = count === 0;
  $("copy-sheet").disabled = count === 0;
  $("stash").disabled = !cells[selected] || tray.length >= 144;
  updateShrub(count);
  renderTray();
  $("export-info").textContent =
    `${settings.width} × ${settings.height} px · ${count ? `${count} moment${count === 1 ? "" : "s"} worth keeping` : "ready when you are"}`;
  updateControls();
  renderMarkers();
  scheduleSave();
}

function renderMarkers() {
  $("markers").replaceChildren();
  if (!ready) return;
  visible()
    .filter((cell) => cell && cell.sourceId === source.id)
    .forEach((cell) => {
      const marker = document.createElement("i");
      if (cell.time < windowStart || cell.time > windowEnd) return;
      marker.style.left = `${(100 * (cell.time - windowStart)) / (windowEnd - windowStart)}%`;
      $("markers").append(marker);
    });
}

function updateControls() {
  for (const id of ["play", "back", "forward", "timeline", "timecode"])
    $(id).disabled = !ready;
  const toTray = $("capture-target").value === "tray";
  const key = document.createElement("kbd");
  key.textContent = "C";
  $("capture").replaceChildren(
    document.createTextNode(toTray ? "Stash " : "Capture "),
    key,
  );
  $("capture").disabled =
    !ready || busy || (toTray ? tray.length >= 144 : selected === null);
  $("seed").disabled = !ready || seeding || visible().every(Boolean);
  $("cancel-seed").hidden = !seeding;
  $("timeline-zoom").disabled = !ready;
  $("pan-left").disabled = !ready || windowStart <= 0;
  $("pan-right").disabled = !ready || windowEnd >= video.duration;
}

function updateTime() {
  if (document.activeElement !== $("timecode"))
    $("timecode").value = timeLabel(video.currentTime, true);
  $("timeline").value = video.currentTime || 0;
  if (
    ready &&
    !video.paused &&
    (video.currentTime < windowStart || video.currentTime > windowEnd)
  )
    setWindow(video.currentTime);
}

function openSource(url, info) {
  revision++;
  cancelSeeding(false);
  filmToken++;
  clearTimeout(filmTimer);
  sampler?.dispose();
  sampler = null;
  video.pause();
  ready = false;
  busy = false;
  seekTarget = null;
  video.removeAttribute("src");
  video.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = info.kind === "file" ? url : null;
  source = info;
  recoveredSource = info;
  video.crossOrigin = "anonymous";
  video.src = url;
  video.muted = !$("sound").checked;
  $("source-name").textContent = info.name;
  $("source-name").title = info.name;
  $("welcome").hidden = true;
  video.hidden = false;
  $("stage-hint").hidden = true;
  $("stage").classList.add("has-video");
  $("duration").textContent = "…";
  updateControls();
  notice(`Loading ${info.name}… Captures already in your sheet are kept.`);
  $("filmstrip").textContent = "Finding the little pictures…";
  scheduleSave();
}

function openFile(file) {
  if (!file) return;
  openSource(URL.createObjectURL(file), {
    kind: "file",
    id: `file:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
  });
}

function openURL(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Use an http or https video URL.");
    if (location.protocol === "https:" && url.protocol === "http:")
      throw new Error(
        "This page uses HTTPS; the video URL needs HTTPS too. Or download the video and open the file.",
      );
    if (url.username || url.password)
      throw new Error("Use a video URL without embedded account credentials.");
    const name = decodeURIComponent(
      url.pathname.split("/").pop() || url.hostname,
    );
    openSource(url.href, { kind: "url", id: url.href, name, url: url.href });
  } catch (error) {
    notice(
      error.message === "Invalid URL"
        ? "Paste a complete, direct video URL beginning with https://."
        : error.message,
      "error",
    );
  }
}

video.addEventListener("loadeddata", () => {
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    !video.videoWidth
  ) {
    notice(
      "This source has no seekable video duration. Try a complete video file instead of a live stream.",
      "error",
    );
    return;
  }
  ready = true;
  if (!sampler) sampler = createSampler(video.src);
  if (resume?.sourceId === source.id) {
    video.currentTime = Math.min(resume.time, video.duration - 0.001);
    resume = null;
  }
  $("duration").textContent = timeLabel(video.duration);
  $("timeline").max = video.duration;
  setWindow(video.currentTime);
  $("stage-hint").hidden = false;
  updateControls();
  updateTime();
  renderMarkers();
  notice(
    `${video.videoWidth} × ${video.videoHeight} · ${timeLabel(video.duration)} · Click the video or press C to collect a frame.`,
    "success",
  );
});
video.addEventListener("error", () => {
  if (!source || !video.getAttribute("src") || !video.error) return;
  ready = false;
  updateControls();
  notice(
    source.kind === "url"
      ? "Couldn’t open that video. Check that it’s a direct media URL and that its host allows cross-origin access (CORS). Otherwise download the video and use Open video. A codec or network issue can also cause this."
      : "Your browser couldn’t decode this video. Try an MP4 with H.264 video, or open Scrubsheet in another browser.",
    "error",
  );
  if (source.kind === "url") {
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open the original video to save it locally ↗";
    $("notice").append(document.createTextNode(" "), link);
  }
});
video.addEventListener("timeupdate", updateTime);
video.addEventListener("seeked", () => {
  seekTarget = null;
  updateTime();
  if (
    ready &&
    (video.currentTime < windowStart || video.currentTime > windowEnd)
  )
    setWindow(video.currentTime);
  scheduleSave();
});
video.addEventListener("play", () => {
  $("play").textContent = "Ⅱ";
  $("play").setAttribute("aria-label", "Pause video");
});
video.addEventListener("pause", () => {
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play video");
  scheduleSave();
});

async function togglePlay() {
  if (!ready) return;
  if (video.paused) {
    try {
      await video.play();
    } catch (error) {
      notice(`Playback couldn’t start: ${error.message}`, "error");
    }
  } else video.pause();
}

function seek(time) {
  if (!ready || !Number.isFinite(time)) return;
  video.pause();
  // Stay just before EOF so a decoded picture is available to capture.
  seekTarget = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), time));
  video.currentTime = seekTarget;
  updateTime();
}

function scrub(direction, fast = false) {
  seek(
    (seekTarget ?? video.currentTime) +
      direction * Number($("scrub-step").value) * (fast ? 10 : 1),
  );
}

function frameReady() {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("error", fail);
    };
    const check = () => {
      if (!video.seeking && video.readyState >= 2) {
        cleanup();
        resolve();
      }
    };
    const fail = () => {
      cleanup();
      reject(
        new Error("The frame did not finish loading. Try another moment."),
      );
    };
    timer = setTimeout(fail, 12000);
    video.addEventListener("seeked", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("error", fail);
    check();
  });
}

function celebrate(captured = true) {
  updateShrub(visible().filter(Boolean).length);
  for (const element of captured
    ? [$("capture-flash"), $("shrub-pal")]
    : [$("shrub-pal")]) {
    element.classList.remove("show", "stoked");
    void element.offsetWidth;
    element.classList.add(element.id === "capture-flash" ? "show" : "stoked");
  }
}

async function capture() {
  const toTray = $("capture-target").value === "tray";
  if (!ready || busy || (toTray ? tray.length >= 144 : selected === null))
    return;
  if (!toTray && cells[selected] && tray.length >= 144) {
    notice(
      "The tray is full. Remove a candidate before replacing this cell.",
      "error",
    );
    return;
  }
  busy = true;
  updateControls();
  const generation = revision;
  const edit = editSerial;
  const destination = selected;
  if (!$("keep-rolling").checked) video.pause();
  try {
    await frameReady();
    if (generation !== revision) return;
    const { src, time } = snapshot(video);
    const capturedSource = { ...source };
    const image = new Image();
    image.src = src;
    await image.decode();
    if (generation !== revision) return;
    if (edit !== editSerial) {
      notice(
        "The sheet changed while that frame loaded. Capture again to use your current layout.",
      );
      return;
    }
    remember();
    const frame = {
      src,
      image,
      time,
      sourceId: capturedSource.id,
      sourceName: capturedSource.name,
    };
    if (toTray) tray.push(frame);
    else {
      if (cells[destination] && tray.length < 144)
        tray.push(cells[destination]);
      cells[destination] = frame;
      selected = destination + 1 < capacity() ? destination + 1 : null;
    }
    render();
    celebrate();
    notice(
      toTray
        ? `Stashed ${timeLabel(time, true)} in your frame tray.`
        : `Cell ${pad(destination + 1)} ← ${timeLabel(time, true)}.${selected === null ? " End of the grid! Pick a cell to replace, capture to the tray, or export." : ` Next capture goes in cell ${pad(selected + 1)}.`}`,
      "success",
    );
  } catch (error) {
    notice(
      error.name === "SecurityError"
        ? "This host blocks frame capture. Download the video, then use Open video to work with a local copy."
        : error.message,
      "error",
    );
  } finally {
    if (generation === revision) {
      busy = false;
      updateControls();
    }
  }
}

function selectCell(index) {
  selected = index;
  // Preserve cell elements and keyboard focus, including between dblclick events.
  for (const button of $("grid").children) {
    const active = Number(button.dataset.index) === selected;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
    button.querySelector(".target")?.remove();
    if (active) {
      const target = document.createElement("span");
      target.className = "target";
      target.textContent = "+";
      button.append(target);
    }
  }
  $("selection-label").textContent = `Next: cell ${pad(selected + 1)}`;
  $("remove").disabled = !cells[selected];
  $("stash").disabled = !cells[selected] || tray.length >= 144;
  updateControls();
  scheduleSave();
}
function removeCell() {
  if (selected === null || !cells[selected]) return;
  remember();
  cells[selected] = null;
  render();
  notice("Cell cleared. Undo can bring it back.");
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function sheetName() {
  return `${(source?.name || recoveredSource?.name || "untitled")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .slice(0, 90)}-scrubsheet`;
}

function drawCell(ctx, image, x, y, width, height) {
  const iw = image.naturalWidth,
    ih = image.naturalHeight;
  const scale =
    settings.fit === "cover"
      ? Math.max(width / iw, height / ih)
      : Math.min(width / iw, height / ih);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.drawImage(
    image,
    x + (width - iw * scale) / 2,
    y + (height - ih * scale) / 2,
    iw * scale,
    ih * scale,
  );
  ctx.restore();
}

async function exportImage(copy = false) {
  if (!visible().some(Boolean)) return;
  const button = $(copy ? "copy-sheet" : "export");
  button.disabled = true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error(
        "Your browser couldn’t allocate this image. Try a smaller export.",
      );
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const { w, h } = gridGeometry();
    visible().forEach((cell, index) => {
      if (!cell) return;
      const x =
        settings.gutter + (index % settings.columns) * (w + settings.gutter);
      const y =
        settings.gutter +
        Math.floor(index / settings.columns) * (h + settings.gutter);
      drawCell(ctx, cell.image, x, y, w, h);
      if (settings.timestamps) {
        const fontSize = Math.max(
          6,
          Math.min(w / 11, h / 10, settings.width / 100),
        );
        const inset = fontSize * 0.4;
        const label = timeLabel(cell.time, true);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.font = `${fontSize}px monospace`;
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#10140cbb";
        ctx.fillRect(
          x + inset,
          y + h - fontSize - inset * 3,
          ctx.measureText(label).width + inset * 2,
          fontSize + inset * 2,
        );
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x + inset * 2, y + h - inset * 2);
        ctx.restore();
      }
    });
    const format = copy ? "png" : $("format").value;
    if (copy && (!navigator.clipboard?.write || !window.ClipboardItem))
      throw new Error(
        "Image copying is unavailable in this browser. Use Export image instead.",
      );
    const blobPromise = new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                new Error(
                  "The browser could not export this size. Try a smaller image.",
                ),
              ),
        `image/${format}`,
        0.95,
      ),
    );
    blobPromise.catch(() => {});
    if (copy) {
      // Start the write during the click; promise-valued data keeps Safari's user activation.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      notice(
        "Copied your sheet. Paste it straight into Discord or wherever it belongs.",
        "success",
      );
      return;
    }
    const blob = await blobPromise;
    download(blob, `${sheetName()}.${format === "jpeg" ? "jpg" : "png"}`);
    notice(
      `Exported ${canvas.width} × ${canvas.height}. Go show someone what you saw.`,
      "success",
    );
  } catch (error) {
    notice(
      copy
        ? `Couldn’t copy the image: ${error.message} Use Export image if clipboard access is blocked.`
        : error.message,
      "error",
    );
  } finally {
    button.disabled = !visible().some(Boolean);
  }
}

function projectData() {
  const clean = (cell) =>
    cell
      ? {
          src: cell.src,
          time: cell.time,
          sourceId: cell.sourceId,
          sourceName: cell.sourceName,
        }
      : null;
  const info = source || recoveredSource;
  return {
    app: "scrubsheet",
    version: 2,
    settings: { ...settings },
    selected,
    source: info
      ? { name: info.name, kind: info.kind, url: info.url, id: info.id }
      : null,
    position: ready ? video.currentTime : resume?.time || 0,
    preferences: {
      keepRolling: $("keep-rolling").checked,
      captureTarget: $("capture-target").value,
      zoom: $("timeline-zoom").value,
    },
    cells: cells.map(clean),
    tray: tray.map(clean),
  };
}

function saveProject() {
  const project = projectData();
  download(
    new Blob([JSON.stringify(project)], { type: "application/json" }),
    `${sheetName()}.scrubsheet`,
  );
  notice(
    "Editable sheet saved, captured images included. Keep the source video too if you want to collect more frames.",
    "success",
  );
}

async function restoreProject(file) {
  if (!file) return;
  try {
    if (file.size > 100_000_000)
      throw new Error("This sheet is over 100 MB. Try a smaller project.");
    await applyProject(JSON.parse(await file.text()));
    notice(
      "Sheet and tray restored. Reopen the original video to capture more or revisit timestamps. Remote URLs are never loaded automatically.",
      "success",
    );
  } catch (error) {
    notice(`Couldn’t open the sheet: ${error.message}`, "error");
  }
}

async function applyProject(project, recovering = false) {
  const edit = editSerial;
  if (
    project.app !== "scrubsheet" ||
    ![1, 2].includes(project.version) ||
    !Array.isArray(project.cells) ||
    project.cells.length > 144 ||
    (project.tray &&
      (!Array.isArray(project.tray) || project.tray.length > 144))
  )
    throw new Error("That isn’t a supported Scrubsheet project.");
  if (
    project.source &&
    (typeof project.source !== "object" ||
      typeof project.source.name !== "string" ||
      !["file", "url"].includes(project.source.kind) ||
      (project.source.id != null && typeof project.source.id !== "string") ||
      (project.source.url != null && typeof project.source.url !== "string"))
  )
    throw new Error("The saved source metadata is invalid.");
  const nextSettings = validSettings(project.settings);
  const nextCells = [];
  for (const cell of project.cells) {
    nextCells.push(await decodeFrame(cell));
  }
  const nextTray = [];
  for (const frame of project.tray || []) {
    const decoded = await decodeFrame(frame);
    if (decoded) nextTray.push(decoded);
  }
  while (nextCells.length < nextSettings.columns * nextSettings.rows)
    nextCells.push(null);
  if (!recovering && edit !== editSerial)
    throw new Error(
      "The sheet changed while this project was opening. Try opening it again when you’re done editing.",
    );
  if (!recovering) remember();
  settings = nextSettings;
  cells = nextCells;
  tray = nextTray;
  recoveredSource = project.source || null;
  resume = {
    sourceId: project.source?.id,
    time:
      Number.isFinite(project.position) && project.position >= 0
        ? project.position
        : 0,
  };
  selected =
    Number.isInteger(project.selected) &&
    project.selected >= 0 &&
    project.selected < capacity()
      ? project.selected
      : project.selected === null
        ? null
        : 0;
  if (project.source?.kind === "url" && typeof project.source.url === "string")
    $("video-url").value = project.source.url;
  $("keep-rolling").checked = Boolean(project.preferences?.keepRolling);
  $("capture-target").value =
    project.preferences?.captureTarget === "tray" ? "tray" : "sheet";
  const zoom = String(project.preferences?.zoom || "1");
  $("timeline-zoom").value = ["1", "2", "4", "8", "16", "32"].includes(zoom)
    ? zoom
    : "1";
  syncSettings();
  render();
}

$("open-file").onclick = $("welcome-open").onclick = () =>
  $("file-input").click();
$("file-input").onchange = (event) => {
  openFile(event.target.files[0]);
  event.target.value = "";
};
$("url-form").onsubmit = (event) => {
  event.preventDefault();
  openURL($("video-url").value.trim());
};
$("play").onclick = togglePlay;
$("back").onclick = () => scrub(-1);
$("forward").onclick = () => scrub(1);
$("capture").onclick = capture;
video.onclick = capture;
$("sound").onchange = () => {
  video.muted = !$("sound").checked;
};
$("timeline").oninput = () => seek(Number($("timeline").value));
$("timecode").onchange = () => {
  const text = $("timecode").value.trim();
  const parts = text.split(":");
  if (
    !/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text) ||
    parts.slice(1).some((part) => Number(part) >= 60)
  ) {
    notice("Use seconds, mm:ss.mmm, or hh:mm:ss.mmm.", "error");
    updateTime();
    return;
  }
  seek(parts.reduce((total, part) => total * 60 + Number(part), 0));
};
$("timecode").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("timecode").blur();
  }
};
$("undo").onclick = undo;
$("remove").onclick = removeCell;
$("export").onclick = () => exportImage();
$("copy-sheet").onclick = () => exportImage(true);
$("save-project").onclick = saveProject;
$("restore-project").onclick = () => $("project-input").click();
$("project-input").onchange = (event) => {
  restoreProject(event.target.files[0]);
  event.target.value = "";
};
for (const key of Object.keys(defaults))
  $(key).addEventListener("change", changeSettings);
$("natural-size").onclick = () => {
  const ratio = ready ? video.videoWidth / video.videoHeight : 16 / 9;
  const { w } = gridGeometry();
  $("height").value = Math.round(
    (w / ratio) * settings.rows + (settings.rows + 1) * settings.gutter,
  );
  changeSettings();
};
$("help-button").onclick = () => $("help").showModal();
$("help").onclick = (event) => {
  if (event.target === $("help")) {
    const box = $("help").getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      $("help").close();
  }
};

$("grid").addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (cell) selectCell(Number(cell.dataset.index));
});
$("grid").addEventListener("dblclick", (event) => {
  const button = event.target.closest(".cell");
  const cell = button && cells[Number(button.dataset.index)];
  if (!cell) return;
  if (ready && cell.sourceId === source.id) seek(cell.time);
  else
    notice(
      `Reopen ${cell.sourceName} to revisit ${timeLabel(cell.time, true)}.`,
      "error",
    );
});
$("grid").addEventListener("dragstart", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || !cells[Number(cell.dataset.index)]) return;
  dragIndex = Number(cell.dataset.index);
  event.dataTransfer.setData("text/plain", String(dragIndex));
  event.dataTransfer.effectAllowed = "move";
});
$("grid").addEventListener("dragover", (event) => {
  if (dragIndex === null && dragTray === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.target.closest(".cell")?.classList.add("drag-target");
});
$("grid").addEventListener("dragleave", (event) =>
  event.target.closest(".cell")?.classList.remove("drag-target"),
);
$("grid").addEventListener("drop", (event) => {
  if (dragIndex === null && dragTray === null) return;
  event.preventDefault();
  const button = event.target.closest(".cell");
  if (button && dragTray !== null) {
    placeTray(dragTray, Number(button.dataset.index));
    dragTray = null;
    return;
  }
  if (button) {
    const to = Number(button.dataset.index);
    remember();
    [cells[to], cells[dragIndex]] = [cells[dragIndex], cells[to]];
    selected = to;
  }
  dragIndex = null;
  render();
});
$("grid").addEventListener("dragend", () => {
  dragIndex = null;
  document
    .querySelectorAll(".drag-target")
    .forEach((cell) => cell.classList.remove("drag-target"));
});
for (const eventName of ["dragenter", "dragover"])
  $("stage").addEventListener(eventName, (event) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      $("stage").classList.add("dragover");
    }
  });
$("stage").addEventListener("dragleave", () =>
  $("stage").classList.remove("dragover"),
);
$("stage").addEventListener("drop", (event) => {
  event.preventDefault();
  $("stage").classList.remove("dragover");
  openFile(event.dataTransfer.files[0]);
});
// Prevent a missed file drop from navigating away and losing the sheet.
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (
    event.target.closest(
      'input:not([type="range"]), textarea, select, [contenteditable="true"]',
    ) ||
    $("help").open
  )
    return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "?") {
    event.preventDefault();
    $("help").showModal();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    scrub(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
  } else if (event.code === "Space" && !event.target.closest("button")) {
    event.preventDefault();
    if (!event.repeat) togglePlay();
  } else if (
    (event.key.toLowerCase() === "c" ||
      (event.key === "Enter" && !event.target.closest("button"))) &&
    !event.repeat
  ) {
    event.preventDefault();
    capture();
  } else if (["Backspace", "Delete"].includes(event.key)) {
    event.preventDefault();
    removeCell();
  } else if (["[", "]"].includes(event.key)) {
    event.preventDefault();
    selectCell(
      Math.max(
        0,
        Math.min(
          capacity() - 1,
          (selected ?? 0) + (event.key === "[" ? -1 : 1),
        ),
      ),
    );
  }
});

function updateShrub(count) {
  const fullness = count / capacity();
  const mood = fullness >= 1 ? 3 : fullness >= 0.5 ? 2 : count ? 1 : 0;
  $("shrub-pal").dataset.mood = mood;
  $("shrub-quip").textContent = [
    "take a picture. it'll last longer.",
    "oh, you have an eye for this.",
    "look at us. curating. being insufferable.",
    "a full sheet. impeccable taste. mostly mine.",
  ][mood];
  $("shrub-pal").title = [
    "Certified frame goblin",
    "Quietly impressed",
    "Dangerously smug",
    "Unbearably pleased with themself",
  ][mood];
}

function renderTray() {
  const root = $("tray");
  root.replaceChildren();
  $("tray-count").textContent = `${tray.length} / 144`;
  if (!tray.length) {
    const empty = document.createElement("span");
    empty.className = "tray-empty";
    empty.textContent = "Room for your maybes.";
    root.append(empty);
  }
  tray.forEach((frame, index) => {
    const card = document.createElement("div");
    card.className = "tray-card";
    const place = document.createElement("button");
    place.className = "tray-frame";
    place.title = `${frame.sourceName} · ${timeLabel(frame.time, true)} · click to place in selected cell`;
    place.setAttribute(
      "aria-label",
      `Place tray frame ${index + 1}, ${timeLabel(frame.time, true)}`,
    );
    place.draggable = true;
    const img = document.createElement("img");
    img.src = frame.src;
    img.alt = "";
    img.draggable = false;
    const label = document.createElement("span");
    label.textContent = timeLabel(frame.time, true);
    place.append(img, label);
    place.onclick = () => placeTray(index, selected);
    place.ondragstart = (event) => {
      dragTray = index;
      event.dataTransfer.setData("text/plain", `tray:${index}`);
      event.dataTransfer.effectAllowed = "move";
    };
    place.ondragend = () => {
      dragTray = null;
      document
        .querySelectorAll(".drag-target")
        .forEach((el) => el.classList.remove("drag-target"));
    };
    const remove = document.createElement("button");
    remove.className = "tray-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove tray frame ${index + 1}`);
    remove.onclick = () => {
      remember();
      tray.splice(index, 1);
      render();
    };
    card.append(place, remove);
    root.append(card);
  });
}

function placeTray(index, destination) {
  if (destination === null || !tray[index]) {
    notice("Pick a destination cell, then click a tray frame.");
    return;
  }
  remember();
  const frame = tray[index];
  if (cells[destination]) tray[index] = cells[destination];
  else tray.splice(index, 1);
  cells[destination] = frame;
  selected = destination + 1 < capacity() ? destination + 1 : null;
  render();
  celebrate();
  notice(
    `Placed in cell ${pad(destination + 1)}. Any replaced frame is waiting in the tray.`,
    "success",
  );
}

function setWindow(center, start) {
  if (!ready) return;
  const span = video.duration / Number($("timeline-zoom").value);
  windowStart = Math.max(
    0,
    Math.min(video.duration - span, start ?? center - span / 2),
  );
  windowEnd = Math.min(video.duration, windowStart + span);
  $("timeline").min = windowStart;
  $("timeline").max = windowEnd;
  $("timeline").value = video.currentTime;
  $("window-label").textContent =
    `${timeLabel(windowStart, true)} — ${timeLabel(windowEnd, true)}`;
  updateControls();
  renderMarkers();
  clearTimeout(filmTimer);
  filmToken++;
  filmTimer = setTimeout(buildFilmstrip, 200);
}

async function buildFilmstrip() {
  if (!sampler || !ready || seeding) return;
  const token = ++filmToken;
  const decoder = sampler;
  const start = windowStart,
    span = windowEnd - start;
  const root = $("filmstrip");
  root.replaceChildren();
  const buttons = [];
  for (let i = 0; i < 8; i++) {
    const time = start + ((i + 0.5) / 8) * span;
    const button = document.createElement("button");
    button.className = "film-frame";
    button.setAttribute("aria-label", `Seek to ${timeLabel(time, true)}`);
    const stamp = document.createElement("span");
    stamp.textContent = timeLabel(time);
    button.append(stamp);
    button.onclick = () => seek(time);
    root.append(button);
    buttons.push(button);
  }
  try {
    for (let i = 0; i < buttons.length; i++) {
      if (token !== filmToken || seeding) return;
      const frame = await decoder.frameAt(start + ((i + 0.5) / 8) * span, true);
      if (token !== filmToken) return;
      const image = document.createElement("img");
      image.src = frame.src;
      image.alt = "";
      buttons[i].prepend(image);
    }
  } catch {
    if (token === filmToken)
      root.title =
        "Some thumbnails could not load. The main player is still available.";
  }
}

function cancelSeeding(announce = true) {
  const wasSeeding = seeding;
  seedToken++;
  seeding = false;
  if (wasSeeding) {
    updateControls();
    $("seed-hint").textContent = "Evenly sample the visible timeline range.";
    if (announce) notice("Seeding cancelled. Your sheet has not changed.");
    clearTimeout(filmTimer);
    filmTimer = setTimeout(buildFilmstrip, 200);
  }
}

async function seedSheet() {
  if (!ready || !sampler || seeding) return;
  const blanks = visible()
    .map((cell, i) => (cell ? -1 : i))
    .filter((i) => i >= 0);
  if (!blanks.length) return;
  seeding = true;
  const token = ++seedToken,
    generation = revision,
    edit = editSerial;
  filmToken++;
  const decoder = sampler,
    info = { ...source };
  const start = windowStart,
    span = windowEnd - windowStart;
  updateControls();
  const frames = [];
  try {
    for (let i = 0; i < blanks.length; i++) {
      $("seed-hint").textContent = `Collecting ${i + 1} / ${blanks.length}…`;
      const frame = await decoder.frameAt(
        start + ((i + 0.5) / blanks.length) * span,
      );
      if (token !== seedToken || generation !== revision) return;
      if (edit !== editSerial)
        throw new Error(
          "The sheet changed while sampling. No seed frames were applied; try again when you’re done editing.",
        );
      frames.push(
        await decodeFrame({
          ...frame,
          sourceId: info.id,
          sourceName: info.name,
        }),
      );
      if (token !== seedToken || generation !== revision) return;
    }
    if (edit !== editSerial)
      throw new Error(
        "The sheet changed while sampling. No seed frames were applied; try again when you’re done editing.",
      );
    remember();
    blanks.forEach((index, i) => {
      cells[index] = frames[i];
    });
    selected = null;
    render();
    celebrate();
    notice(
      `Added ${frames.length} evenly spaced moments. Your existing captures stayed put. Undo removes this entire seed pass.`,
      "success",
    );
  } catch (error) {
    if (token === seedToken) notice(error.message, "error");
  } finally {
    if (token === seedToken) {
      seeding = false;
      $("seed-hint").textContent = "Evenly sample the visible timeline range.";
      updateControls();
      buildFilmstrip();
    }
  }
}

function scheduleSave() {
  if (!booted) return;
  saveSerial++;
  $("autosave-status").textContent = "Saving on this device…";
  $("autosave-status").classList.remove("save-error");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!booted || saveSerial === savedSerial) return;
  const serial = saveSerial;
  const project = projectData();
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => drafts.write(project))
    .then(() => {
      savedSerial = serial;
      if (serial === saveSerial) {
        $("autosave-status").textContent = "Saved on this device";
        $("autosave-status").classList.remove("save-error");
      }
    })
    .catch((error) => {
      $("autosave-status").textContent = "Not autosaved — use Save sheet";
      $("autosave-status").classList.add("save-error");
      $("autosave-status").title = error.message;
    });
  return saveQueue;
}

async function recoverDraft() {
  // Prevent edits while a stored draft is decoding, rather than replacing new work.
  document.querySelector("main").inert = true;
  try {
    const project = await drafts.read();
    if (project) {
      await applyProject(project, true);
      notice(
        `Recovered your sheet and tray${project.source?.name ? ` from ${project.source.name}` : ""}. Reopen the source video to keep collecting.`,
        "success",
      );
    }
    $("autosave-status").textContent = project
      ? "Recovered on this device"
      : "Local autosave ready";
  } catch (error) {
    $("autosave-status").textContent = "Recovery unavailable — use Save sheet";
    $("autosave-status").classList.add("save-error");
    $("autosave-status").title = error.message;
  } finally {
    booted = true;
    document.querySelector("main").inert = false;
  }
}

$("stash").onclick = () => {
  if (!cells[selected] || tray.length >= 144) return;
  remember();
  tray.push(cells[selected]);
  cells[selected] = null;
  render();
  notice("Stashed in the tray. The cell is ready for another candidate.");
};
$("new-sheet").onclick = () => {
  cancelSeeding(false);
  remember();
  cells = Array(capacity()).fill(null);
  tray = [];
  selected = 0;
  render();
  notice("Fresh sheet and tray. Undo brings your previous picks back.");
};
$("seed").onclick = seedSheet;
$("cancel-seed").onclick = () => cancelSeeding();
$("timeline-zoom").onchange = () => {
  setWindow(video.currentTime);
  scheduleSave();
};
$("pan-left").onclick = () =>
  setWindow(0, windowStart - (windowEnd - windowStart) / 2);
$("pan-right").onclick = () =>
  setWindow(0, windowStart + (windowEnd - windowStart) / 2);
$("capture-target").onchange = () => {
  updateControls();
  scheduleSave();
};
$("keep-rolling").onchange = scheduleSave;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushSave();
});
window.addEventListener("beforeunload", (event) => {
  if (saveSerial !== savedSerial) {
    flushSave();
    event.preventDefault();
    event.returnValue = "";
  }
});

new ResizeObserver(scaleGrid).observe($("grid"));
$("shrub-pal").onclick = () => celebrate(false);
$("motion-toggle").onclick = () => {
  const paused = document.body.classList.toggle("motion-paused");
  $("motion-toggle").setAttribute("aria-pressed", String(paused));
  $("motion-toggle").setAttribute(
    "aria-label",
    `${paused ? "Resume" : "Pause"} mascot animation`,
  );
  $("motion-toggle").title = `${paused ? "Resume" : "Pause"} mascot animation`;
  $("motion-toggle").textContent = paused ? "▶" : "Ⅱ";
};
render();
recoverDraft();
