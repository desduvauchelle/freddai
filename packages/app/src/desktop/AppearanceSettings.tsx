import type { CSSProperties } from "react";
import type { useFontSizes } from "./use-font-sizes";
import { Check } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { lightThemes, themes, type Theme } from "./themes";

export function AppearanceSettings({ theme, onChange, saved, appearance, fontSizes }: { fontSizes: ReturnType<typeof useFontSizes>; appearance: "light" | "dark"; theme: Theme; onChange: (value: Theme) => void; saved: boolean }) {
  return <section aria-labelledby="theme-heading">
    <div className="space-y-2" style={{ marginBottom: 28 }}>
      <h2>Font size</h2>
      <p className="text-sm text-muted-foreground">Use ⌘ + / − over the thread list or chat to resize its text. Keyboard focus is used when the pointer is elsewhere. ⌘ 0 resets that area.</p>
      {(["threads", "chat"] as const).map(region => <label key={region} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ minWidth: 130 }}>{region === "threads" ? "Thread list" : "Chat text"}</span>
        <input aria-label={`${region === "threads" ? "Thread list" : "Chat text"} font size`} type="range" min={10} max={24} step={1} value={fontSizes.sizes[region]} onChange={event => fontSizes.setSize(region, Number(event.target.value))} />
        <output>{fontSizes.sizes[region]} px</output>
      </label>)}
      <p role="status" className="text-sm text-muted-foreground">{fontSizes.saved ? "Font sizes are saved on this device." : "Font sizes are applied, but could not be saved on this device."}</p>
    </div>
    <div className="space-y-2"><h2 id="theme-heading">Theme</h2><p className="text-sm text-muted-foreground">Choose a color palette. Light and dark appearance follow your device automatically.</p></div>
    <div className="theme-grid" role="group" aria-label="Workspace theme">
      {themes.map(preset => <Button key={preset.id} variant="outline" className="theme-choice" aria-pressed={theme === preset.id} onClick={() => onChange(preset.id)}>
        <span className="theme-preview" aria-hidden="true" style={{ "--preview-background": (appearance === "light" ? lightThemes[preset.id] : preset).background, "--preview-surface": (appearance === "light" ? lightThemes[preset.id] : preset).surface, "--preview-primary": (appearance === "light" ? lightThemes[preset.id] : preset).primary } as CSSProperties}>
          <span className="theme-preview-sidebar"><i /><i /><i /></span><span className="theme-preview-content"><i /><i /><i /></span>
        </span>
        <span className="theme-choice-name">{preset.name}{theme === preset.id && <Check aria-hidden="true" size={16} />}</span>
        <span className="theme-choice-description">{preset.description}</span>
      </Button>)}
    </div>
    <p role="status" className="text-sm text-muted-foreground">{saved ? "Your theme is saved on this device." : "Your theme is applied, but could not be saved on this device."}</p>
  </section>;
}
