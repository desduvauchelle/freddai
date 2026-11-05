import { useEffect, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Badge } from "@freddai/ui/components/badge";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@freddai/ui/components/field";
import { Switch } from "@freddai/ui/components/switch";
import { LANGUAGE_OPTIONS, SHORTCUT_OPTIONS, downloadPercent, formatBytes, useVoice, voice, type VoiceModel, type VoiceShortcut } from "./voice";

export function VoiceSettings({ native }: { native: boolean }) {
  native = native && /Mac/.test(navigator.platform);
  const { status, statusError } = useVoice();
  const downloading = !!status?.models.some(m => m.download && !m.download.error);
  useEffect(() => {
    if (!native) return;
    void voice.refresh();
    const timer = setInterval(() => void voice.refresh(), downloading ? 500 : 3000);
    return () => clearInterval(timer);
  }, [native, downloading]);
  if (!native) return <section aria-labelledby="voice-settings-heading">
    <h2 id="voice-settings-heading" className="sr-only">Voice</h2>
    <p className="capture-help">Voice dictation needs the Mac app.</p>
  </section>;
  const anyInstalled = !!status?.models.some(m => m.installed);
  return <section aria-labelledby="voice-settings-heading" className="space-y-6">
    <h2 id="voice-settings-heading" className="sr-only">Voice</h2>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="voice-enabled">Enable voice dictation</FieldLabel>
        <FieldDescription>{anyInstalled || status?.enabled ? "Hold a key or the microphone button in a composer, speak, and release to insert the text. Audio is transcribed on this Mac." : "Download a model first"}</FieldDescription>
      </FieldContent>
      <Switch id="voice-enabled" checked={!!status?.enabled} disabled={!status || (!anyInstalled && !status.enabled)} onCheckedChange={next => void voice.updateSettings({ enabled: next })} />
    </Field>
    <div>
      <h3>Speech models</h3>
      {!status && !statusError && <p className="capture-help">Loading…</p>}
      <ul aria-label="Speech models">
        {status?.models.map(model => <ModelRow key={model.id} model={model} active={status.activeModel === model.id} />)}
      </ul>
    </div>
    <Field>
      <FieldLabel htmlFor="voice-shortcut">Hold to talk</FieldLabel>
      <select id="voice-shortcut" className="voice-select" value={status?.shortcut ?? "AltRight"} disabled={!status?.enabled}
        onChange={e => void voice.updateSettings({ shortcut: e.target.value as VoiceShortcut })}>
        {SHORTCUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldDescription>Works while Freddai is focused. Pressing any other key while holding cancels, so shortcuts that use the key still work.</FieldDescription>
    </Field>
    <Field>
      <FieldLabel htmlFor="voice-language">Language</FieldLabel>
      <select id="voice-language" className="voice-select" value={status?.language ?? "auto"} disabled={!status}
        onChange={e => void voice.updateSettings({ language: e.target.value })}>
        {LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
    {statusError && <p role="alert" className="inline-error">{statusError}</p>}
  </section>;
}

function ModelRow({ model, active }: { model: VoiceModel; active: boolean }) {
  const d = model.download, inProgress = !!d && !d.error;
  return <li className="voice-model">
    <div className="voice-model-info">
      <div><strong>{model.name}</strong> {model.recommended && <Badge variant="secondary">Recommended</Badge>} {active && <Badge>Active</Badge>}</div>
      <div className="voice-model-meta">{model.description}</div>
      <div className="voice-model-meta">{model.languageLabel} · {formatBytes(model.sizeBytes)}</div>
      {d?.error && <div className="voice-error" role="alert">Download failed: {d.error}</div>}
    </div>
    <div className="voice-model-actions">
      {inProgress && <>
        <div className="voice-progress" role="progressbar" aria-label={`Downloading ${model.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent(d!)}><div style={{ width: `${downloadPercent(d!)}%` }} /></div>
        <span className="voice-model-meta">{downloadPercent(d!)}% downloaded</span>
        <Button variant="ghost" size="sm" onClick={() => void voice.cancelDownload(model.id)}>Cancel</Button>
      </>}
      {!inProgress && !model.installed && <Button variant="outline" size="sm" onClick={() => void voice.downloadModel(model.id)}>{d?.error ? "Retry" : "Download"}</Button>}
      {!inProgress && model.installed && <>
        {!active && <Button variant="outline" size="sm" onClick={() => void voice.updateSettings({ activeModel: model.id })}>Use this model</Button>}
        <Button variant="ghost" size="sm" onClick={() => {
          if (!window.confirm(`Remove ${model.name}? You can download it again later.`)) return;
          void voice.deleteModel(model.id);
        }}>Remove</Button>
      </>}
    </div>
  </li>;
}
