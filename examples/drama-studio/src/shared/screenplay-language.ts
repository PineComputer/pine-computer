// drama-cli init's --screenplay-language is the language of a screenplay's structure (its scene
// and episode headings), not of its dialogue (`drama-cli init -h`). The studio sets it from the
// screenplay itself, so a maker never has to tell the two apart: our own design, the person's
// decision. It counts the lines that carry a structural mark of each form and takes the form with
// more; with neither (prose, or no structure at all) the maker chooses: a guess from the preset
// gave a structure the screenplay doesn't have, which drama-cli then refused (scene_setting).
//
// The marks are the ones drama-cli reads (short_drama drama_cli/screenplay.py, SETTINGS,
// TIME_WORDS and ORIGINAL_SETTINGS, and `drama-cli screenplay sample` in each language):
// English INT./EXT. headings and `# Episode n`; Chinese 内景/外景 headings, `# 第n集`, and the
// supplied Chinese screenplays' own form, `1-1 夜 内 …` with 日/夜 and 内/外. The cast line
// (人物：, 出场人物：) and the action marks △/▲ are that same Chinese form's (drama-cli's skill
// rewrites them, skills/drama-workflow/SKILL.md, screenplay step 2).

export type ScreenplayLanguage = "en" | "zh";

// A heading as Fountain reads one: it starts with INT, EXT, EST, INT./EXT, INT/EXT or I/E, "case
// insensitive", followed by a dot or a space, or is forced with a leading period (fountain.io/syntax,
// Scene Headings); drama-cli takes the parser's heading and reads its setting upper-cased
// (short_drama drama_cli/screenplay.py, _slug).
const ENGLISH: RegExp[] = [
  /^\.?(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[.\s]/i,
  /^#*\s*EPISODE\s+\d+\b/i,
];

const CHINESE: RegExp[] = [
  /^\.?(?:内景|外景)/,
  /^#*\s*第\s*[0-9０-９一二三四五六七八九十百零〇两]+\s*集/,
  /^\d+\s*-\s*\d+\s*(?:(?:日|夜)\s*(?:内|外)|(?:内|外)\s*(?:日|夜))/,
  /^(?:出场)?人物\s*[:：]/,
  /^[△▲]/,
];

export interface Detected {
  /** The form with more structural lines, or undefined when neither has any or they tie. */
  language?: ScreenplayLanguage;
  en: number;
  zh: number;
}

/** Counts the lines with a structural mark of each form. */
export function detectScreenplayLanguage(text: string): Detected {
  let en = 0;
  let zh = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (ENGLISH.some((mark) => mark.test(line))) en += 1;
    else if (CHINESE.some((mark) => mark.test(line))) zh += 1;
  }
  return { language: en > zh ? "en" : zh > en ? "zh" : undefined, en, zh };
}

/**
 * drama-cli init's screenplay language for a screenplay: the form its structure is written in, or,
 * when it shows none, what the maker chose (undefined until they do).
 */
export function screenplayLanguageOf(text: string, chosen?: ScreenplayLanguage): { language?: ScreenplayLanguage; detected: boolean } {
  const detected = detectScreenplayLanguage(text).language;
  return detected ? { language: detected, detected: true } : { language: chosen, detected: false };
}
