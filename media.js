// Native browser decoding only. The sampler never seeks the visible player.
export function snapshot(media, maxPixels = 16_000_000, quality = 0.96) {
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (media.videoWidth * media.videoHeight)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(media.videoWidth * scale);
  canvas.height = Math.round(media.videoHeight * scale);
  if (!canvas.width || !canvas.height)
    throw new Error("No decoded video frame is available yet.");
  canvas.getContext("2d").drawImage(media, 0, 0, canvas.width, canvas.height);
  return {
    src: canvas.toDataURL("image/jpeg", quality),
    time: media.currentTime,
  };
}

export async function decodeFrame(frame) {
  if (!frame) return null;
  if (
    typeof frame.src !== "string" ||
    !/^data:image\/(jpeg|png|webp);base64,/.test(frame.src) ||
    !Number.isFinite(frame.time) ||
    frame.time < 0 ||
    typeof frame.sourceId !== "string" ||
    typeof frame.sourceName !== "string"
  ) {
    throw new Error(
      "A saved frame is invalid. Your current sheet has not been changed.",
    );
  }
  const image = new Image();
  image.src = frame.src;
  await image.decode();
  return {
    src: frame.src,
    time: frame.time,
    sourceId: frame.sourceId,
    sourceName: frame.sourceName,
    image,
  };
}

export function createSampler(url) {
  const media = document.createElement("video");
  media.muted = true;
  media.playsInline = true;
  media.preload = "auto";
  media.crossOrigin = "anonymous";
  media.hidden = true;
  document.body.append(media);
  const controller = new AbortController();
  const wait = (event, test) =>
    new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        media.removeEventListener(event, check);
        media.removeEventListener("error", fail);
        controller.signal.removeEventListener("abort", fail);
      };
      const check = () => {
        if (test()) {
          cleanup();
          resolve();
        }
      };
      const fail = () => {
        cleanup();
        reject(
          new Error(
            controller.signal.aborted
              ? "Video sampling cancelled."
              : "Could not sample this moment. Try another video or time range.",
          ),
        );
      };
      timer = setTimeout(fail, 15000);
      media.addEventListener(event, check);
      media.addEventListener("error", fail);
      controller.signal.addEventListener("abort", fail);
      if (controller.signal.aborted) fail();
      else check();
    });
  const loaded = wait("loadeddata", () => media.readyState >= 2);
  // Handle rejection immediately even if nobody has asked for a frame yet.
  loaded.catch(() => {});
  media.src = url;
  let queue = Promise.resolve();
  return {
    frameAt(time, thumbnail = false) {
      const job = queue.then(async () => {
        await loaded;
        if (controller.signal.aborted)
          throw new Error("Video sampling cancelled.");
        const target = Math.max(0, Math.min(media.duration - 0.001, time));
        if (Math.abs(media.currentTime - target) > 0.0001) {
          media.currentTime = target;
          await wait("seeked", () => !media.seeking && media.readyState >= 2);
        }
        return snapshot(
          media,
          thumbnail ? 24_000 : 16_000_000,
          thumbnail ? 0.65 : 0.96,
        );
      });
      queue = job.catch(() => {});
      return job;
    },
    dispose() {
      controller.abort();
      media.removeAttribute("src");
      media.load();
      media.remove();
    },
  };
}
