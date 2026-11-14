import { Calendar, FolderKanban, Hash, Mail, Video, type LucideIcon } from "lucide-react";

const STREAMS: { icon: LucideIcon; label: string }[] = [
  { icon: Mail, label: "Email" },
  { icon: Calendar, label: "Calendars" },
  { icon: Hash, label: "Chats" },
  { icon: Video, label: "Meetings" },
];

/** Onboarding step 1: one screen of intro. The footer's primary button is the single CTA. */
export function Welcome({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="ob-welcome" aria-label="Welcome to Scout">
    <div className="ob-welcome__streams" aria-hidden>
      {STREAMS.map(({ icon: Icon, label }) => <span key={label} className="ob-welcome__stream"><Icon size={16} strokeWidth={1.9} />{label}</span>)}
      <span className="ob-welcome__arrow" />
      <span className="ob-welcome__stream ob-welcome__stream--dest"><FolderKanban size={16} strokeWidth={1.9} />Your projects</span>
    </div>
    <h1 className="ob-welcome__title">{title}</h1>
    <p className="ob-welcome__sub">{subtitle}</p>
  </section>;
}
