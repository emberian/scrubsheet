import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runRegression, runStorageRegression } from "./browser-regression.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const videoPath = process.argv[2] || process.env.SCRUBSHEET_TEST_VIDEO;
if (!videoPath)
  throw new Error("Pass a local video: npm test -- /path/to/video.mp4");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = resolve(
      root,
      `.${decodeURIComponent(path === "/" ? "/index.html" : path)}`,
    );
    if (!file.startsWith(resolve(root) + sep) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      types[extname(file)] || "application/octet-stream",
    );
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.SCRUBSHEET_TEST_BROWSER || "chrome",
    headless: true,
  });
  const artifactDirectory = resolve(root, ".artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const result = await runRegression(browser, {
    baseURL: `http://127.0.0.1:${server.address().port}/`,
    videoPath: resolve(videoPath),
    artifactDirectory,
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      await runStorageRegression(browser, {
        baseURL: `http://127.0.0.1:${server.address().port}/`,
        videoPath: resolve(videoPath),
      }),
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
