import type { Reviewing } from "../shared/types.ts";
import { useT } from "./i18n.ts";

const CHOICES: Reviewing[] = ["every", "key", "none"];

/** What the maker reviews in a drama, in New drama and when tuning one: the studio approves the rest. */
export function ReviewingChoice({ value, onChange }: { value: Reviewing; onChange: (value: Reviewing) => void }) {
  const { t } = useT();
  return (
    <div className="field">
      <span className="label">{t("reviewing.label")}</span>
      <div className="options">
        {CHOICES.map((choice) => (
          <button key={choice} aria-pressed={value === choice} className={value === choice ? "on" : ""} onClick={() => onChange(choice)}>
            {t(`reviewing.${choice}`)}
          </button>
        ))}
      </div>
      <p className="quiet small">{t(`reviewing.${value}Hint`)}</p>
    </div>
  );
}
