/**
 * Settings Page
 *
 * Configure notifications, speech recognition provider, and API key.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

type Provider = "deepinfra" | "elevenlabs";

interface SpeechSettings {
  provider: Provider;
  apiKey: string;
  model?: string;
}

interface PortaSettings {
  speech?: SpeechSettings;
}

const PROVIDER_INFO: Record<
  Provider,
  { label: string; defaultModel: string; signupUrl: string }
> = {
  deepinfra: {
    label: "DeepInfra (Whisper)",
    defaultModel: "openai/whisper-large-v3-turbo",
    signupUrl: "https://deepinfra.com/dash/api_keys",
  },
  elevenlabs: {
    label: "ElevenLabs (Scribe)",
    defaultModel: "scribe_v2",
    signupUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
};

const notificationsSupported =
  typeof window !== "undefined" && "Notification" in window;

export function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("deepinfra");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Notification state
  const [notifPermission, setNotifPermission] = useState<string>(
    notificationsSupported ? Notification.permission : "denied",
  );

  // Load existing settings
  useEffect(() => {
    api
      .getSettings()
      .then((settings: PortaSettings) => {
        if (settings.speech) {
          setProvider(settings.speech.provider);
          setApiKey(settings.speech.apiKey);
          setModel(settings.speech.model ?? "");
        }
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
      });
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    setErrorMsg("");
    try {
      const settings: PortaSettings = {
        speech: {
          provider,
          apiKey,
          ...(model ? { model } : {}),
        },
      };
      await api.saveSettings(settings);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to save");
    }
  }, [provider, apiKey, model]);

  const handleEnableNotifications = useCallback(async () => {
    if (!notificationsSupported) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === "granted") {
      try {
        new Notification("🔔 Notifications Enabled", {
          body: "You'll be notified when tasks complete.",
          icon: "/favicon.ico",
        });
      } catch {
        // May fail in some contexts
      }
    }
  }, []);

  if (!loaded) {
    return (
      <div className="settings-page">
        <div className="settings-card">
          <p className="settings-loading">Loading…</p>
        </div>
      </div>
    );
  }

  const info = PROVIDER_INFO[provider];

  return (
    <div className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
        </div>

        {/* ── Notifications ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Notifications</h3>
          <p className="settings-section-desc">
            Get notified when a task finishes running.
          </p>

          <div className="settings-notif-status settings-notif-granted">
            <span>🔔</span>
            <span>In-app alerts active (toast + sound)</span>
          </div>

          {notificationsSupported && notifPermission !== "granted" && notifPermission !== "denied" && (
            <button
              className="settings-save-btn"
              onClick={handleEnableNotifications}
              style={{ marginTop: 4 }}
            >
              Also Enable Push Notifications
            </button>
          )}

          {notificationsSupported && notifPermission === "granted" && (
            <div className="settings-notif-status settings-notif-granted" style={{ marginTop: 4 }}>
              <span>✅</span>
              <span>Push notifications also enabled</span>
            </div>
          )}

          {!notificationsSupported && (
            <p className="settings-section-desc" style={{ color: "var(--text-tertiary)", marginTop: 4, fontSize: 11 }}>
              Push notifications require HTTPS. In-app alerts work over HTTP.
            </p>
          )}
        </section>

        <hr className="settings-divider" />

        {/* ── Speech Recognition ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Speech Recognition</h3>
          <p className="settings-section-desc">
            Configure a speech-to-text provider so the mic button works on all
            browsers, including iOS Safari.
          </p>

          <label className="settings-label">Provider</label>
          <select
            className="settings-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            {Object.entries(PROVIDER_INFO).map(([key, val]) => (
              <option key={key} value={key}>
                {val.label}
              </option>
            ))}
          </select>

          <label className="settings-label">
            API Key
            <a
              className="settings-key-link"
              href={info.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get one →
            </a>
          </label>
          <input
            className="settings-input"
            type="password"
            placeholder="Enter API key…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />

          <label className="settings-label">
            Model{" "}
            <span className="settings-optional">(optional)</span>
          </label>
          <input
            className="settings-input"
            type="text"
            placeholder={info.defaultModel}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />

          <button
            className={`settings-save-btn ${status}`}
            onClick={handleSave}
            disabled={status === "saving" || !apiKey.trim()}
          >
            {status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "✓ Saved"
                : "Save"}
          </button>

          {errorMsg && <p className="settings-error">{errorMsg}</p>}
        </section>
      </div>
    </div>
  );
}
