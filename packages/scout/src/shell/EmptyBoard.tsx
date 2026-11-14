import { DarkButton, GhostButton } from "../ui";

export function EmptyBoard({ onImport, onSample, onOnboarding, busy }: {
  onImport: () => void; onSample: () => void; onOnboarding: () => void; busy?: boolean;
}) {
  return <section className="sc-empty" aria-labelledby="sc-empty-title">
    <span className="sc-brand__mark" aria-hidden />
    <h1 id="sc-empty-title" className="sc-empty__title">Your board is empty</h1>
    <p className="sc-empty__text">Bring in your Freddai projects and threads, try Scout with sample data, or set it up step by step.</p>
    <div className="sc-empty__actions">
      <DarkButton onClick={onImport} disabled={busy}>Import from Freddai</DarkButton>
      <GhostButton onClick={onSample} disabled={busy}>Load sample data</GhostButton>
      <GhostButton onClick={onOnboarding} disabled={busy}>Start onboarding</GhostButton>
    </div>
  </section>;
}
