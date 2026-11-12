// Checks a draft release before it's published (.github/workflows/release.yml). It must hold
// every platform's update manifest for this version; each file a manifest names must be in
// the release with the size and SHA-512 the manifest gives; and both kinds of Mac must have a
// disk image to install from the first time. Installed apps update from the manifests, so a
// release that would send them to a missing or different file isn't published.
//
//   GH_TOKEN=… node scripts/verify-release.mjs v0.2.0
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: node scripts/verify-release.mjs v<version>");
  process.exit(2);
}
const version = tag.slice(1);
const repo = process.env.GITHUB_REPOSITORY || "PineComputer/open-pinedrama";

/** Each platform's manifest, and the files it must offer: each kind of Mac updates from a zip of its own. */
const MANIFESTS = {
  "latest.yml": [`-Setup-${version}.exe`],
  "latest-mac.yml": [`-${version}-arm64-mac.zip`, `-${version}-mac.zip`],
  "latest-linux.yml": [`-${version}.AppImage`],
};
/** What a first install on each kind of Mac downloads. */
const INSTALLERS = [`-${version}-arm64.dmg`, `-${version}.dmg`];

const releases = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/releases`, "--paginate", "--slurp"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).flat();
const release = releases.find((entry) => entry.tag_name === tag);
if (!release?.draft) {
  console.error(release ? `${tag} is published already.` : `There's no release ${tag}.`);
  process.exit(1);
}
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
const scratch = mkdtempSync(path.join(tmpdir(), "release-"));

function download(asset) {
  const file = path.join(scratch, asset.name);
  const out = openSync(file, "w");
  const result = spawnSync("gh", ["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${asset.id}`], { stdio: ["ignore", out, "inherit"] });
  closeSync(out);
  if (result.status !== 0) throw new Error(`Couldn't download ${asset.name}.`);
  return file;
}

async function sha512(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}

const problems = [];
try {
  for (const [name, offered] of Object.entries(MANIFESTS)) {
    const asset = assets.get(name);
    if (!asset) {
      problems.push(`${name} is missing.`);
      continue;
    }
    const manifest = yaml.load(readFileSync(download(asset), "utf8"));
    if (String(manifest.version) !== version) problems.push(`${name} is for ${manifest.version}, not ${version}.`);
    const files = manifest.files ?? [];
    for (const ending of offered) if (!files.some((file) => file.url.endsWith(ending))) problems.push(`${name} offers no …${ending}.`);
    for (const file of files) {
      const payload = assets.get(file.url);
      if (!payload) problems.push(`${name} names ${file.url}, which isn't in the release.`);
      else if (payload.size !== file.size) problems.push(`${file.url} is ${payload.size} bytes; ${name} says ${file.size}.`);
      else if ((await sha512(download(payload))) !== file.sha512) problems.push(`${file.url} doesn't match the SHA-512 ${name} gives.`);
      else console.log(`${name}: ${file.url} matches.`);
    }
  }
  for (const ending of INSTALLERS) if (![...assets.keys()].some((name) => name.endsWith(ending))) problems.push(`There's no …${ending} to install from.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(`${tag}: every manifest, update and installer is in place.`);
