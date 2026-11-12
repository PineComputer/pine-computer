// The preset templates New drama shows. One with a preset is drama-cli's bundled preset of that
// name (`drama-cli preset list`); one without is shown greyed: not supported yet. The studio offers
// only the presets named here, so a preset drama-cli adds is offered once someone adds it.

export const TEMPLATES: readonly { key: string; preset?: string }[] = [
  { key: "zh-drama", preset: "zh-cn-live-sfw" },
  { key: "en-drama", preset: "en-us-live-sfw" },
  { key: "anime-drama" },
  { key: "3d-drama" },
  { key: "ad" },
  { key: "custom" },
];

/** The presets a drama may use. */
export const PRESETS: readonly string[] = TEMPLATES.flatMap((template) => (template.preset ? [template.preset] : []));
