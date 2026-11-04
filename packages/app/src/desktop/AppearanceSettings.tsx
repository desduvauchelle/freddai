import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { lightThemes, themes, type Theme } from "./themes";

export function AppearanceSettings({ theme, onChange, saved, appearance }: { appearance: "light" | "dark"; theme: Theme; onChange: (value: Theme) => void; saved: boolean }) {
  return <section aria-labelledby="theme-heading">
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
