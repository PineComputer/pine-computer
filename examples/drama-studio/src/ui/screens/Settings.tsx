import { useState } from "react";
import type { AppInfo } from "../../shared/types.ts";
import { api, useAction } from "../api.ts";
import { setLang, useT } from "../i18n.ts";
import { errorText } from "../labels.ts";
import { useNotifySetting } from "../notify.ts";
import { ConnectForm } from "./Welcome.tsx";

export function Settings({ app, onChange }: { app: AppInfo; onChange: () => void }) {
  const { t, lang } = useT();
  const [connecting, setConnecting] = useState(false);
  const notify = useNotifySetting();
  const disconnect = useAction(async () => {
    await api("/api/connection", { method: "DELETE" });
    onChange();
  });
  return (
    <main className="page">
      <div className="head">
        <h1>{t("settings.title")}</h1>
      </div>
      <div className="settings">
        <section>
          <span className="label">{t("settings.project")}</span>
          <div className="block wide">
            {app.mode === "pine" && app.project ? (
              <>
                <dl>
                  <dt>{t("settings.endpoint")}</dt>
                  <dd>{app.project.endpoint}</dd>
                  <dt>{t("settings.key")}</dt>
                  <dd className="num">{app.project.keyHint}</dd>
                  <dt>{t("settings.skill")}</dt>
                  <dd>{t(`settings.skill.${app.dramaSkill ?? "unknown"}`)}</dd>
                </dl>
                {app.project.fromEnvironment ? (
                  <span className="quiet">{t("settings.fromEnv")}</span>
                ) : (
                  <>
                    <div className="inline">
                      <button className="btn" disabled={disconnect.busy} onClick={() => void disconnect.run()}>
                        {disconnect.busy ? t("settings.disconnecting") : t("settings.disconnect")}
                      </button>
                      <span className="quiet small">{t("settings.disconnectHint")}</span>
                    </div>
                    {disconnect.error !== undefined && <p className="error flush">{errorText(disconnect.error, t)}</p>}
                  </>
                )}
              </>
            ) : (
              <>
                <span>{t("settings.replayOn")}</span>
                {connecting ? (
                  <ConnectForm onDone={onChange} />
                ) : (
                  <button className="btn start" onClick={() => setConnecting(true)}>
                    {t("settings.connect")}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <section>
          <span className="label">{t("settings.language")}</span>
          <div className="options">
            <button aria-pressed={lang === "zh"} className={lang === "zh" ? "on" : ""} onClick={() => setLang("zh")}>
              中文
            </button>
            <button aria-pressed={lang === "en"} className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>
              English
            </button>
          </div>
        </section>
        {notify.supported && (
          <section>
            <span className="label">{t("settings.notify")}</span>
            <div className="block">
              <div className="options">
                <button aria-pressed={notify.on} className={notify.on ? "on" : ""} onClick={() => void (notify.on || notify.toggle())}>
                  {t("settings.notifyOn")}
                </button>
                <button aria-pressed={!notify.on} className={notify.on ? "" : "on"} onClick={() => void (notify.on && notify.toggle())}>
                  {t("settings.notifyOff")}
                </button>
              </div>
              <span className="quiet small">{notify.blocked ? t("settings.notifyBlocked") : t("settings.notifyHint")}</span>
            </div>
          </section>
        )}
        <section>
          <span className="label">{t("settings.data")}</span>
          <div className="block">
            <span className="path">{app.dataDir}</span>
            <span className="quiet small">{t("settings.dataHint")}</span>
          </div>
        </section>
        <section>
          <span className="label">{t("settings.troubleshooting")}</span>
          <div className="block">
            <div className="inline">
              <a className="btn" href="/api/diagnostics" download>
                {t("settings.diagnostics")}
              </a>
            </div>
            <span className="quiet small">{t("settings.diagnosticsHint")}</span>
          </div>
        </section>
      </div>
    </main>
  );
}
