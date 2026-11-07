import { ThemePicker } from "@/components/ThemePicker";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { guides } from "@/lib/docs";
import { localizedPath } from "@/lib/i18n-utils";

export function SiteFooter({ locale, dict }: { locale: string; dict: Dictionary }) {
  return <footer className="shell docs-footer">
    <div className="footer-top"><a className="brand-link" href={localizedPath("/", locale)}><img src="/brand/icon.svg" width="36" height="36" alt="" />Freddai</a><p>{dict.footer}</p></div>
    <nav aria-label="Documentation" className="footer-guides"><a href={localizedPath("/docs", locale)}>Documentation</a>{guides.map(guide => <a key={guide.slug} href={localizedPath(`/docs/${guide.slug}`, locale)}>{guide.title}</a>)}</nav>
    <div className="footer-bottom"><p>Your subscriptions. Your projects. One workspace.</p><div className="footer-controls"><a href="https://github.com/desduvauchelle/freddai" className="text-link">{dict.source} ↗</a><ThemePicker dict={dict} /></div></div>
  </footer>;
}
