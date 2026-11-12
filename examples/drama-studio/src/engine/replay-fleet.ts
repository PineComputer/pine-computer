// The Fleet in replay mode: a recording of the drama skill's stops, played through the
// same calls as Pine, with placeholder files. It is not a simulated agent: each run or
// answer plays the next recorded turn, and an answer that asks for revisions replays the
// redraw of what it names. It lives in memory, so a restarted engine finds its Computers
// gone, as it would after a real stop.
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURES } from "./config.ts";
import { revisedKeys } from "./decisions.ts";
import { DRAMA_SKILL } from "./goals.ts";
import type { Attached, ComputerRef, Fleet, FleetEvent, Limits, SessionRef, TurnFile, TurnInfo } from "./fleet.ts";
import { blocking, lookSheet, plate, prop, storyboard } from "./placeholders.ts";

const SPEED = Number(process.env.STUDIO_REPLAY_SPEED ?? 1);

interface Out {
  path: string;
  type: string;
  bytes: Uint8Array;
}

interface Step {
  progress: string[];
  files: Out[];
  ask?: string;
  summary?: string;
}

interface Turn {
  info: TurnInfo;
  waiters: (() => void)[];
}

interface Session {
  name: string;
  token: string;
  taskId: string;
  turns: Map<string, Turn>;
  latest?: string;
  keys: Map<string, string>;
  events: FleetEvent[];
  files: Map<string, Out>;
  play?: Player;
  lang?: Lang;
}

interface Machine {
  state: string;
  sessions: Map<string, Session>;
}

/** What a script does next, given the maker's answer (empty for the first turn). */
type Player = (answer: string) => Step;

const text = (s: string) => new TextEncoder().encode(s);
const svg = (p: string, body: string): Out => ({ path: p, type: "image/svg+xml", bytes: text(body) });
const video = (p: string, name: "take" | "cut"): Out => ({ path: p, type: "video/mp4", bytes: readFileSync(path.join(FIXTURES, `${name}.mp4`)) });

type Lang = "zh" | "en";

/** The drama's language, from the goal's brief ("Language: Chinese."), as the real agent would read it. */
function languageOf(goal: string): Lang {
  return /summaries in Chinese/i.test(goal) ? "zh" : "en";
}

/** Everything the recorded agent says, in both languages. */
const WORDS = {
  en: {
    cast: [
      { id: "lin", name: "Lin Xiaoyu" },
      { id: "wei", name: "Wei Zhen" },
    ],
    shots: [
      ["Lin enters the yard", "Wei: You're late.", "Lin hides the letter", "Close on the torn letter", "Wei turns away", "Lin alone"],
      ["The family at dinner", "Mother: Eat.", "Lin watches Wei", "Wei pushes the bowl away"],
      ["Night, the yard", "Lin reads the letter", "Wei at the window", "Their eyes meet", "Lin burns the letter"],
    ],
    episodes: ["The stepmother arrives", "The letter", "Dinner", "The wedding dress", "Night market", "The truth"],
    reading: ["Reading the screenplay and the notes", "Checking every character's age and gender"],
    askAge: "The screenplay doesn't give Wei Zhen's age. How old is he, and should he read older than Lin Xiaoyu?",
    drawing: ["Writing the bible", "Drawing Lin Xiaoyu's face and base look", "Drawing Wei Zhen's face and base look"],
    redrawLook: (name: string) => `Redrawing ${name}'s look`,
    askLooks: "The leads' looks are ready for your approval: Lin Xiaoyu and Wei Zhen. The observer noted that Wei Zhen's jacket reads darker than the bible describes.",
    askRedrawn: (names: string[]) => `I redrew ${names.join(" and ")}. Please look again.`,
    finishing: ["Recording your approval of the leads' looks", "Finishing the shared references"],
    preparing: ["Writing every episode's breakdown", "Drawing Lin Xiaoyu's wedding look", "Drawing the location plates", "Drawing the key prop", "Checking the shared references"],
    askReferences: (n: number) =>
      `Every episode is prepared: ${n} breakdowns are accepted. These shared references are ready for your approval: Lin Xiaoyu's wedding look, two locations and the letter.`,
    redrawReference: (key: string) => `Redrawing ${key}`,
    askReferencesAgain: (keys: string[]) => `I redrew ${keys.join(", ")}. Please look again.`,
    packing: ["Packing the project for the episodes"],
    castDone: "The cast and the shared references are approved, and the project is packed for the episodes.\n\nEpisodes:",
    restoring: (code: string) => [`Restoring the drama's project for ${code}`, "Drawing the blocking references", "Drawing the multi-panel storyboards", "Observing the storyboards"],
    askBoards: (code: string, n: number) => `${code}'s storyboards are ready for your review: ${n} segments. The observer noted that seg01 panel 4 shows a third person in the background.`,
    redrawBoard: (seg: string) => `Redrawing ${seg}'s storyboard`,
    askBoardsAgain: (segs: string[]) => `I redrew ${segs.join(", ")}. Please review the storyboards again.`,
    shooting: (segs: string[]) => ["Compiling the video prompts", ...segs.map((seg) => `Shooting ${seg}`), "Checking the takes"],
    askTakes: "Takes are in for every segment. seg02 and seg03 have dialogue the observer couldn't hear; please check them.",
    reshoot: (seg: string) => `Shooting another take of ${seg}`,
    askTakesAgain: (segs: string[]) => `New takes for ${segs.join(", ")}. Please check them.`,
    cutting: ["Planning the cut", "Building the cut", "Checking the cut"],
    askCut: (code: string) => `The cut of ${code} is ready. Please watch it.`,
    recutting: ["Revising the cut"],
    askCutAgain: (code: string) => `I revised the cut of ${code}. Please watch it again.`,
    accepting: ["Recording your acceptance of the cut"],
    finished: (code: string) => `${code} is finished: the cut is accepted.`,
    readingMessage: ["Reading your message"],
    noted: (goal: string) => `Noted: ${goal.slice(0, 200)}`,
    bible: `# Stepmother in the 80s — bible (placeholder)

## Characters
- **Lin Xiaoyu**, 26, female — the new stepmother. Looks: S0 everyday, S1 wedding.
- **Wei Zhen**, 32, male — the eldest son. Looks: S0 everyday.

## Locations
- **home** — a courtyard house, 1983.
- **office** — the factory office.

## Key props
- **letter** — the torn letter Lin hides.
`,
    breakdownTitle: (code: string) => `# ${code} — breakdown (placeholder)`,
    shot: (n: number, text: string) => `- Shot ${n}: ${text}`,
  },
  zh: {
    cast: [
      { id: "lin", name: "林晓雨" },
      { id: "wei", name: "魏振" },
    ],
    shots: [
      ["林晓雨走进院子", "魏振：你来晚了。", "林晓雨藏起那封信", "特写：撕破的信", "魏振转身离开", "林晓雨独自站着"],
      ["一家人吃晚饭", "母亲：吃饭。", "林晓雨看着魏振", "魏振推开饭碗"],
      ["夜，院子里", "林晓雨读信", "魏振站在窗边", "两人对视", "林晓雨烧掉那封信"],
    ],
    episodes: ["后妈进门", "一封信", "晚饭", "嫁衣", "夜市", "真相"],
    reading: ["阅读剧本和备注", "核对每个角色的年龄和性别"],
    askAge: "剧本里没有写魏振的年龄。他多大？要不要显得比林晓雨年长？",
    drawing: ["编写设定集", "绘制林晓雨的面部和基础造型", "绘制魏振的面部和基础造型"],
    redrawLook: (name: string) => `重新绘制${name}的造型`,
    askLooks: "主角造型已完成，请审定：林晓雨和魏振。观察员注意到，魏振的外套比设定集里描述的颜色更深。",
    askRedrawn: (names: string[]) => `我重新绘制了${names.join("和")}，请再看一下。`,
    finishing: ["记录你对主角造型的确认", "完成共用参考"],
    preparing: ["撰写每一集的拆分", "绘制林晓雨的婚礼造型", "绘制场景", "绘制关键道具", "检查共用参考"],
    askReferences: (n: number) => `每一集都已准备好：${n} 集拆分已确认。以下共用参考请你审定：林晓雨的婚礼造型、两个场景和那封信。`,
    redrawReference: (key: string) => `重画 ${key}`,
    askReferencesAgain: (keys: string[]) => `我重画了 ${keys.join("、")}，请再看一下。`,
    packing: ["打包项目，交给各集"],
    castDone: "角色与共用参考已审定，项目已打包，交给各集。\n\n分集：",
    restoring: (code: string) => [`为 ${code} 恢复剧目项目`, "绘制站位参考", "绘制多格分镜", "检查分镜"],
    askBoards: (code: string, n: number) => `${code} 的分镜已完成，请审阅：共 ${n} 段。观察员注意到，seg01 第 4 格的背景里多了一个人。`,
    redrawBoard: (seg: string) => `重画 ${seg} 的分镜`,
    askBoardsAgain: (segs: string[]) => `我重画了 ${segs.join("、")}，请再审阅一次分镜。`,
    shooting: (segs: string[]) => ["整理视频提示词", ...segs.map((seg) => `拍摄 ${seg}`), "检查镜头"],
    askTakes: "每一段的镜头都已拍好。seg02 和 seg03 有观察员听不清的台词，请你检查。",
    reshoot: (seg: string) => `重拍 ${seg}`,
    askTakesAgain: (segs: string[]) => `${segs.join("、")} 的新镜头已拍好，请检查。`,
    cutting: ["规划剪辑", "剪辑成片", "检查成片"],
    askCut: (code: string) => `${code} 的成片已完成，请观看。`,
    recutting: ["修改成片"],
    askCutAgain: (code: string) => `我修改了 ${code} 的成片，请再看一遍。`,
    accepting: ["记录你对成片的确认"],
    finished: (code: string) => `${code} 已完成：成片已通过。`,
    readingMessage: ["阅读你的消息"],
    noted: (goal: string) => `收到：${goal.slice(0, 200)}`,
    bible: `# 后妈来了 · 设定集（示例）

## 角色
- **林晓雨**，26 岁，女，新来的后妈。造型：S0 日常，S1 婚礼。
- **魏振**，32 岁，男，家中长子。造型：S0 日常。

## 场景
- **home**：1983 年的四合院。
- **office**：工厂办公室。

## 关键道具
- **letter**：林晓雨藏起的那封撕破的信。
`,
    breakdownTitle: (code: string) => `# ${code} 拆分（示例）`,
    shot: (n: number, text: string) => `- 镜头 ${n}：${text}`,
  },
};

/** A part of a packed project, as the agent returns it (here a stand-in: replay has no drama-cli project). Packed again at each stop, under the same name. */
const archive = (name: string, stop = 1): Out => ({ path: `handoff/${name}.tar.part-aa`, type: "application/octet-stream", bytes: text(`replay stand-in for ${name}.tar, packed at stop ${stop}`) });

const segmentsOf = (say: (typeof WORDS)[Lang]) => say.shots.map((shots, i) => ({ id: `seg0${i + 1}`, shots }));

function breakdownOf(say: (typeof WORDS)[Lang], code: string): string {
  return [say.breakdownTitle(code), ...segmentsOf(say).flatMap((seg) => [`\n## ${seg.id}`, ...seg.shots.map((shot, i) => say.shot(i + 1, shot))])].join("\n");
}

/**
 * The setup and pre-production, in one session: the question, the bible and the leads (the
 * maker approves), every breakdown and the shared references (the maker approves), then the
 * project packed for the episodes.
 */
function setupScript(lang: Lang): Player {
  const say = WORDS[lang];
  let stage: "start" | "asked" | "leads" | "references" = "start";
  const versions = new Map<string, number>();
  const next = (key: string) => {
    const v = (versions.get(key) ?? 0) + 1;
    versions.set(key, v);
    return `v${v}`;
  };
  const leadSheet = (c: { id: string; name: string }) => svg(`drama/assets/characters/${c.id}/${next(c.id)}/image-1.svg`, lookSheet(c.name, "base", `v${versions.get(c.id)}`));
  const shared = {
    "lin/S1": () => svg(`drama/assets/characters/lin/states/S1/${next("lin/S1")}/image-1.svg`, lookSheet(say.cast[0].name, "S1", `v${versions.get("lin/S1")}`)),
    home: () => svg(`drama/assets/scenes/home/${next("home")}/image-1.svg`, plate("home", `v${versions.get("home")}`)),
    office: () => svg(`drama/assets/scenes/office/${next("office")}/image-1.svg`, plate("office", `v${versions.get("office")}`)),
    letter: () => svg(`drama/assets/props/letter/${next("letter")}/image-1.svg`, prop("letter", `v${versions.get("letter")}`)),
  } as Record<string, () => Out>;
  return (answer) => {
    const redo = revisedKeys(answer);
    if (stage === "start") {
      stage = "asked";
      return { progress: say.reading, files: [], ask: say.askAge };
    }
    if (stage === "asked") {
      stage = "leads";
      return {
        progress: say.drawing,
        files: [{ path: "drama/bible/v1/bible.md", type: "text/markdown", bytes: text(say.bible) }, ...say.cast.map(leadSheet)],
        ask: say.askLooks,
      };
    }
    if (stage === "leads" && redo.length) {
      const who = say.cast.filter((c) => redo.includes(c.name) || redo.includes(c.id));
      return { progress: who.map((c) => say.redrawLook(c.name)), files: who.map(leadSheet), ask: say.askRedrawn(who.map((c) => c.name)) };
    }
    if (stage === "leads") {
      stage = "references";
      return {
        progress: say.preparing,
        files: [
          ...say.episodes.map((_, i) => ({ path: `drama/episodes/EP00${i + 1}/breakdown/v1/breakdown.md`, type: "text/markdown", bytes: text(breakdownOf(say, `EP00${i + 1}`)) })),
          ...Object.values(shared).map((draw) => draw()),
        ],
        ask: say.askReferences(say.episodes.length),
      };
    }
    if (redo.length) {
      const which = redo.filter((key) => shared[key]);
      return { progress: which.map(say.redrawReference), files: which.map((key) => shared[key]()), ask: say.askReferencesAgain(which) };
    }
    return {
      progress: [...say.finishing, ...say.packing],
      files: [archive("project")],
      summary: `${say.castDone}\n` + say.episodes.map((title, i) => `EP00${i + 1}: ${title}`).join("\n"),
    };
  };
}

function episodeScript(code: string, lang: Lang): Player {
  const say = WORDS[lang];
  const segments = say.shots.map((shots, i) => ({ id: `seg0${i + 1}`, shots }));
  let stage: "boards" | "takes" | "cut" | "done" = "boards";
  let boardVersion = 1;
  let take = 1;
  let cut = 1;
  const base = `drama/episodes/${code}`;
  const boards = (which: typeof segments, v: number) =>
    which.flatMap((seg) => [
      svg(`${base}/multi_panel_storyboard/${seg.id}/line-art/v${v}/image-1.svg`, storyboard(`${code} ${seg.id}`, seg.shots, "line-art", `v${v}`, v === 1 && seg.id === "seg01" ? 3 : -1)),
      svg(`${base}/multi_panel_storyboard/${seg.id}/photoreal/v${v}/image-1.svg`, storyboard(`${code} ${seg.id}`, seg.shots, "photoreal", `v${v}`, v === 1 && seg.id === "seg01" ? 3 : -1)),
    ]);
  let started = false;
  const play = (answer: string): Step => {
    const redo = revisedKeys(answer);
    if (!started) {
      started = true;
      return {
        progress: say.restoring(code),
        files: [...segments.map((seg) => svg(`${base}/blocking/${seg.id}/v1/image-1.svg`, blocking(`${code} ${seg.id}`, "v1"))), ...boards(segments, 1)],
        ask: say.askBoards(code, segments.length),
      };
    }
    if (stage === "boards" && redo.length) {
      boardVersion += 1;
      const which = segments.filter((seg) => redo.includes(seg.id));
      return { progress: which.map((seg) => say.redrawBoard(seg.id)), files: boards(which, boardVersion), ask: say.askBoardsAgain(which.map((seg) => seg.id)) };
    }
    if (stage === "boards") {
      stage = "takes";
      return {
        progress: say.shooting(segments.map((seg) => seg.id)),
        files: segments.map((seg) => video(`${base}/segments/${seg.id}/t01/video.mp4`, "take")),
        ask: say.askTakes,
      };
    }
    if (stage === "takes" && redo.length) {
      take += 1;
      return {
        progress: redo.map(say.reshoot),
        files: segments.filter((seg) => redo.includes(seg.id)).map((seg) => video(`${base}/segments/${seg.id}/t0${take}/video.mp4`, "take")),
        ask: say.askTakesAgain(redo),
      };
    }
    if (stage === "takes") {
      stage = "cut";
      return { progress: say.cutting, files: [video(`${base}/edit/v1/cut.mp4`, "cut")], ask: say.askCut(code) };
    }
    if (stage === "cut" && redo.length) {
      cut += 1;
      return { progress: say.recutting, files: [video(`${base}/edit/v${cut}/cut.mp4`, "cut")], ask: say.askCutAgain(code) };
    }
    stage = "done";
    // As Pine's agent does, the finished episode hands back its accepted cut again, unchanged.
    return { progress: say.accepting, files: [video(`${base}/edit/v${cut}/cut.mp4`, "cut")], summary: say.finished(code) };
  };
  // Each stop and the finish also hand back the episode's own folder, packed.
  let stops = 0;
  return (answer) => {
    const step = play(answer);
    stops += 1;
    return { ...step, files: [...step.files, archive(code, stops)] };
  };
}

function chatScript(goal: string, lang: Lang): Player {
  return () => ({ progress: WORDS[lang].readingMessage, files: [], summary: WORDS[lang].noted(goal) });
}

/** The recording a run's goal starts; a session keeps the language its first goal set. */
function scriptFor(goal: string, lang: Lang): Player {
  const episode = goal.match(/\b(EP\d{3})\b/);
  if (/make episode|continue episode/i.test(goal) && episode) return episodeScript(episode[1], lang);
  if (/vertical short drama from my screenplay/i.test(goal)) return setupScript(lang);
  return chatScript(goal, lang);
}

/** A decision on a stop that ended its turn, sent as a run (goals.ts, decisionGoal): the recording goes on. */
const isDecision = (goal: string) => /from there as the goal says/.test(goal);

/** What a replayed take is billed as: four seconds at Pine's 480p video rate. */
const TAKE_SECONDS = 4;
const VIDEO_PER_MINUTE = 39;

export class ReplayFleet implements Fleet {
  readonly mode = "replay" as const;
  readonly project = "replay";
  /**
   * How the recorded agent stops for the maker: with a question that returns its files ("ask");
   * with one that only names them ("name"), or that doesn't mention them ("bare"); or by ending
   * its turn with the files and its question in the summary ("finish"). Pine's agent has been
   * seen doing each of the last three.
   */
  stops: "ask" | "name" | "bare" | "finish" = "ask";
  private readonly machines = new Map<string, Machine>();
  private counter = 0;

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms / SPEED));
  }

  private machine(ref: ComputerRef): Machine {
    const found = this.machines.get(ref.id);
    if (!found || found.state !== "running") throw Object.assign(new Error("This Computer isn't running."), { status: 404 });
    return found;
  }

  private session(ref: ComputerRef, session: SessionRef): Session {
    const found = this.machine(ref).sessions.get(session.name);
    if (!found || found.token !== session.token) throw Object.assign(new Error("No such session."), { status: 404 });
    return found;
  }

  async limits(): Promise<Limits> {
    return { maxComputers: null, maxIdleSeconds: null, idleAdjustable: true, maxRuntimeSeconds: null };
  }

  async newCredentials() {
    const id = `replay-${crypto.randomUUID().slice(0, 8)}`;
    return { id, credentials: JSON.stringify({ id }) };
  }

  async createComputer(credentials: string): Promise<Attached> {
    return this.startComputer(credentials);
  }

  async startComputer(credentials: string): Promise<Attached> {
    await this.delay(900);
    const { id } = JSON.parse(credentials) as { id: string };
    this.machines.set(id, { state: "running", sessions: new Map() });
    return { binding: JSON.stringify({ id, at: Date.now() }), revision: String(Date.now()) };
  }

  async status(ref: ComputerRef) {
    return this.machines.get(ref.id)?.state ?? "stopped";
  }

  async stopBy(): Promise<Date | undefined> {
    return undefined;
  }

  async skills() {
    return [DRAMA_SKILL];
  }

  async setIdleTimeout(_ref: ComputerRef, seconds: number) {
    return seconds;
  }

  async stop(ref: ComputerRef) {
    this.machines.delete(ref.id);
    return true;
  }

  async createSession(ref: ComputerRef) {
    const machine = this.machine(ref);
    const name = `session-${(this.counter += 1)}`;
    machine.sessions.set(name, { name, token: `ps_${crypto.randomUUID()}`, taskId: `task-${name}`, turns: new Map(), keys: new Map(), events: [], files: new Map() });
    const created = machine.sessions.get(name)!;
    return { name, token: created.token };
  }

  async closeSession(ref: ComputerRef, name: string) {
    this.machines.get(ref.id)?.sessions.delete(name);
  }

  async writeFile(ref: ComputerRef, session: SessionRef, name: string, content: Uint8Array) {
    this.session(ref, session).files.set(`attachments/${name}`, { path: `attachments/${name}`, type: "application/octet-stream", bytes: content });
  }

  private emit(session: Session, turnId: string, kind: FleetEvent["kind"], textValue: string, ref?: string, state?: string, cost?: Pick<TurnInfo, "cost" | "media">) {
    session.events.push({ id: String(session.events.length + 1), taskId: session.taskId, turnId, kind, text: textValue, ref, state, ...cost });
  }

  private begin(session: Session, answer: string): TurnInfo {
    const turnId = `turn-${crypto.randomUUID().slice(0, 12)}`;
    const info: TurnInfo = { turnId, state: "running", question: "", summary: "", nextTurnId: "", files: [], cost: null, media: null };
    session.turns.set(turnId, { info, waiters: [] });
    session.latest = turnId;
    void this.play(session, turnId, answer);
    return { ...info };
  }

  private async play(session: Session, turnId: string, answer: string) {
    const step = session.play!(answer);
    for (const [i, line] of step.progress.entries()) {
      await this.delay(700 + Math.random() * 600);
      this.emit(session, turnId, "progress", line);
      this.emit(session, turnId, "activity", line, `${turnId}-${i}`, "completed");
    }
    const files: TurnFile[] = step.files.map((file) => {
      session.files.set(file.path, file);
      return { path: file.path, size: file.bytes.length, sha256: "", type: file.type };
    });
    const turn = session.turns.get(turnId)!;
    const asks = step.ask !== undefined && this.stops !== "finish";
    // Asked without returning its files: the question names them instead, or doesn't even do that.
    const named = step.ask !== undefined && this.stops === "name";
    const bare = step.ask !== undefined && this.stops === "bare";
    const ask = named ? [step.ask, ...files.map((file) => `- [${file.path.split("/").pop()}](${file.path})`)].join("\n") : step.ask;
    turn.info = {
      ...turn.info,
      state: asks ? "needs_input" : "completed",
      question: asks ? ask! : "",
      summary: ask ?? step.summary ?? "",
      files: named || bare ? [] : files,
      cost: Math.round((0.15 + Math.random() * 0.4) * 100) / 100,
      media: 0,
    };
    this.emit(session, turnId, "result", turn.info.summary);
    for (const wake of turn.waiters.splice(0)) wake();
    // Each take is a few seconds of generated video, billed as it settles, after the turn's result.
    const takes = files.filter((file) => /\/segments\/seg\d+\/t\d+\/[^/]+\.mp4$/.test(file.path)).length;
    if (takes) {
      await this.delay(1_500);
      const media = Math.round(takes * TAKE_SECONDS * (VIDEO_PER_MINUTE / 60) * 100) / 100;
      turn.info = { ...turn.info, cost: Math.round((turn.info.cost! + media) * 100) / 100, media };
      this.emit(session, turnId, "usage", "", undefined, undefined, { cost: turn.info.cost, media });
    }
  }

  async run(ref: ComputerRef, session: SessionRef, goal: string, key: string) {
    const found = this.session(ref, session);
    const known = found.keys.get(key);
    if (known) return { ...found.turns.get(known)!.info };
    const latest = found.latest && found.turns.get(found.latest);
    if (latest && latest.info.state === "running") throw Object.assign(new Error("The session is busy."), { status: 409 });
    found.lang ??= languageOf(goal);
    const decision = isDecision(goal) && found.play !== undefined;
    if (!decision) found.play = scriptFor(goal, found.lang);
    const info = this.begin(found, decision ? goal : "");
    found.keys.set(key, info.turnId);
    this.emit(found, info.turnId, "input", goal);
    return info;
  }

  async wait(ref: ComputerRef, session: SessionRef, turnId: string, timeoutMs: number) {
    const found = this.session(ref, session);
    const turn = found.turns.get(turnId);
    if (!turn) throw Object.assign(new Error("No such turn."), { status: 404 });
    if (turn.info.state === "running") {
      await Promise.race([new Promise<void>((resolve) => turn.waiters.push(resolve)), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    }
    return { ...turn.info };
  }

  async answer(ref: ComputerRef, session: SessionRef, turnId: string, textValue: string) {
    const found = this.session(ref, session);
    const turn = found.turns.get(turnId);
    if (!turn) throw Object.assign(new Error("No such turn."), { status: 404 });
    if (turn.info.state === "answered") return { ...found.turns.get(turn.info.nextTurnId)!.info };
    if (turn.info.state !== "needs_input" || found.latest !== turnId) throw Object.assign(new Error("This turn can't be answered."), { status: 409 });
    const next = this.begin(found, textValue);
    turn.info = { ...turn.info, state: "answered", nextTurnId: next.turnId };
    this.emit(found, next.turnId, "input", textValue);
    return next;
  }

  async steer(ref: ComputerRef, session: SessionRef, turnId: string, textValue: string) {
    this.emit(this.session(ref, session), turnId, "input", textValue);
  }

  async listFiles(ref: ComputerRef, session: SessionRef, folder: string) {
    const prefix = folder.replace(/\/$/, "") + "/";
    const level = new Map<string, { path: string; folder: boolean; size: number }>();
    for (const file of this.session(ref, session).files.values()) {
      if (!file.path.startsWith(prefix)) continue;
      const [name, ...rest] = file.path.slice(prefix.length).split("/");
      level.set(name, rest.length ? { path: prefix + name, folder: true, size: 0 } : { path: file.path, folder: false, size: file.bytes.length });
    }
    return [...level.values()];
  }

  async openFile(ref: ComputerRef, session: SessionRef, filePath: string) {
    const file = this.session(ref, session).files.get(filePath);
    if (!file) throw Object.assign(new Error("No such file."), { status: 404 });
    return new Blob([new Uint8Array(file.bytes)]).stream();
  }

  async *events(ref: ComputerRef, session: SessionRef, after: string | undefined, _taskId: string | undefined, signal: AbortSignal): AsyncIterable<FleetEvent> {
    let next = Number(after ?? 0);
    while (!signal.aborted) {
      const found = this.machines.get(ref.id)?.sessions.get(session.name);
      if (!found) return;
      while (next < found.events.length) yield found.events[next++];
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async desktop() {
    return null;
  }
}
