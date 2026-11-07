import { getDictionary } from "@/i18n";
import { localizedPath } from "@/lib/i18n-utils";
import { latestDownloads } from "@/lib/download";
import { SiteFooter } from "@/components/SiteFooter";

export const revalidate = 300;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const d = await getDictionary(locale);
  const home = localizedPath("/", locale);
  const downloads = await latestDownloads();
  return <>
    <a className="skip-link btn btn-primary" href="#content">{d.skip}</a>
    <header className="shell site-header">
      <a href={home} className="brand-link"><img src="/brand/icon.svg" width="44" height="44" alt="" />Freddai</a>
      <nav aria-label={d.navigation} className="main-nav">
        <a className="link link-hover" href={`${home}#overview`}>{d.about}</a>
        <a className="nav-mobile" href={`${home}#mobile`}>{d.mobileNav}</a>
        <a className="btn btn-sm btn-primary" href={`${home}#download`}>{d.download}</a>
      </nav>
    </header>
    <main id="content">
      <section className="shell hero-section">
        <div className="hero-copy">
          <p className="eyebrow hero-pill"><span aria-hidden="true">✳</span> {d.eyebrow}</p>
          <h1>{d.title}</h1>
          <p className="hero-intro">{d.intro}</p>
          <div className="hero-actions"><a className="btn btn-primary" href="#download">{d.cta} <span aria-hidden="true">↓</span></a><a className="text-link" href="#mobile">{d.mobileNav} <span aria-hidden="true">↗</span></a></div>
          <p className="availability">{d.stage}</p>
        </div>
        <figure className="product-hero">
          <div className="screenshot-mat"><div className="window-bar" aria-hidden="true"><i/><i/><i/><span>freddai / home</span></div><img src="/screenshots/desktop.png" width="1200" height="760" alt={d.desktopAlt} fetchPriority="high" /></div>
          <div className="hero-sticker" aria-hidden="true"><img src="/brand/dormouse.svg" width="92" height="92" alt=""/><span>{d.companionCaption}</span></div>
          <figcaption>{d.heroCaption}</figcaption>
        </figure>
        <p className="proof-line">{d.proof}</p>
      </section>
      <section id="overview" className="shell section-space">
        <div className="section-heading"><p className="eyebrow">{d.switchEyebrow}</p><h2>{d.switchTitle}</h2><p>{d.switchBody}</p></div>
        <div className="benefit-grid">{[[d.switchOne,d.switchOneBody,"◴"],[d.switchTwo,d.switchTwoBody,"⇄"],[d.switchThree,d.switchThreeBody,"⌘"]].map(([title,body,icon]) => <article className="benefit" key={title}><span className="feature-icon" aria-hidden="true">{icon}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>
      <section id="mobile" className="companion-section">
        <div className="shell companion-grid">
          <div className="companion-copy"><p className="eyebrow">{d.mobileEyebrow}</p><h2>{d.mobileTitle}</h2><p className="section-lead">{d.mobileBody}</p><p>{d.mobileSetup}</p><a className="btn btn-primary" href="#download">{d.mobileLink} <span aria-hidden="true">↗</span></a></div>
          <figure className="tablet-preview"><div className="tablet-frame"><img src="/screenshots/companion.png" width="768" height="860" alt={d.mobileAlt} loading="lazy" /></div><figcaption>{d.mobileCaption}</figcaption></figure>
        </div>
      </section>
      <section id="features" className="shell section-space">
        <div className="section-heading"><p className="eyebrow">{d.workflowEyebrow}</p><h2>{d.workflowTitle}</h2></div>
        <div className="workflow-grid">{[[d.threadTitle,d.threadBody,"01"],[d.dashboardTitle,d.dashboardBody,"02"],[d.recapTitle,d.recapBody,"03"]].map(([title,body,num]) => <article key={title}><span className="step-number">{num}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
        <ol className="setup-steps">{[[d.flowOne,d.flowOneBody],[d.flowTwo,d.flowTwoBody],[d.flowThree,d.flowThreeBody]].map(([title,body],i) => <li key={title}><span aria-hidden="true">{i+1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
      </section>
      <section id="download" className="bg-base-200 py-16 lg:py-20">
        <div className="shell">
          <p className="eyebrow">{d.downloadHeading}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{d.downloadTitle}</h2>
          <p className="mt-5 max-w-2xl leading-relaxed opacity-80">{d.downloadBody}</p>
          <div className="download-grid">
            {[
              {name: "Mac", url: downloads.mac, label: d.downloadMac, detail: d.macDetail, pending: d.unavailable},
              {name: "Linux", url: downloads.linux || downloads.linuxDeb, label: d.downloadLinux, detail: d.linuxDetail, pending: d.unavailable},
              {name: "Windows", url: downloads.windows, label: d.downloadWindows, detail: d.windowsDetail, pending: d.windowsPending},
              {name: "Android", url: downloads.android, label: d.downloadAndroid, detail: d.androidDetail, pending: d.unavailable},
              {name: "iPhone & iPad", url: downloads.ios, label: d.downloadIos, detail: d.iosDetail, pending: d.iosPending},
            ].map(platform => <article key={platform.name} className="download-card">
              <h3 className="text-xl font-semibold">{platform.name}</h3>
              <p className="mt-3 mb-6 text-sm leading-relaxed opacity-75">{platform.detail}</p>
              {platform.url ? <a className="btn btn-primary mt-auto" href={platform.url}>{platform.label}</a> : <div className="mt-auto"><button className="btn btn-outline" disabled>{platform.label}</button><p className="mt-3 min-h-10 text-xs leading-relaxed opacity-70">{platform.pending}</p></div>}
              {platform.name === "Android" && platform.url && <a className="link mt-3 text-sm" href="https://github.com/desduvauchelle/freddai/blob/main/docs/android.md">{d.androidSetup}</a>}
              {platform.name === "Linux" && downloads.linux && downloads.linuxDeb && <a className="link mt-3 text-sm" href={downloads.linuxDeb}>{d.downloadDeb}</a>}
            </article>)}
          </div>
          <p className="mt-8 max-w-2xl text-xs leading-relaxed opacity-70">{d.requirements}</p>
        </div>
      </section>
      <section className="shell faq-section"><h2>{d.faqTitle}</h2><div>{[[d.faqOne,d.faqOneBody],[d.faqTwo,d.faqTwoBody],[d.faqThree,d.faqThreeBody],[d.faqFour,d.faqFourBody]].map(([question,answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
      <section className="shell final-cta"><img src="/brand/dormouse.svg" alt="" width="100" height="100" loading="lazy"/><h2>{d.startTitle}</h2><p>{d.startBody}</p><a className="btn btn-primary" href="#download">{d.cta} <span aria-hidden="true">↓</span></a></section>
    </main>
    <SiteFooter locale={locale} dict={d} />
  </>;
}
