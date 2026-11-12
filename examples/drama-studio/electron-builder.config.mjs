// How the desktop app is packaged and published: `npm run package` locally, and the release
// workflow (.github/workflows/release.yml) for a version tag, which publishes to GitHub
// Releases, where the app looks for updates (desktop/updates.ts).
//
// macOS signing follows what the environment holds. With a Developer ID Application
// certificate (CSC_LINK and CSC_KEY_PASSWORD, or CSC_NAME for one in the keychain) the app is
// signed with the hardened runtime, and with APPLE_API_KEY, APPLE_API_KEY_ID and
// APPLE_API_ISSUER it is notarized too: a downloaded copy opens without a warning and installs
// its own updates. Without a certificate it is signed ad hoc: it runs, a downloaded copy has to
// be allowed once (System Settings → Privacy & Security → Open Anyway), and macOS won't let it
// install an update, so it only says when one is out.
const developerId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);

export default {
  appId: "io.pinecomputer.drama-studio",
  productName: "Pine Drama Studio",
  directories: { output: "release", buildResources: "desktop/assets" },
  files: ["dist/ui/**", "dist/desktop/**", "fixtures/replay/**", "fixtures/rehearsal/**", "package.json"],
  asarUnpack: ["dist/ui/**", "fixtures/replay/**", "fixtures/rehearsal/**"],
  // Read by the updater: an ad-hoc macOS build can't install an update.
  extraMetadata: { distribution: developerId ? "developer-id" : "ad-hoc" },
  mac: {
    category: "public.app-category.video",
    // The zip is what an installed app updates from; the dmg is the first install.
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    // An ad-hoc signature can't carry the hardened runtime: it would reject Electron's own frameworks.
    ...(developerId ? { hardenedRuntime: true } : { identity: "-", hardenedRuntime: false }),
  },
  win: { target: ["nsis"] },
  linux: { target: ["AppImage"], category: "AudioVideo", executableName: "pine-drama-studio" },
  publish: [{ provider: "github", owner: "PineComputer", repo: "open-pinedrama" }],
};
