import assert from "node:assert/strict";

export async function runStorageRegression(browser, { baseURL, videoPath }) {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    await first.goto(baseURL);
    await first.waitForFunction(() => !document.querySelector("main").inert);
    await first.locator("#file-input").setInputFiles(videoPath);
    await first.waitForFunction(
      () => !document.querySelector("#capture").disabled,
    );
    await first.locator("#capture").click();
    await first.waitForFunction(
      () =>
        document.querySelectorAll(".cell img").length === 1 &&
        document.querySelector("#autosave-status").textContent ===
          "Saved on this device",
    );
    const second = await context.newPage();
    await second.goto(baseURL);
    await second.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(
      await second.locator(".cell img").count(),
      1,
      "new tab recovers latest draft",
    );
    await second.locator("#new-sheet").click();
    await second.waitForFunction(
      () =>
        document.querySelector("#autosave-status").textContent ===
        "Saved on this device",
    );
    await first.reload();
    await first.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(
      await first.locator(".cell img").count(),
      1,
      "other tab must not overwrite this tab’s draft",
    );
    await second.reload();
    await second.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await second.locator(".cell img").count(), 0);
    await first.evaluate(() => {
      IDBObjectStore.prototype.put = () => {
        throw new DOMException(
          "Simulated quota exhaustion",
          "QuotaExceededError",
        );
      };
    });
    await first.locator("#columns").fill("4");
    await first.locator("#columns").press("Tab");
    await first.waitForFunction(() =>
      document
        .querySelector("#autosave-status")
        .textContent.includes("Not autosaved"),
    );
    assert.equal(
      await first.locator(".cell img").count(),
      1,
      "quota errors must not erase the live sheet",
    );
    first.on("dialog", (dialog) => dialog.accept());
    await first.reload();
    await first.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(
      await first.locator("#columns").inputValue(),
      "3",
      "previous committed draft survives a failed write",
    );
    assert.equal(await first.locator(".cell img").count(), 1);
  } finally {
    await context.close();
  }
  const blocked = await browser.newContext();
  try {
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        value: {
          open() {
            throw new Error("Simulated blocked storage");
          },
        },
      });
    });
    const page = await blocked.newPage();
    await page.goto(baseURL);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.match(
      await page.locator("#autosave-status").innerText(),
      /Recovery unavailable/,
    );
    await page.locator("#file-input").setInputFiles(videoPath);
    await page.waitForFunction(
      () => !document.querySelector("#capture").disabled,
    );
    await page.locator("#capture").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".cell img").length === 1 &&
        document
          .querySelector("#autosave-status")
          .textContent.includes("Not autosaved"),
    );
    assert.equal(
      await page.locator("#export").isEnabled(),
      true,
      "manual export still works when browser storage is blocked",
    );
    return {
      passed: [
        "per-tab draft isolation",
        "latest draft recovery in a new tab",
        "quota failure reporting",
        "last good draft survives a failed write",
        "editing/export available with blocked storage",
      ],
    };
  } finally {
    await blocked.close();
  }
}

// Pass an existing Playwright Browser. Tests use an isolated context, never the
// user's open sheet. No real clipboard contents are read or overwritten.
export async function runRegression(
  browser,
  { baseURL, videoPath, artifactDirectory },
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const exceptions = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  const saved = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#autosave-status").textContent ===
        "Saved on this device",
    );
  const count = () => page.locator(".cell img").count();
  const capture = async (expected) => {
    await page.locator("#capture").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".cell img").length === n,
      expected,
    );
  };
  try {
    await page.goto(baseURL);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator("#file-input").setInputFiles(videoPath);
    await page.waitForFunction(
      () => !document.querySelector("#capture").disabled,
    );
    await page.waitForFunction(
      () => document.querySelectorAll("#filmstrip img").length === 8,
    );
    const duration = await page.locator("#video").evaluate((v) => v.duration);
    await page.locator("#timeline-zoom").selectOption("8");
    await page.waitForFunction(
      () => document.querySelectorAll("#filmstrip img").length === 8,
    );
    const bounds = await page
      .locator("#timeline")
      .evaluate((el) => [Number(el.min), Number(el.max)]);
    assert.ok(Math.abs(bounds[1] - bounds[0] - duration / 8) < 0.01);
    await page.locator("#pan-right").click();
    assert.ok(
      Number(await page.locator("#timeline").getAttribute("min")) > bounds[0],
    );
    await page.locator("#timeline").click({ position: { x: 60, y: 3 } });
    await page.keyboard.press("c");
    await page.waitForFunction(
      () => document.querySelectorAll(".cell img").length === 1,
    );
    assert.equal(
      await page
        .locator("#timeline")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    const firstFrame = await page
      .locator(".cell img")
      .first()
      .getAttribute("src");
    await page.locator("#video-url").focus();
    await page.keyboard.press("c");
    assert.equal(await count(), 1);
    assert.equal(await page.locator("#video-url").inputValue(), "c");

    await page.locator("#keep-rolling").check();
    await page.locator("#sound").uncheck();
    await page.locator("#play").click();
    await capture(2);
    assert.equal(
      await page.locator("#video").evaluate((v) => v.paused),
      false,
      "capture must keep playback running",
    );
    await page.locator("#play").click();
    await page.locator("#keep-rolling").uncheck();
    await page.locator("#capture-target").selectOption("tray");
    await page.locator("#capture").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".tray-card").length === 1,
    );
    assert.equal(await count(), 2);
    await page.locator(".cell").nth(0).click();
    await page.locator(".tray-frame").click();
    assert.equal(await page.locator(".tray-card").count(), 1);
    assert.equal(
      await page.locator(".tray-frame img").getAttribute("src"),
      firstFrame,
      "replacement returns to tray",
    );
    await page.locator("#undo").click();
    assert.equal(
      await page.locator(".cell img").first().getAttribute("src"),
      firstFrame,
    );
    await page.locator(".tray-frame").dragTo(page.locator(".cell").nth(4));
    assert.equal(await count(), 3);
    assert.equal(await page.locator(".tray-card").count(), 0);
    await page.locator(".cell").nth(4).click();
    await page.locator("#stash").click();
    assert.equal(await count(), 2);
    assert.equal(await page.locator(".tray-card").count(), 1);

    await page.locator("#capture-target").selectOption("sheet");
    const playhead = await page
      .locator("#video")
      .evaluate((v) => v.currentTime);
    const range = await page
      .locator("#timeline")
      .evaluate((el) => [Number(el.min), Number(el.max)]);
    await page.locator("#seed").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".cell img").length === 12,
    );
    assert.equal(
      await page.locator(".cell img").first().getAttribute("src"),
      firstFrame,
    );
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      playhead,
      "sampling must not move the visible player",
    );
    assert.equal(
      await page.locator("#shrub-pal").getAttribute("data-mood"),
      "3",
    );
    const seededLabels = await page
      .locator(".cell")
      .evaluateAll((els) =>
        els.slice(2).map((el) => el.getAttribute("aria-label")),
      );
    assert.equal(seededLabels.length, 10);
    const projectDownload = page.waitForEvent("download");
    await page.locator("#save-project").click();
    const project = await projectDownload;
    const stream = await project.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const projectBuffer = Buffer.concat(chunks);
    const projectData = JSON.parse(projectBuffer.toString());
    for (const frame of projectData.cells.slice(2))
      assert.ok(frame.time >= range[0] && frame.time <= range[1]);
    assert.equal(projectData.tray.length, 1);
    await page.locator("#undo").click();
    assert.equal(await count(), 2, "one undo removes the whole seed operation");

    // Intercept the API boundary, checking an actual encoded PNG without
    // changing the host computer's clipboard.
    await page.evaluate(() => {
      navigator.clipboard.write = async (items) => {
        const blob = await items[0].getType("image/png");
        const image = await createImageBitmap(blob);
        window.copiedImage = {
          width: image.width,
          height: image.height,
          type: blob.type,
        };
        image.close();
      };
    });
    await page.locator("#copy-sheet").click();
    await page.waitForFunction(() => window.copiedImage);
    assert.deepEqual(await page.evaluate(() => window.copiedImage), {
      width: 1920,
      height: 1440,
      type: "image/png",
    });
    await page.evaluate(() => {
      navigator.clipboard.write = async () => {
        throw new DOMException("Test denied", "NotAllowedError");
      };
    });
    await page.locator("#copy-sheet").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#notice")
        .textContent.includes("clipboard access is blocked"),
    );

    await saved();
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await count(), 2);
    assert.equal(await page.locator(".tray-card").count(), 1);
    assert.equal(await page.locator("#export").isEnabled(), true);
    assert.equal(await page.locator("#capture").isEnabled(), false);
    assert.equal(await page.locator("#timeline-zoom").inputValue(), "8");
    await page.locator("#file-input").setInputFiles(videoPath);
    await page.waitForFunction(
      () =>
        !document.querySelector("#capture").disabled &&
        !document.querySelector("#video").seeking,
    );
    assert.ok(
      Math.abs(
        (await page.locator("#video").evaluate((v) => v.currentTime)) -
          playhead,
      ) < 0.1,
      "reattachment resumes the saved time",
    );

    await page.locator("#project-input").setInputFiles({
      name: "roundtrip.scrubsheet",
      mimeType: "application/json",
      buffer: projectBuffer,
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".cell img").length === 12,
    );
    assert.equal(await page.locator(".tray-card").count(), 1);
    await page.locator("#new-sheet").click();
    assert.equal(await count(), 0);
    assert.equal(await page.locator(".tray-card").count(), 0);
    await page.locator("#undo").click();
    assert.equal(await count(), 12);
    assert.equal(await page.locator(".tray-card").count(), 1);

    // Legacy project compatibility, then cancellation before any seed is committed.
    projectData.version = 1;
    delete projectData.tray;
    projectData.cells = projectData.cells.map((cell, i) =>
      i === 0 ? cell : null,
    );
    await page.locator("#project-input").setInputFiles({
      name: "legacy.scrubsheet",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(projectData)),
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".cell img").length === 1,
    );
    assert.equal(await page.locator(".tray-card").count(), 0);
    await page.evaluate(() => {
      document.querySelector("#seed").click();
      document.querySelector("#cancel-seed").click();
    });
    assert.equal(await count(), 1);
    assert.equal(await page.locator("#cancel-seed").isVisible(), false);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "mobile overflow",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator("#shrub-pal")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    if (artifactDirectory)
      await page.screenshot({
        path: `${artifactDirectory}/improvements-mobile.png`,
        fullPage: true,
      });
    assert.deepEqual(exceptions, []);
    return {
      passed: [
        "filmstrip and zoom/pan",
        "focused scrubber capture",
        "text input isolation",
        "keep rolling",
        "tray capture/replace/drag/stash/undo",
        "non-destructive range seeding and batch undo",
        "clipboard PNG encoding and denied-permission fallback",
        "autosave recovery and video reattachment",
        "v2 project roundtrip",
        "v1 project import",
        "new sheet undo",
        "cancel seeding",
        "mobile layout",
        "reduced motion",
      ],
      exceptions,
    };
  } finally {
    await context.close();
  }
}
