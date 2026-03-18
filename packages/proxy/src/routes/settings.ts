/**
 * Settings API Routes
 *
 * GET  /api/settings  — returns current settings (API key masked)
 * PUT  /api/settings  — saves settings
 */

import type { Hono } from "hono";
import { loadSettings, saveSettings, maskSettings } from "../settings.js";

export function registerSettingsRoutes(app: Hono) {
  app.get("/api/settings", async (c) => {
    const settings = await loadSettings();
    return c.json(maskSettings(settings));
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json();

    // Merge: if the client sends a masked key (with dots), keep the existing key
    const existing = await loadSettings();
    if (body.speech?.apiKey?.includes("•") && existing.speech?.apiKey) {
      body.speech.apiKey = existing.speech.apiKey;
    }

    await saveSettings(body);
    return c.json({ ok: true });
  });
}
