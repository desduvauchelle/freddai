import { useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { ScheduleFields, blankSchedule, validateSchedule } from "./ScheduleManager";
import type { DeliveryData } from "./DeliveryControls";
import type { Schedule } from "./types";

/** Standalone create/edit form. `onSave` rejections and validation errors are shown inline. */
export function ScheduleForm({ initial, projects, accounts, onSave, onCancel, busy = false, error = "", defaultAccount, disabled = false }: {
  initial: Schedule | null; projects: DeliveryData["projects"]; accounts: DeliveryData["accounts"];
  onSave: (schedule: Schedule) => void | Promise<void>; onCancel: () => void; busy?: boolean; error?: string; defaultAccount?: string; disabled?: boolean;
}) {
  const [form, setForm] = useState<Schedule>(() => initial || blankSchedule({ projects, accounts }, { account: defaultAccount }));
  const [localError, setLocalError] = useState("");
  const update = (p: Partial<Schedule>) => setForm(f => ({ ...f, ...p }));
  const shown = localError || error;
  return <form className="schedule-manager schedule-form" onSubmit={e => {
    e.preventDefault(); setLocalError("");
    try { validateSchedule(form); } catch (err) { setLocalError(err instanceof Error ? err.message : String(err)); return; }
    void onSave(form);
  }}>
    {shown && <p role="alert" className="schedule-form-error">{shown}</p>}
    <ScheduleFields form={form} update={update} db={{ projects, accounts }} progress={{ runs: initial?.runs || [] }} setError={setLocalError} />
    <div className="capture-controls"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={disabled || busy || !form.account}>Save schedule</Button></div>
  </form>;
}
