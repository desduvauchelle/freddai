import { OFFICE_VERSIONS, useOfficeVersion, type OfficeVersion } from "./officeVersion";

/** Office-version dropdown; lives in each office's bottom control row. Persists the choice and flips every office in the window. */
export function OfficeVersionPicker({ className }: { className?: string } = {}) {
  const [version, setVersion] = useOfficeVersion();
  return <select aria-label="Office style" title="Office style" className={["office-version-picker", className].filter(Boolean).join(" ")}
    value={version} onChange={e => setVersion(e.target.value as OfficeVersion)}>
    {OFFICE_VERSIONS.map(v => <option key={v.id} value={v.id} title={v.hint}>{v.label}</option>)}
  </select>;
}
