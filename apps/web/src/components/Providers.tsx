"use client";

import { GrowthEngineProvider } from "@growth-engine/sdk-client";

export function Providers({ children, locale }: { children: React.ReactNode; locale: string }) {
  return <GrowthEngineProvider locale={locale} trackContactClicks={false}>{children}</GrowthEngineProvider>;
}
