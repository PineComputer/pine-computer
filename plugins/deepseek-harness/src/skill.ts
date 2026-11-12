// The Pine Computer skill, offered through dsh's skill registry: when to hand work to the Computer and how.
// Its text is the repository's one skill (skills/pine-computer/SKILL.md), copied into this package when it
// is built, so every agent that gets a Computer reads the same instructions. It is a plugin of its own, so
// a profile without the skill registry still gets the tools, and a person can switch the skill off alone.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from "@deepseek-ai/dsh-skill";

export const name = "pine-computer-skill";
export const inject = ["skills"];

const PROVIDER = "pine-computer";
// From lib/, where this file is built to.
const DIRECTORY = new URL("../assets/pine-computer/", import.meta.url);
const FILE = new URL("SKILL.md", DIRECTORY);

// The shared skill tells an agent without the tools to add the MCP server. In dsh they come from this
// plugin, so the agent is told that instead.
const IN_DSH = `## In DeepSeek Harness

Here the four tools come from the Pine Computer plugin, not from an MCP server. If they are missing, the
plugin is switched off: ask the person to switch it on under Plugins. If a tool says there is no project
key, ask the person to store it in DeepSeek Harness; never ask them to paste the key into the chat.`;

interface Parsed {
  description: string;
  content: string;
}

/** The description from the file's front matter, and the instructions under it. */
function parse(raw: string): Parsed {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const description = front?.[1].match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!front || !description) throw new Error(`pine-computer: ${fileURLToPath(FILE)} has no description in its front matter`);
  return { description, content: raw.slice(front[0].length).trim() };
}

export function apply(ctx: Context): void {
  let parsed: Promise<Parsed> | undefined;
  const skill = () => (parsed ??= readFile(FILE, "utf8").then(parse));

  const provider: SkillProvider = {
    name: PROVIDER,
    async list() {
      const candidate: SkillCandidate = {
        name: "pine-computer",
        description: (await skill()).description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: "bundled",
        rank: BUNDLED_SKILL_RANK,
        resourceBase: { kind: "directory", path: fileURLToPath(DIRECTORY) },
        locator: FILE.href,
      };
      return [candidate];
    },
    async get(candidate): Promise<SkillDefinition> {
      const { rank: _rank, locator: _locator, ...summary } = candidate;
      return { ...summary, content: `${(await skill()).content}\n\n${IN_DSH}` };
    },
  };
  ctx.skills.registerProvider(() => provider);
}
