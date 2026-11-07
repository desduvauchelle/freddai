import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findGuide, guides } from "@/lib/docs";
import { localizedPath } from "@/lib/i18n-utils";

type Props = { params: Promise<{ locale: string; slug: string }> };
export function generateStaticParams() { return guides.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();
  return { title: `${guide.title} | Freddai documentation`, description: guide.description };
}
export default async function GuidePage({ params }: Props) {
  const { locale, slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();
  const index = guides.indexOf(guide);
  const next = guides[index + 1];
  return <main id="content" className="shell docs-layout">
    <aside className="docs-sidebar"><nav aria-label="Guides"><a className="eyebrow" href={localizedPath("/docs", locale)}>Documentation</a>{guides.map(item => <a key={item.slug} href={localizedPath(`/docs/${item.slug}`, locale)} aria-current={item.slug === slug ? "page" : undefined}>{item.title}</a>)}</nav><nav className="docs-toc" aria-label="On this page"><p className="eyebrow">On this page</p>{guide.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav></aside>
    <article className="docs-article"><a className="text-link" href={localizedPath("/docs", locale)}>← All guides</a><h1>{guide.title}</h1><p className="docs-intro">{guide.description}</p>
      <figure className={`docs-figure docs-${guide.image}`}><a href={`/screenshots/${guide.image}.png`}><img src={`/screenshots/${guide.image}.png`} width={guide.image === "desktop" ? 1200 : 768} height={guide.image === "desktop" ? 760 : 860} alt={guide.image === "desktop" ? "Freddai desktop dashboard showing project groups and coding threads" : "Freddai tablet companion preview showing projects and active threads"} /></a><figcaption>{guide.image === "desktop" ? "Desktop" : "Companion"} product preview with illustrative projects; actions disabled. Select to view full size.</figcaption></figure>
      {guide.sections.map(section => <section className="docs-section" id={section.id} key={section.id}><h2><a href={`#${section.id}`}>{section.title}</a></h2><p>{section.body}</p>{section.steps && <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}{section.example && <div className="prompt-example"><p className="eyebrow">Try this prompt</p><blockquote>{section.example}</blockquote></div>}</section>)}
      {slug === "features" && <p className="docs-resource"><a className="text-link" href="https://github.com/desduvauchelle/freddai/blob/main/docs/android.md">Read the Android beta setup guide ↗</a></p>}
      <aside className="docs-note"><p className="eyebrow">{next ? "Up next" : "Keep exploring"}</p><h2>{next?.title || "Your first task"}</h2><p>{next?.description || "Put your workspace to work with a focused first thread."}</p><a className="text-link" href={localizedPath(`/docs/${next?.slug || "getting-started"}`, locale)}>Continue reading →</a><a className="text-link docs-download" href={`${localizedPath("/", locale)}#download`}>Download Freddai ↓</a></aside>
    </article>
  </main>;
}
