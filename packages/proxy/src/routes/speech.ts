/**
 * Speech Transcription Route
 *
 * POST /api/speech/transcribe
 *   Accepts multipart form with "audio" file field.
 *   Forwards to the configured STT provider (DeepInfra or ElevenLabs).
 *   Returns { text: string }.
 */

import type { Hono } from "hono";
import { loadSettings } from "../settings.js";

const DEEPINFRA_URL =
  "https://api.deepinfra.com/v1/openai/audio/transcriptions";
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text";

const DEFAULT_MODELS: Record<string, string> = {
  deepinfra: "openai/whisper-large-v3-turbo",
  elevenlabs: "scribe_v2",
};

async function transcribeDeepInfra(
  audioBlob: Blob,
  apiKey: string,
  model: string,
): Promise<string> {
  const form = new FormData();
  form.append("model", model);
  form.append("file", audioBlob, "recording.webm");

  const res = await fetch(DEEPINFRA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepInfra ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

async function transcribeElevenLabs(
  audioBlob: Blob,
  apiKey: string,
  model: string,
): Promise<string> {
  const form = new FormData();
  form.append("model_id", model);
  form.append("file", audioBlob, "recording.webm");

  const res = await fetch(ELEVENLABS_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

export function registerSpeechRoutes(app: Hono) {
  app.post("/api/speech/transcribe", async (c) => {
    // Load settings
    const settings = await loadSettings();
    if (!settings.speech?.apiKey) {
      return c.json(
        {
          error:
            "Speech recognition not configured. Go to Settings to add an API key.",
        },
        400,
      );
    }

    const { provider, apiKey, model: customModel } = settings.speech;
    const model = customModel || DEFAULT_MODELS[provider] || DEFAULT_MODELS.deepinfra;

    // Parse multipart form
    const formData = await c.req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return c.json({ error: "Missing 'audio' file in form data." }, 400);
    }

    try {
      let text: string;
      if (provider === "elevenlabs") {
        text = await transcribeElevenLabs(audioFile, apiKey, model);
      } else {
        text = await transcribeDeepInfra(audioFile, apiKey, model);
      }

      return c.json({ text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Speech transcription failed:", message);
      return c.json({ error: `Transcription failed: ${message}` }, 502);
    }
  });
}
