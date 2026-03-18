import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function toHttpOrigin(host: string, port: string) {
  const normalizedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

// Try to load Tailscale TLS certs for HTTPS
function loadTlsCerts() {
  const certPath = join(repoRoot, ".certs", "cert.pem");
  const keyPath = join(repoRoot, ".certs", "key.pem");
  if (existsSync(certPath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certPath, "utf-8"),
      key: readFileSync(keyPath, "utf-8"),
    };
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const proxyHost = env.PORTA_HOST || process.env.PORTA_HOST || "127.0.0.1";
  const proxyPort = env.PORTA_PORT || process.env.PORTA_PORT || "3170";
  const tls = loadTlsCerts();

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          // Import push notification handler into the service worker
          importScripts: ["/sw-push.js"],
        },
        // Enable service worker in dev mode (required for push notifications)
        devOptions: {
          enabled: true,
        },
        manifest: false, // Use our existing public/manifest.json
        injectRegister: "script-defer",
      }),
    ],
    envDir: repoRoot,
    server: {
      port: 5174,
      // Bind to 0.0.0.0 so both Tailscale IP and DNS hostname work
      host: "0.0.0.0",
      // Enable HTTPS if certs are available
      ...(tls ? { https: tls } : {}),
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
