// The desktop app: Electron around the same engine and UI. The engine runs in a utility
// process on a free port with a token made for this launch; the window comes in through
// the engine's own link, so nothing else on the machine can use the studio. The data
// folder is the one the engine always uses (src/engine/config.ts); Chromium's files go in
// a "browser" folder inside it. On Windows the sealing key is kept with safeStorage; on
// macOS and Linux the engine keeps it in the Keychain or Secret Service itself.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type UtilityProcess, BrowserWindow, app, dialog, safeStorage, shell, utilityProcess } from "electron";
import { DATA_DIR } from "../src/engine/config.ts";
import { keepLog } from "../src/engine/log.ts";
import { keepUpdated } from "./updates.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAPER = "#f7f4ef";

app.setPath("userData", path.join(DATA_DIR, "browser"));
keepLog("desktop");

let engine: UtilityProcess | undefined;
let origin: string | undefined;
let window: BrowserWindow | undefined;
let quitting = false;

/** The built UI and the replay's recordings: unpacked next to the app's archive once packaged. */
function resources(): string {
  return app.isPackaged ? app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked") : path.resolve(HERE, "..", "..");
}

/** Windows has no store the engine can reach on its own, so the key lives here, sealed by the OS for this user. */
function windowsSealingKey(): string | undefined {
  if (process.platform !== "win32" || !safeStorage.isEncryptionAvailable()) return undefined;
  const sealed = path.join(DATA_DIR, "sealing-key.bin");
  if (existsSync(sealed)) return safeStorage.decryptString(readFileSync(sealed));
  // A key from the engine's file fallback moves here, so the folder alone opens nothing.
  const plain = path.join(DATA_DIR, "secret.key");
  const key = existsSync(plain) ? readFileSync(plain, "utf8").trim() : randomBytes(32).toString("base64");
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(sealed, safeStorage.encryptString(key));
  rmSync(plain, { force: true });
  return key;
}

/** Starts the engine and resolves with the link that lets a window in. */
function startEngine(): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const secret = windowsSealingKey();
  const child = utilityProcess.fork(path.join(HERE, "engine.mjs"), [], {
    serviceName: "Pine Drama Studio engine",
    stdio: "pipe",
    env: {
      ...process.env,
      STUDIO_PORT: "0",
      STUDIO_TOKEN: token,
      STUDIO_RESOURCES: resources(),
      ...(secret ? { STUDIO_SECRET: secret } : {}),
    },
  });
  engine = child;
  let said = "";
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => {
    said += chunk.toString();
    process.stderr.write(chunk);
  });
  return new Promise((resolve, reject) => {
    child.on("message", (message: { type?: string; port?: number }) => {
      if (message.type !== "ready") return;
      origin = `http://127.0.0.1:${message.port}`;
      resolve(`${origin}/api/open?ticket=${token}`);
    });
    child.on("exit", (code) => {
      if (engine === child) engine = undefined;
      reject(new Error(said.trim().split("\n").filter((line) => !line.includes("ExperimentalWarning")).pop() || `The engine stopped (${code}).`));
      if (!quitting && origin) void engineStopped();
    });
  });
}

/** The engine went away while the window was open: say so, and start it again if the maker wants. */
async function engineStopped(): Promise<void> {
  origin = undefined;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: "The studio's engine stopped.",
    detail: "Your dramas are saved. Start it again to carry on; Computers still at work are picked up where they are.",
    buttons: ["Start again", "Quit"],
  });
  if (response === 1) return app.quit();
  await open();
}

async function open(): Promise<void> {
  let link: string;
  try {
    link = await startEngine();
  } catch (error) {
    dialog.showErrorBox("Pine Drama Studio couldn't start", (error as Error).message);
    app.quit();
    return;
  }
  if (window && !window.isDestroyed()) {
    await window.loadURL(link);
    return;
  }
  window = createWindow();
  await window.loadURL(link);
}

/**
 * A copy run from its disk image, or from Downloads (which macOS runs from a read-only place),
 * can't put an update in place. Before anything starts, offer to move it to Applications;
 * true when it moved, and this copy is quitting for the one there.
 */
async function movedToApplications(): Promise<boolean> {
  if (process.platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) return false;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: "Move Pine Drama Studio to Applications?",
    detail: "It updates itself reliably only from there.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return false;
  try {
    return app.moveToApplicationsFolder();
  } catch (error) {
    console.warn("move to Applications:", (error as Error).message);
    return false;
  }
}

function createWindow(): BrowserWindow {
  const mac = process.platform === "darwin";
  const created = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: PAPER,
    title: "Pine Drama Studio",
    // On macOS the studio's own bar is the title bar, with the window buttons inside it.
    titleBarStyle: mac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  created.once("ready-to-show", () => created.show());
  created.webContents.on("dom-ready", () => {
    void created.webContents.executeJavaScript(`document.documentElement.dataset.shell = ${JSON.stringify(process.platform)}`);
  });
  // The studio's files open in a window of their own; anything else opens in the maker's browser.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (origin && url.startsWith(origin)) return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#15120f", autoHideMenuBar: true } };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  created.webContents.on("will-navigate", (event, url) => {
    if (origin && url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // The page's title carries the number of reviews waiting: it becomes the dock badge.
  created.on("page-title-updated", (_event, title) => {
    app.setBadgeCount(Number(title.match(/^\((\d+)\)/)?.[1] ?? 0));
  });
  created.on("closed", () => {
    if (window === created) window = undefined;
  });
  return created;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    if (await movedToApplications()) return;
    await open();
    keepUpdated();
  });
  // On macOS the studio keeps running with its window closed, so the line keeps going.
  app.on("activate", () => {
    if (window || !origin) return;
    window = createWindow();
    void window.loadURL(origin);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    quitting = true;
    engine?.kill();
  });
}
