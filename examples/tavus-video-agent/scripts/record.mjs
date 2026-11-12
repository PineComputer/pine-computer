// Records the whole demo as one take, for a showcase film: the page at twice its size, with the call's sound.
// The customer is a voice from files: each line is played into the call as the microphone, so the PAL hears it
// and answers it, and the same sound goes onto the recording.
//   npm run dev   (in another terminal)
//   npm run record [-- --voices recordings/voice] [-- --out recordings/take.mp4] [-- --callback] [-- --hold 6]
//
// --voices is a folder with 1.wav … 5.wav, the customer's lines in order (LINES below), made before the take.
// Without it, the system voice reads them, which is only good enough to check the take's timing.
// --callback has the customer hang up to find the serial number and call back (line 2); without it the whole
// claim is one call. --hold is how long the customer stays away, in seconds.
//
// How it works: Chrome hands this script every frame it paints, and ffmpeg encodes them as they come. The sound
// is mixed inside the call's own frame: the PAL's voice as the call receives it, and the customer's lines as
// they are played into the microphone. Nothing is captured from the screen or the speakers, so the take needs
// no screen-recording permission and the machine stays silent. ffmpeg joins picture and sound at the end.

import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const app = process.env.DEMO_URL ?? "http://127.0.0.1:3100";
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SERIAL = "AP3-4471-9026";
const LINES = [
  "Hi Riley, um... so, my AeroPure 300, the air purifier? It just won't turn on anymore. Can you, uh, file a warranty claim for me? I'd like a replacement.",
  "Oh, um, let me go find it. I'll call you back.",
  `Oh, sure, yeah, hang on... okay, got it. It's ${SERIAL.split("").join(" ").replaceAll(" - ", ", ")}.`,
  "Yep, that's all right. Go ahead and submit it.",
  "Awesome. Thanks, Riley!",
];
const out = path.resolve(arg("out", `recordings/take-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.mp4`));
const parts = out.replace(/\.mp4$/, "");
const hold = Number(arg("hold", "6"));
const callback = process.argv.includes("--callback");
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The five lines as WAV files: the given folder's, or the system voice's as a stand-in. */
function voices() {
  const given = arg("voices", "");
  if (given) {
    const files = LINES.map((_, i) => path.resolve(given, `${i + 1}.wav`));
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length) throw new Error(`Missing voice files: ${missing.join(", ")}`);
    return files;
  }
  const dir = path.resolve("recordings/voice-standin");
  mkdirSync(dir, { recursive: true });
  return LINES.map((line, i) => {
    const file = path.join(dir, `${i + 1}.wav`);
    execFileSync("say", ["-v", "Samantha", "-o", file, "--data-format=LEI16@48000", line]);
    return file;
  });
}

/** Runs in every frame before its own scripts. */
function inFrame() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx, mic, tape;
  const audio = () => {
    if (!ctx) {
      ctx = new AC({ sampleRate: 48000 });
      mic = ctx.createMediaStreamDestination();
      tape = ctx.createMediaStreamDestination();
    }
    void ctx.resume();
    return ctx;
  };

  // The microphone is the stream the lines are played into.
  const real = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (real) {
    navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
      if (!constraints.audio) return real(constraints);
      audio();
      const stream = new MediaStream(mic.stream.getAudioTracks().map((t) => t.clone()));
      if (constraints.video) (await real({ video: constraints.video })).getVideoTracks().forEach((t) => stream.addTrack(t));
      window.__micUsed = true;
      return stream;
    };
  }

  // Says a line: into the call, and onto the tape. Resolves when it has been said.
  window.__say = async (base64) => {
    const c = audio();
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const buffer = await c.decodeAudioData(bytes.buffer);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(mic);
    source.connect(tape);
    source.start();
    await new Promise((done) => (source.onended = done));
    return buffer.duration;
  };

  // How loud the other side is right now (0–1), from the audio the call receives. The same audio goes on the tape.
  const analysers = [];
  const RTC = window.RTCPeerConnection;
  if (RTC) {
    window.RTCPeerConnection = function (...args) {
      const pc = new RTC(...args);
      pc.addEventListener("track", (e) => {
        if (e.track.kind !== "audio") return;
        const c = audio();
        const analyser = c.createAnalyser();
        analyser.fftSize = 1024;
        const heard = c.createMediaStreamSource(new MediaStream([e.track]));
        heard.connect(analyser);
        heard.connect(tape);
        analysers.push(analyser);
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = RTC.prototype;
    Object.setPrototypeOf(window.RTCPeerConnection, RTC);
  }
  window.__heard = () => analysers.length;
  window.__level = () => {
    let peak = 0;
    for (const a of analysers) {
      const data = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      peak = Math.max(peak, Math.sqrt(sum / data.length));
    }
    return peak;
  };

  // The tape: both voices, recorded here and handed out a second at a time. Resolves with the time it started.
  window.__startTape = () =>
    new Promise((started) => {
      audio();
      const recorder = new MediaRecorder(tape.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192_000 });
      let sent = Promise.resolve();
      recorder.ondataavailable = (e) => {
        sent = sent.then(async () => {
          const bytes = new Uint8Array(await e.data.arrayBuffer());
          let s = "";
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          await window.__tape(btoa(s));
        });
      };
      recorder.onstart = () => started(Date.now());
      window.__stopTape = () => new Promise((done) => ((recorder.onstop = () => sent.then(done)), recorder.stop()));
      recorder.start(1000);
    });
}

const clips = voices().map((f) => readFileSync(f).toString("base64"));
mkdirSync(path.dirname(out), { recursive: true });

if (!(await fetch(`${app}/api/state`).then((r) => r.ok, () => false))) throw new Error(`The demo isn't running at ${app}: npm run dev`);
const post = (url, body) => fetch(`${app}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
await post("/api/reset", {});
// The Computer is up before the take starts, so the film opens on its screen and not on a wait.
await post("/api/computer", { action: "prepare" });

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--use-fake-ui-for-media-stream", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--window-size=1600,1000", "--hide-scrollbars"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, permissions: ["microphone", "camera"] });
await context.addInitScript(inFrame);
const page = await context.newPage();
const tapes = []; // one per call: { file, at }
await page.exposeFunction("__tape", (base64) => appendFileSync(tapes.at(-1).file, Buffer.from(base64, "base64")));
// ?film: the page without its operator's controls, and the call as a picture instead of a call window.
await page.goto(`${app}/?film`, { waitUntil: "networkidle" });

const state = () => fetch(`${app}/api/state`).then((r) => r.json());
const until = async (what, test, seconds = 240) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const s = await state();
    if (test(s)) return s;
    if (s.claim?.state === "failed" || s.claim?.state === "stopped") throw new Error(`The claim ${s.claim.state} while waiting for: ${what}`);
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    // A call that ends by itself (Tavus out of credit, a dropped line) ends the take at once.
    if (call && !(await page.evaluate(() => Boolean(document.querySelector(".film-call"))))) throw new Error(`The call ended on its own while waiting for: ${what}`);
    await sleep(500);
  }
};

/** The frame the call runs in: the one that asked for the microphone. */
async function callFrame() {
  for (const f of page.frames()) {
    if (await f.evaluate(() => Boolean(window.__micUsed)).catch(() => false)) return f;
  }
  return undefined;
}
let call;
const level = async () => (await call?.evaluate(() => window.__level?.() ?? 0).catch(() => 0)) ?? 0;

/** Waits until the PAL has spoken and then been quiet for a moment. `first` waits for her to start. */
async function palDone({ first = true, quiet = 1100, seconds = 60 } = {}) {
  const end = Date.now() + seconds * 1000;
  let spoke = !first;
  let quietSince = 0;
  while (Date.now() < end) {
    if (!(await page.evaluate(() => Boolean(document.querySelector(".film-call"))))) throw new Error("The call ended on its own");
    const loud = (await level()) > 0.01;
    if (loud) {
      spoke = true;
      quietSince = 0;
    } else if (spoke) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince > quiet) return true;
    }
    await sleep(120);
  }
  log("(the PAL was not heard in time)");
  return false;
}

/**
 * Waits until the PAL has told the customer the Computer's nth message, and has finished saying it. A line said
 * before then answers a question the PAL has not asked yet.
 */
async function palRelayed(n, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  const told = () =>
    page.evaluate((nth) => {
      const lines = [...document.querySelectorAll("ol.transcript li")].map((li) => li.textContent ?? "");
      let relays = 0;
      const at = lines.findIndex((l) => l.startsWith("Relay") && ++relays === nth);
      return at >= 0 && lines.slice(at + 1).some((l) => l.startsWith("PAL") && l.length > 3);
    }, n);
  while (!(await told())) {
    if (Date.now() > end) return log("(the PAL did not pass the message on in time)");
    await sleep(200);
  }
  await sleep(400);
  await palDone({ first: false, seconds: 40 });
}

async function say(n) {
  log(`customer: ${LINES[n]}`);
  await call.evaluate((clip) => window.__say(clip), clips[n]);
}

async function join(label) {
  await page.evaluate(() => window.__demo.start());
  for (let i = 0; i < 40 && !(call = await callFrame()); i++) await sleep(250);
  if (!call) throw new Error("The call never asked for the microphone");
  const file = `${parts}.voice-${tapes.length + 1}.webm`;
  writeFileSync(file, "");
  tapes.push({ file, at: 0 });
  tapes.at(-1).at = await call.evaluate(() => window.__startTape());
  log(`${label}: joined, microphone on, tape running`);
}

/** Ends the call. The tape stops first: its frame goes away with the call. */
async function hangUp() {
  await call?.evaluate(() => window.__stopTape?.()).catch(() => undefined);
  call = undefined;
  await page.evaluate(() => window.__demo.end());
}

// The picture: every frame Chrome paints, encoded as it arrives and stamped with the time it arrived.
const picture = `${parts}.picture.mkv`;
const encoder = spawn(
  ffmpeg,
  ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-use_wallclock_as_timestamps", "1", "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", picture],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const encoded = new Promise((done) => encoder.on("close", done));
const cdp = await context.newCDPSession(page);
let frames = 0;
let pictureAt = 0;
cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
  pictureAt ||= Date.now();
  frames += 1;
  encoder.stdin.write(Buffer.from(data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
log(`recording → ${out}`);
await sleep(1500);

try {
  // The call: the customer asks, the PAL starts the claim.
  await join("Start the call");
  await palDone({ seconds: 40 });
  await say(0);
  await until("the claim to start", (s) => s.claim);
  log("the claim has started");

  // The Computer needs the serial number. With --callback the customer hangs up to find it and calls back.
  await until("the question about the serial number", (s) => s.claim?.state === "needs_input" && s.claim.questionKind !== "approval");
  log("the Computer asked for the serial number");
  await palRelayed(1);
  if (callback) {
    await say(1);
    await palDone({ seconds: 30 });
    await hangUp();
    log(`hung up; away for ${hold} s`);
    await sleep(hold * 1000);
    await join("Call back");
    await palDone({ seconds: 40 });
  }

  // The number, then a yes.
  await say(2);
  await until("the claim ready for approval", (s) => s.claim?.state === "needs_input" && s.claim.questionKind === "approval");
  log("the claim is on the review page");
  await palRelayed(callback ? 1 : 2);
  await say(3);
  const done = await until("the claim submitted", (s) => s.claim?.state === "done");
  log(`claim ${done.claim.claimNumber}${done.claim.verified ? ", confirmed in the portal's records" : ""}`);
  await palRelayed(callback ? 2 : 3);
  await say(4);
  await palDone({ seconds: 15 });
  await sleep(2000);
} finally {
  await hangUp().catch(() => undefined);
  await sleep(1500);
  await cdp.send("Page.stopScreencast").catch(() => undefined);
  encoder.stdin.end();
  await encoded;
  await browser.close();
  log(`${frames} frames, ${(frames / ((Date.now() - pictureAt) / 1000)).toFixed(1)} a second on average`);

  // Picture and sound together: each call's tape starts where its call started.
  const heard = tapes.filter((t) => t.at);
  if (heard.length) {
    const delayed = heard.map((t, i) => `[${i + 1}:a]adelay=${Math.max(0, t.at - pictureAt)}:all=1[a${i}]`);
    const mix = `${heard.map((_, i) => `[a${i}]`).join("")}amix=inputs=${heard.length}:normalize=0[a]`;
    execFileSync(
      ffmpeg,
      ["-y", "-loglevel", "error", "-i", picture, ...heard.flatMap((t) => ["-i", t.file]), "-filter_complex", [...delayed, mix].join(";"),
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out],
      { stdio: "inherit" },
    );
    log(`saved ${out}`);
  } else log(`no sound was recorded; the picture is ${picture}`);
}
