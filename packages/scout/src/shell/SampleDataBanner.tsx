import { DarkButton, GhostButton } from "../ui";

export function SampleDataBanner({ onClear, onImport, busy }: { onClear: () => void; onImport: () => void; busy?: boolean }) {
  return <div className="sc-banner" role="status">
    <span className="sc-banner__text">Sample data is loaded so you can see the board. Clear it when you are ready.</span>
    <span className="sc-banner__actions">
      <GhostButton onClick={onClear} disabled={busy}>Clear sample data</GhostButton>
      <DarkButton onClick={onImport} disabled={busy}>Import from Freddai</DarkButton>
    </span>
  </div>;
}
