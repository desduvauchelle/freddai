import { getDictionary } from "@/i18n";
import { localizedPath } from "@/lib/i18n-utils";
import { latestDownloads } from "@/lib/download";
import { ThemePicker } from "@/components/ThemePicker";

export const revalidate = 300;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const d = await getDictionary(locale);
  const home = localizedPath("/", locale);
  const downloads = await latestDownloads();
  return <>
    <a className="skip-link btn btn-primary" href="#content">{d.skip}</a>
    <header className="shell flex flex-wrap items-center justify-between gap-5 py-6">
      <a href={home} className="flex items-center gap-3 text-xl font-bold tracking-tight"><img src="/brand/icon.svg" width="44" height="44" alt="" />Freddai</a>
      <nav aria-label={d.navigation} className="flex items-center gap-5 text-sm">
        <a className="link link-hover" href={`${home}#overview`}>{d.about}</a>
        <a className="btn btn-sm btn-outline" href={`${home}#download`}>{d.download}</a>
      </nav>
    </header>
    <main id="content">
      <section className="shell hero-grid">
        <div className="py-10 lg:py-20">
          <p className="eyebrow">{d.eyebrow}</p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-7xl">{d.title}</h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed opacity-80">{d.intro}</p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <a className="btn btn-primary" href="#download">{d.cta}</a>
            <a className="link link-hover text-sm" href="#overview">{d.learn} <span aria-hidden="true">↗</span></a>
          </div>
          <p className="mt-5 text-xs opacity-70">{d.stage}</p>
        </div>
        <figure className="mascot-stage">
          <img src="/brand/dormouse.svg" width="420" height="420" alt={d.companion} className="w-full max-w-[420px]" />
          <figcaption className="text-sm opacity-70">{d.companionCaption}</figcaption>
        </figure>
      </section>
      <section id="overview" className="shell border-t border-base-content/15 py-16 lg:py-24">
        <div className="grid gap-6 md:grid-cols-2 md:gap-16">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{d.aboutTitle}</h2>
          <p className="max-w-xl leading-relaxed opacity-80">{d.aboutBody}</p>
        </div>
        <dl className="mt-12 grid gap-8 md:grid-cols-3">
          {[[d.projectsTitle, d.projectsBody], [d.agentsTitle, d.agentsBody], [d.attentionTitle, d.attentionBody]].map(([title, body], i) =>
            <div key={title} className="border-t border-base-content/15 pt-5">
              <span className="font-mono text-xs opacity-60">0{i + 1}</span>
              <dt className="mt-4 font-semibold">{title}</dt><dd className="mt-3 text-sm leading-relaxed opacity-80">{body}</dd>
            </div>)}
        </dl>
      </section>
      <section id="download" className="bg-base-200 py-16 lg:py-20">
        <div className="shell">
          <p className="eyebrow">{d.downloadHeading}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{d.downloadTitle}</h2>
          <p className="mt-5 max-w-2xl leading-relaxed opacity-80">{d.downloadBody}</p>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {name: "Mac", url: downloads.mac, label: d.downloadMac, detail: d.macDetail, pending: d.unavailable},
              {name: "Linux", url: downloads.linux || downloads.linuxDeb, label: d.downloadLinux, detail: d.linuxDetail, pending: d.unavailable},
              {name: "Windows", url: downloads.windows, label: d.downloadWindows, detail: d.windowsDetail, pending: d.windowsPending},
              {name: "iPhone", url: downloads.ios, label: d.downloadIos, detail: d.iosDetail, pending: d.iosPending},
            ].map(platform => <article key={platform.name} className="flex flex-col items-start border-t border-base-content/20 pt-5">
              <h3 className="text-xl font-semibold">{platform.name}</h3>
              <p className="mt-3 mb-6 text-sm leading-relaxed opacity-75">{platform.detail}</p>
              {platform.url ? <a className="btn btn-primary mt-auto" href={platform.url}>{platform.label}</a> : <div className="mt-auto"><button className="btn btn-outline" disabled>{platform.label}</button><p className="mt-3 min-h-10 text-xs leading-relaxed opacity-70">{platform.pending}</p></div>}
              {platform.name === "Linux" && downloads.linux && downloads.linuxDeb && <a className="link mt-3 text-sm" href={downloads.linuxDeb}>{d.downloadDeb}</a>}
            </article>)}
          </div>
          <p className="mt-8 max-w-2xl text-xs leading-relaxed opacity-70">{d.requirements}</p>
        </div>
      </section>
    </main>
    <footer className="shell flex flex-wrap items-center justify-between gap-5 py-8"><p className="text-sm opacity-70">Freddai · {d.footer}</p><ThemePicker dict={d} /></footer>
  </>;
}
