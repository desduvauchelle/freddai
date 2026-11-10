import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@freddai/ui/components/select';

/** Compact shadcn picker shared by dashboard defaults; labels remain available to assistive technology. */
export function DashboardSelect({ label, value, onChange, options, displayValue, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[]; displayValue?: string; disabled?: boolean;
}) {
  return <Select value={value || '__dashboard_default'} onValueChange={value => onChange(value === '__dashboard_default' ? '' : value)} disabled={disabled}>
    <SelectTrigger size="sm" className="dashboard-picker" aria-label={label} title={label}><SelectValue>{displayValue}</SelectValue></SelectTrigger>
    <SelectContent position="popper" align="end"><SelectGroup><SelectLabel>{label}</SelectLabel>
      {options.map(option => <SelectItem key={option.value} value={option.value || '__dashboard_default'}>{option.label}</SelectItem>)}
    </SelectGroup></SelectContent>
  </Select>;
}
