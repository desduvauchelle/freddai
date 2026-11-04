import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supportedLocales, isSupportedLocale } from "@/i18n/config";
import { Providers } from "@/components/Providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "../globals.css";

export const metadata: Metadata = {
  title: "Freddai | A home for your coding threads",
  description: "A native workspace for your Codex and Claude Code sessions, projects, and next steps.",
  icons: { icon: "/brand/icon.svg" },
};

export function generateStaticParams() { return supportedLocales.map(locale => ({ locale })); }

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <html lang={locale} data-theme="light" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
    <body><Providers locale={locale}>{children}</Providers></body>
  </html>;
}
