import { useState } from "react";
import type { AppInfo } from "../../shared/types.ts";
import { api, useAction } from "../api.ts";
import { useT } from "../i18n.ts";
import { errorText } from "../labels.ts";

const DEFAULT_ENDPOINT = "https://pinesandbox.io";

/** The form that connects a Pine project; used on first run and in Settings. */
export function ConnectForm({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [more, setMore] = useState(false);
  const connect = useAction(async () => {
    await api<AppInfo>("/api/connection/pine", { method: "POST", json: { endpoint, apiKey } });
    onDone();
  });
  const { busy, error } = connect;
  return (
    <form
      className="connect"
      onSubmit={(event) => {
        event.preventDefault();
        if (apiKey.trim() && !busy) void connect.run();
      }}
    >
      <h2>{t("connect.title")}</h2>
      <div className="field">
        <label className="label" htmlFor="key">
          {t("connect.key")}
        </label>
        <input id="key" className="line-input" type="password" autoComplete="off" spellCheck={false} placeholder="pk_…" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        <span className="quiet small">{t("connect.keyHint")}</span>
      </div>
      {more ? (
        <div className="field">
          <label className="label" htmlFor="endpoint">
            {t("connect.endpoint")}
          </label>
          <input id="endpoint" className="line-input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </div>
      ) : (
        <button type="button" className="link start small" onClick={() => setMore(true)}>
          {t("connect.endpoint")}: {endpoint}
        </button>
      )}
      {error !== undefined && <p className="error flush">{errorText(error, t)}</p>}
      <div className="inline">
        <button className="btn ink" type="submit" disabled={busy || !apiKey.trim()}>
          {busy ? t("connect.checking") : t("connect.go")}
        </button>
        <span className="quiet small">
          {t("connect.stored")}
        </span>
      </div>
    </form>
  );
}

export function Welcome({ onReady }: { onReady: () => void }) {
  const { t } = useT();
  const replay = async () => {
    await api("/api/connection/replay", { method: "POST" });
    onReady();
  };
  return (
    <main className="page">
      <div className="welcome">
        <div>
          <h1>
            {t("welcome.before")}
            <em>{t("welcome.em")}</em>
            {t("welcome.after")}
          </h1>
          <p className="lede">{t("welcome.lede")}</p>
        </div>
        <div className="block roomy">
          <ConnectForm onDone={onReady} />
          <div className="quiet block tight">
            <span>
              {t("connect.noProject")}{" "}
              <a className="link" href="https://pinecomputer.io/#access" target="_blank" rel="noreferrer">
                {t("connect.request")}
              </a>
            </span>
            <span>
              <button className="link" onClick={replay}>
                {t("connect.replay")}
              </button>
              <span className="faint"> · {t("connect.replayHint")}</span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
