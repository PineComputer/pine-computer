// Makes the customer's voice for `npm run record`: the five lines as clips, generated once with ElevenLabs
// and given the sound of a caller's microphone, so they sit in the call instead of over it.
//   npm run voice [-- --voice <ElevenLabs voice id>] [-- --out recordings/voice] [-- --studio]
//
// Needs ELEVENLABS_API_KEY in .env.local, and ffmpeg. The default voice is "Mark - Natural Conversations"
// from the ElevenLabs voice library. --studio keeps the clean voice, with no call sound.
// The lines are written the way a person talks, and the serial number says its dashes: read without them,
// the PAL heard "AP-34471-9026" and the portal turned the claim down.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Set ELEVENLABS_API_KEY in .env.local");
const voice = arg("voice", "UgBBYS2sOqTuMpoF3BR0");
const out = path.resolve(arg("out", "recordings/voice"));
const studio = process.argv.includes("--studio");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

// In the order scripts/record.mjs says them. The second is only used with --callback.
const LINES = [
  "Hi Riley, um... so, my AeroPure 300, the air purifier? It just won’t turn on anymore. Can you, uh, file a warranty claim for me? I’d like a replacement.",
  "Oh, um, let me go find it. I’ll call you back.",
  "Oh, sure, yeah, hang on... okay, got it. It’s A P 3, dash, four four seven one, dash, nine zero two six.",
  "Yep, that’s all right. Go ahead and submit it.",
  "[laughs softly] Awesome. Thanks, Riley!",
];

// A caller's microphone: a narrower band, some compression, a touch of room, and a little noise under it.
const CALL =
  "[0:a]highpass=f=110,lowpass=f=6800,acompressor=threshold=-20dB:ratio=3:attack=8:release=120,aecho=0.8:0.5:18:0.12,volume=1.4[v];" +
  "[1:a]lowpass=f=3000[n];[v][n]amix=inputs=2:duration=first:normalize=0";

mkdirSync(path.join(out, "raw"), { recursive: true });
for (const [i, text] of LINES.entries()) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v3", voice_settings: { stability: 0.5 } }),
  });
  if (!response.ok) throw new Error(`ElevenLabs: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const raw = path.join(out, "raw", `${i + 1}.mp3`);
  const clip = path.join(out, `${i + 1}.wav`);
  writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
  execFileSync(
    ffmpeg,
    studio
      ? ["-y", "-loglevel", "error", "-i", raw, "-ar", "48000", "-ac", "1", clip]
      : ["-y", "-loglevel", "error", "-i", raw, "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.004", "-filter_complex", CALL, "-ar", "48000", "-ac", "1", clip],
    { stdio: "inherit" },
  );
  console.log(`${i + 1}.wav  ${text}`);
}
console.log(`\nListen to ${out}/raw before a take: every run is a new performance of the same words.`);
