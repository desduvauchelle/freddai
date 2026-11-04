import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'android-entry', transformIndexHtml: { order: 'pre', handler: html => html.replace('/src/main.tsx', '/src/mobile.tsx') } }],
  build: { outDir: 'dist-android', target: 'chrome105' },
}));
