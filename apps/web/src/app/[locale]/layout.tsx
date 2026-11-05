import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supportedLocales, isSupportedLocale } from "@/i18n/config";
import { Providers } from "@/components/Providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "../globals.css";

export const metadata: Metadata = {
  title: "Freddai | All your coding agents and accounts in one app",
  description: "Switch coding agents and accounts, see usage limits, organize project threads, and keep working from your phone or iPad with the Freddai companion.",
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
