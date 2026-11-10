import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GoogleSetup, GoogleAccountsPanel, GoogleHostOutdatedNotice, useGoogleAccounts, useGoogleHostSupport } from "./GoogleAccounts";
import { GoogleTriggersPanel, useGoogleTriggers } from "./GoogleTriggers";
import { GOOGLE_HOST_OUTDATED_NOTICE, errorText } from "../google";
import type { GoogleCommand, GoogleConfig } from "../google";
import type { DeliveryData } from "./DeliveryControls";

/** Tauri command names match the host operations; arguments are camelCase on the JS side. */
export const desktopGoogleCommand: GoogleCommand = (operation, input) => invoke(operation, input);

export function ConnectedAccountsSettings({ db, native, command = desktopGoogleCommand, openExternal = openUrl, pollMs }: {
  db: DeliveryData; native: boolean; command?: GoogleCommand; openExternal?: (url: string) => Promise<void>; pollMs?: number;
}) {
  const [config, setConfig] = useState<GoogleConfig | null>(null), [configError, setConfigError] = useState("");
  const support = useGoogleHostSupport(command, native);
  const ready = native && support.state === "supported";
  useEffect(() => {
    if (!ready) return;
    let active = true;
    command("google_config_get", {}).then(value => { if (active) setConfig(value as GoogleConfig); }).catch(e => { if (active) setConfigError(errorText(e)); });
    return () => { active = false; };
  }, [ready, command]);
  const { accounts, error: accountsError, reload: reloadAccounts } = useGoogleAccounts(command, ready);
  const { triggers, error: triggersError, reload: reloadTriggers } = useGoogleTriggers(command, ready);
  const refreshAll = useCallback(async () => { await Promise.all([reloadAccounts(), reloadTriggers()]); }, [reloadAccounts, reloadTriggers]);
  const saved = !!config?.clientId;
  if (native && support.state === "outdated") return <GoogleHostOutdatedNotice message={GOOGLE_HOST_OUTDATED_NOTICE} />;
  return <div className="space-y-6">
    {support.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{support.error}</p>}
    {configError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{configError}</p>}
    <GoogleSetup command={command} native={native} config={config} onChange={setConfig} />
    <GoogleAccountsPanel command={command} native={native} accounts={accounts} error={accountsError} onChanged={refreshAll}
      connect={{ canConnect: saved, blockedReason: "Save a Google client ID above before connecting an account.", openExternal, pollMs }} />
    <GoogleTriggersPanel command={command} native={native} accounts={accounts} db={db} triggers={triggers} error={triggersError} reload={reloadTriggers} />
  </div>;
}
