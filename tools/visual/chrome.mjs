import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A screenshot driver on top of the Chromium build Playwright already cached,
 * spoken to over the DevTools protocol.
 *
 * Why not `npx playwright screenshot`: that CLI can set a colour scheme and
 * load a storage state, but it cannot stop the page's clock — and a dashboard
 * full of "4 minutes ago" labels and a live poll countdown produces a different
 * image every run, which is a visual baseline that fails for reasons nobody
 * changed. Over CDP the clock is frozen before the first script runs, so two
 * runs a week apart produce the same pixels.
 *
 * Why not the Playwright API: it is not a dependency of this project and cannot
 * be imported from the npx cache (see CLAUDE.md). The protocol underneath it is
 * a WebSocket, which this runtime speaks natively.
 */

const CACHE = join(homedir(), ".cache", "ms-playwright");

/** The cached Chromium binaries, newest revision first. */
function findChromium() {
  if (!existsSync(CACHE)) return null;
  const candidates = readdirSync(CACHE)
    .filter((name) => name.startsWith("chromium"))
    .map((name) => {
      const revision = Number.parseInt(name.split("-")[1] ?? "0", 10);
      const headless = join(CACHE, name, "chrome-headless-shell-linux64", "chrome-headless-shell");
      const full = join(CACHE, name, "chrome-linux64", "chrome");
      const legacy = join(CACHE, name, "chrome-linux", "chrome");
      return { revision, path: [headless, full, legacy].find((candidate) => existsSync(candidate)) };
    })
    .filter((candidate) => candidate.path !== undefined)
    .sort((left, right) => right.revision - left.revision);
  return candidates[0]?.path ?? null;
}

/** One CDP connection, with the request/response bookkeeping the protocol needs. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;

    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data));
      const waiter = pending.get(frame.id);
      if (waiter === undefined) return;
      pending.delete(frame.id);
      if (frame.error !== undefined) waiter.reject(new Error(`${frame.error.message} (${frame.method ?? "cdp"})`));
      else waiter.resolve(frame.result);
    });
    socket.addEventListener("error", () => reject(new Error(`cannot reach the browser at ${url}`)));
    socket.addEventListener("open", () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((ok, fail) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, { resolve: ok, reject: fail });
            socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
          }),
        close: () => socket.close(),
      }),
    );
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launches the browser, yields a `shot()` function, and cleans up after itself.
 *
 * `frozenAt` is the epoch millisecond every page believes it is. It is applied
 * with `Page.addScriptToEvaluateOnNewDocument`, so it is in place before the
 * bundle's first line — the dashboard's relative timestamps and its countdown
 * then render the same words forever.
 */
export async function withBrowser(options, body) {
  const binary = findChromium();
  if (binary === null) {
    throw new Error(
      `no cached Chromium under ${CACHE}. Run "npx --yes playwright@latest install chromium" once, then retry.`,
    );
  }

  const profile = await mkdtemp(join(tmpdir(), "isitdown-visual-"));
  const chrome = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      // The page must not be throttled or animated into a different image.
      "--disable-background-timer-throttling",
      "--force-prefers-reduced-motion",
      "--force-device-scale-factor=1",
      "--font-render-hinting=none",
      // Sandbox off: this runs in containers and CI as a non-root user with no
      // user namespaces, where the sandbox cannot start at all. The only page
      // it ever loads is our own server on localhost.
      "--no-sandbox",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const endpoint = await new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("the browser never reported a debugging endpoint")), 30_000);
    chrome.stderr.on("data", (chunk) => {
      buffered += String(chunk);
      const match = /ws:\/\/[^\s]+/.exec(buffered);
      if (match === null) return;
      clearTimeout(timer);
      resolve(match[0]);
    });
    chrome.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the browser exited with code ${code} before it was ready`));
    });
  });

  const browser = await connect(endpoint);

  async function shot({ url, colorScheme, storage, width, height, waitMs = 1200 }) {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => browser.send(method, params, sessionId);

    try {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send("Emulation.setEmulatedMedia", {
        media: "screen",
        features: [
          { name: "prefers-color-scheme", value: colorScheme },
          // The dashboard leans on motion; a baseline has to be of the page at
          // rest, not of whichever frame the capture happened to land on.
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });

      // The clock, and the choices the pre-paint script reads, both before the
      // document exists — the theme is stamped on <html> by an inline script in
      // index.html, so a storage write after load would be a beat too late.
      await send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          const frozen = ${options.frozenAt};
          const RealDate = Date;
          class FrozenDate extends RealDate {
            constructor(...args) {
              super(...(args.length === 0 ? [frozen] : args));
            }
            static now() {
              return frozen;
            }
          }
          globalThis.Date = FrozenDate;
          globalThis.performance.now = () => 0;
          try {
            for (const [key, value] of Object.entries(${JSON.stringify(storage)})) {
              localStorage.setItem(key, value);
            }
          } catch {
            /* a blocked localStorage only costs the pre-paint hint */
          }
        })();`,
      });

      await send("Page.navigate", { url });
      // Chromium's load event fires before the dashboard's own queries land, and
      // the views hold their entry cascade until first data — so the wait is on
      // the app rather than on the network.
      await sleep(waitMs);

      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      return Buffer.from(data, "base64");
    } finally {
      await browser.send("Target.closeTarget", { targetId });
    }
  }

  try {
    return await body({ shot });
  } finally {
    browser.close();
    chrome.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  }
}
