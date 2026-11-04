import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
// The iPhone bundles only companion screens; desktop setup is not shipped to it.
export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'iphone-entry', transformIndexHtml: { order: 'pre', handler: html => html.replace('/src/main.tsx', '/src/mobile.tsx') } }],
  build: { outDir: 'dist-ios', target: 'safari16' },
}));
