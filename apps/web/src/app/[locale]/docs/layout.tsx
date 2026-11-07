import { getDictionary } from "@/i18n";
import { localizedPath } from "@/lib/i18n-utils";
import { SiteFooter } from "@/components/SiteFooter";

export default async function DocsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const home = localizedPath("/", locale);
  return <>
    <a className="skip-link btn btn-primary" href="#content">{dict.skip}</a>
    <header className="shell site-header"><a className="brand-link" href={home}><img src="/brand/icon.svg" width="44" height="44" alt="" />Freddai</a><nav className="main-nav" aria-label={dict.navigation}><a href={localizedPath("/docs", locale)}>Docs</a><a className="btn btn-sm btn-primary" href={`${home}#download`}>{dict.download}</a></nav></header>
    {children}
    <SiteFooter locale={locale} dict={dict} />
  </>;
}
