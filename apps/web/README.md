# Freddai distribution website

Next.js App Router, Tailwind CSS 4, and daisyUI 5. Run `pnpm dev` from the workspace root. `pnpm --filter @freddai/web build` prerenders the English landing page; `pnpm --filter @freddai/web start` serves the production build on port 3000.

The website has its own styles. It does not import the native product's shadcn styles or call native APIs. No authentication, analytics, contact form, or public blog is enabled.

## Recursive Engine foundation

Adapted from the local `@growth-engine/create-client-app` template version 0.1.178: SDK handler, security headers, database fallback helper, theme model, default-language URL rules, and locale proxy. SDK dependencies use the matching versioned GitHub distributions. The full starter's demo pages and unrelated features were intentionally omitted from this existing workspace.

`/api/rs/[...route]` uses the real SDK handler. Without credentials, it reports disabled and returns empty content. `src/lib/content.ts` provides the server-side blog read seam for a future blog. Structural blog links are declared false until the relevant blog components and topic routes actually exist. The client provider has contact conversion tracking disabled.

Copy `.env.example` to `.env.local` only when configuring integrations. Do not copy credentials from another business. Brain and Turso variables are server-only. Remote onboarding, database provisioning, and production connection are separate steps requiring authorization. Static content is prerendered, but locale routing and the SDK endpoint require a Next.js server; this is not an `output: export` bundle.

## Downloads

Set `MACOS_DOWNLOAD_URL` to the HTTPS URL of a real distribution release and rebuild. Until then, the page displays an honest coming-soon state. The locally installed debug app is not a public release. Notarization, public hosting, and release publishing are outside this setup.

## Localization

English lives at `/`; `/en` permanently redirects there. Locale URLs follow the client template's convention: secondary languages live at `/fr`, etc. Copy `src/i18n/dictionaries/en.ts`, translate the copy, register its loader in `src/i18n/index.ts`, then add its code to `ADDITIONAL_LANGUAGES` and rebuild. The default locale must also have a dictionary. All landing copy belongs in dictionaries; links must use `localizedPath`. The root locale layout sets the document language. Add locale metadata and sitemap entries when introducing translated pages and a final public domain.

## Verification

Run `pnpm typecheck` and `pnpm --filter @freddai/web build`. With the production server running without integration credentials, run:

```sh
WEB_TEST_URL=http://127.0.0.1:3000 node --test apps/web/tests/foundation.test.mjs
```

Without `WEB_TEST_URL`, only the pure download and theme checks run. Integration checks cover root HTTP 200, canonical redirect, 404, SDK disabled mode, security headers, and cross-origin rejection. The root check guards a NextURL loopback-host normalization issue: proxy URLs retain the actual request Host, and `skipProxyUrlNormalize` prevents the Next.js adapter from normalizing it again.

SDK 0.1.178 has an upstream packaging warning for the optional `growth-engine-pull-forms` CLI bin path. Runtime imports build successfully. The form-pulling CLI is not configured or required here.
