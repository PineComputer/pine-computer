import { describe, expect, it } from "vitest";
import { detectScreenplayLanguage, screenplayLanguageOf } from "./screenplay-language.ts";

describe("the screenplay's structure", () => {
  it("is English for INT./EXT. headings and Episode headings, whatever the dialogue", () => {
    const text = `# Episode 1

INT. EMERGENCY ROOM - DAY #1-1#

MARA
三号床，准备除颤！

EXT. HOSPITAL ENTRANCE - NIGHT #1-2#`;
    expect(detectScreenplayLanguage(text)).toEqual({ language: "en", en: 3, zh: 0 });
  });

  it("is Chinese for drama-cli's Chinese Fountain", () => {
    const text = `# 第1集

.内景 急诊室 - 日 #1-1#

@林晚
三号床，准备除颤！

.外景 医院门口 - 夜 #1-2#`;
    expect(detectScreenplayLanguage(text)).toEqual({ language: "zh", en: 0, zh: 3 });
  });

  it("is Chinese for the industry form with English dialogue", () => {
    // The form of the person's test upload (28 October 2026): Chinese structure, English lines.
    const text = `第一集
1-1  夜  内  华丽宴会厅
出场人物：Sabrina Donovan、Nathan Hardwick
▲ 金碧辉煌的宴会厅内。
Sabrina Donovan（低声）: "I heard Sabrina Donovan has never been seen in public."
1-2日外酒店门口`;
    expect(detectScreenplayLanguage(text)).toEqual({ language: "zh", en: 0, zh: 5 });
  });

  it("is English for every heading Fountain reads: forced with a period, in lowercase, INT./EXT., I/E and EST", () => {
    // Fountain: a heading starts with INT, EXT, EST, INT./EXT, INT/EXT or I/E, "case insensitive", or is forced
    // with a leading period (fountain.io/syntax, Scene Headings); drama-cli reads its setting upper-cased.
    for (const heading of [".INT. OFFICE - DAY #1-1#", "int. office - day #1-1#", "INT./EXT. CAR - NIGHT #1-2#", "I/E CAR - NIGHT #1-3#", "EST. CITY - DAY #1-4#"]) {
      expect(detectScreenplayLanguage(heading).language).toBe("en");
    }
  });

  it("is undecided for prose, and for a tie", () => {
    expect(detectScreenplayLanguage("She walks into the hall. 她走进大厅。").language).toBeUndefined();
    expect(detectScreenplayLanguage("INT. HALL - DAY\n.内景 大厅 - 日").language).toBeUndefined();
  });
});

describe("the screenplay language the studio sends", () => {
  it("is the structure's when it shows one, and otherwise only what the maker chose, never the preset's", () => {
    expect(screenplayLanguageOf("INT. HALL - DAY #1-1#", "zh")).toEqual({ language: "en", detected: true });
    // Prose shows no structure: guessing from the preset gave a scene_setting error the maker couldn't correct.
    expect(screenplayLanguageOf("She walks into the hall. 她走进大厅。")).toEqual({ language: undefined, detected: false });
    expect(screenplayLanguageOf("She walks into the hall. 她走进大厅。", "zh")).toEqual({ language: "zh", detected: false });
  });
});
