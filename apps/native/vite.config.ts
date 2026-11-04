import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
const host = process.env.TAURI_DEV_HOST;
export default defineConfig({
  // React Compiler memoizes components automatically; packages/app is source-imported, so it is compiled by this same pipeline.
  plugins: [react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: host || "127.0.0.1", hmr: host ? { host, protocol: "ws", port: 1421 } : undefined },
  build: { target: "safari15" },
});
