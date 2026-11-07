import type { Metadata } from "next";
import { guides } from "@/lib/docs";
import { localizedPath } from "@/lib/i18n-utils";

export const metadata: Metadata = { title: "Documentation | Freddai", description: "Learn to connect agents, start coding threads, and use the Freddai desktop and mobile companion." };

export default async function Docs({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <main id="content" className="shell docs-hub">
    <p className="eyebrow">The Freddai handbook</p><h1>A little guidance.<br />More room to build.</h1><p className="docs-intro">From connecting your first agent to keeping up with work on your phone. Find your next step here.</p>
    <div className="guide-cards">{guides.map((guide, index) => <a className="guide-card" key={guide.slug} href={localizedPath(`/docs/${guide.slug}`, locale)}><span className="eyebrow">0{index + 1} / {index < 2 ? "Start here" : "Explore"}</span><h2>{guide.title} <span aria-hidden="true">↗</span></h2><p>{guide.description}</p><span className="text-link">Read the guide →</span></a>)}</div>
    <figure className="docs-figure"><a href="/screenshots/desktop.png"><img src="/screenshots/desktop.png" width="1200" height="760" alt="Freddai desktop preview with project groups, activity, and coding threads" loading="lazy" /></a><figcaption>Desktop product preview with illustrative projects; actions disabled. Select the screenshot to view it full size.</figcaption></figure>
    <aside className="docs-note"><h2>New to Freddai?</h2><p>Start with Onboarding, then follow Getting started for your first task. Bring your own provider account and coding-agent CLI; Freddai keeps your workspace together.</p><a className="text-link" href={localizedPath("/docs/onboarding", locale)}>Set up your workspace →</a></aside>
  </main>;
}
