/**
 * Porta Settings Persistence
 *
 * Read/write settings to ~/.porta/settings.json.
 * Settings control speech recognition provider, API keys, etc.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const SETTINGS_DIR = join(homedir(), ".porta");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

export interface SpeechSettings {
  provider: "deepinfra" | "elevenlabs";
  apiKey: string;
  model?: string;
}

export interface PortaSettings {
  speech?: SpeechSettings;
}

const DEFAULT_SETTINGS: PortaSettings = {};

export async function loadSettings(): Promise<PortaSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: PortaSettings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

/** Returns settings with API key masked for client display. */
export function maskSettings(settings: PortaSettings): PortaSettings {
  if (!settings.speech?.apiKey) return settings;
  const key = settings.speech.apiKey;
  const masked =
    key.length > 8
      ? key.slice(0, 4) + "•".repeat(key.length - 8) + key.slice(-4)
      : "•".repeat(key.length);
  return {
    ...settings,
    speech: { ...settings.speech, apiKey: masked },
  };
}
