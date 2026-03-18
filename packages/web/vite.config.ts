import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function toHttpOrigin(host: string, port: string) {
  const normalizedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const proxyHost = env.PORTA_HOST || process.env.PORTA_HOST || "127.0.0.1";
  const proxyPort = env.PORTA_PORT || process.env.PORTA_PORT || "3170";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        },
        manifest: false, // Use our existing public/manifest.json
        injectRegister: "script-defer",
      }),
    ],
    envDir: repoRoot,
    server: {
      port: 5174,
      host: proxyHost !== "127.0.0.1" ? proxyHost : undefined,
      proxy: {
        "/api": {
          target: toHttpOrigin(proxyHost, proxyPort),
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
