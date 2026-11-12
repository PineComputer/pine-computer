// Updates from the app's GitHub releases (electron-builder.config.mjs, publish), checked when
// the app starts and every hour. A build that can install one (Windows, Linux, and a macOS
// build signed with a Developer ID) downloads it in the background and puts it in place when
// the app quits; a notification says when it's ready, and clicking it restarts into it at once.
// An ad-hoc macOS build can't install an update, so its notification opens the download page
// instead. What the updater does goes to the desktop log (src/engine/log.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { Notification, app, autoUpdater as squirrel, shell } from "electron";
// Named, not the default: bundled, the package's default export is undefined.
import { autoUpdater } from "electron-updater";

/** Where the releases are, for a build that can't install one itself. */
const RELEASES = "https://github.com/PineComputer/open-pinedrama/releases/latest";
const EVERY = 60 * 60 * 1000;

/** Whether this build can put an update in place: macOS only takes one signed with the same Developer ID. */
function canInstall(): boolean {
  if (process.platform !== "darwin") return true;
  const { distribution } = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { distribution?: string };
  return distribution === "developer-id";
}

/** The notification on screen, held so its click still arrives. */
let shown: Notification | undefined;

/** A notification that acts when clicked. Where the system shows none, an update still goes in when the app quits. */
function notify(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  shown = new Notification({ title, body });
  shown.on("click", onClick);
  shown.show();
}

export function keepUpdated(): void {
  if (!app.isPackaged) return;
  const installs = canInstall();
  autoUpdater.logger = console;
  autoUpdater.autoDownload = installs;
  autoUpdater.autoInstallOnAppQuit = installs;
  // Its logger has it already; an "error" event without a listener would throw.
  autoUpdater.on("error", () => undefined);
  // An hourly check finds the same version again: each one is offered once a launch.
  const offered = new Set<string>();
  const once = (version: string, offer: () => void) => {
    if (offered.has(version)) return;
    offered.add(version);
    offer();
  };
  if (installs) {
    const ready = (version: string) =>
      once(version, () =>
        notify(`Pine Drama Studio ${version} is ready`, "It's put in place when you quit. Click to restart into it now.", () => autoUpdater.quitAndInstall()),
      );
    let downloaded = "";
    autoUpdater.on("update-downloaded", (info) => {
      downloaded = info.version;
      if (process.platform !== "darwin") ready(info.version);
    });
    // On macOS it's ready only once Squirrel has staged it, which follows electron-updater's download.
    if (process.platform === "darwin") squirrel.on("update-downloaded", () => ready(downloaded));
  } else {
    autoUpdater.on("update-available", (info) =>
      once(info.version, () =>
        notify(`Pine Drama Studio ${info.version} is out`, "This copy can't update itself. Click to download the new version.", () => void shell.openExternal(RELEASES)),
      ),
    );
  }
  // A failed check or download is in the log; the next check comes in an hour. The download is a
  // promise of its own, which would otherwise go unhandled when it fails.
  const check = () =>
    void autoUpdater
      .checkForUpdates()
      .then((result) => result?.downloadPromise)
      .catch(() => undefined);
  check();
  setInterval(check, EVERY);
}
