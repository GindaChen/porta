/**
 * Settings Page
 *
 * Configure push notifications, poll interval, and speech recognition.
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

const pushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("deepinfra");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Push notification state
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState("");
  const [pollIntervalSec, setPollIntervalSec] = useState(10);

  // Load existing settings + push status
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

    // Check push status
    api.getPushStatus().then((s) => {
      setPollIntervalSec(Math.round(s.pollIntervalMs / 1000));
    }).catch(() => {});

    // Check if already subscribed
    if (pushSupported) {
      navigator.serviceWorker?.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushSubscribed(!!sub);
        });
      });
    }
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

  const handleSubscribePush = useCallback(async () => {
    setPushLoading(true);
    setPushError("");
    try {
      // 1. Request notification permission
      if (notificationsSupported) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setPushError("Notification permission denied. Check your browser/device settings.");
          setPushLoading(false);
          return;
        }
      }

      // 2. Get VAPID public key from proxy
      const { publicKey } = await api.getVapidKey();

      // 3. Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 4. Send subscription to proxy
      await api.subscribePush(sub.toJSON());

      setPushSubscribed(true);

      // Send a test push via the proxy to verify
      // (The proxy will use web-push to push to our subscription)
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to subscribe");
    } finally {
      setPushLoading(false);
    }
  }, []);

  const handleUnsubscribePush = useCallback(async () => {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
    } catch {
      // Ignore
    } finally {
      setPushLoading(false);
    }
  }, []);

  const handlePollIntervalChange = useCallback(async (sec: number) => {
    setPollIntervalSec(sec);
    try {
      await api.setPollInterval(sec * 1000);
    } catch {
      // Ignore
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
  const isHttps = location.protocol === "https:";

  return (
    <div className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
        </div>

        {/* ── Push Notifications ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Push Notifications</h3>
          <p className="settings-section-desc">
            Get notified on your lock screen when a task finishes — even when
            the app is closed.
          </p>

          {!isHttps ? (
            <div className="settings-notif-status settings-notif-denied">
              <span>🔒</span>
              <span>
                Push notifications require HTTPS. Access Porta via{" "}
                <strong>https://</strong> to enable.
              </span>
            </div>
          ) : !pushSupported ? (
            <div className="settings-notif-status settings-notif-denied">
              <span>🚫</span>
              <span>Push notifications are not supported in this browser.</span>
            </div>
          ) : pushSubscribed ? (
            <>
              <div className="settings-notif-status settings-notif-granted">
                <span>✅</span>
                <span>Push notifications enabled</span>
              </div>

              <label className="settings-label" style={{ marginTop: 8 }}>
                Check every
              </label>
              <div className="settings-poll-row">
                <input
                  className="settings-input"
                  type="number"
                  min={3}
                  max={60}
                  value={pollIntervalSec}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) handlePollIntervalChange(v);
                  }}
                  style={{ width: 70, textAlign: "center" }}
                />
                <span className="settings-poll-unit">seconds</span>
              </div>

              <button
                className="settings-save-btn"
                onClick={handleUnsubscribePush}
                disabled={pushLoading}
                style={{ marginTop: 8, background: "var(--bg-hover)", color: "var(--text-secondary)" }}
              >
                Disable Push
              </button>
            </>
          ) : (
            <button
              className="settings-save-btn"
              onClick={handleSubscribePush}
              disabled={pushLoading}
            >
              {pushLoading ? "Enabling…" : "Enable Push Notifications"}
            </button>
          )}

          {pushError && <p className="settings-error">{pushError}</p>}
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

// Helper: convert base64 VAPID key to Uint8Array for pushManager.subscribe()
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray as Uint8Array<ArrayBuffer>;
}
