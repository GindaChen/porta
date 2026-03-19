import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useAppearance, DEFAULTS } from "../hooks/useAppearance";
import type { AppearanceSettings } from "../hooks/useAppearance";

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

// ── Color helpers ──

function rgbToHex(triplet: string): string {
  const [r, g, b] = triplet.split(" ").map(Number);
  return (
    "#" +
    [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return DEFAULTS.accentColor;
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

// ── Range slider with live label ──

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="appearance-control">
      <label className="settings-label">
        {label}
        <span className="appearance-value">
          {value}
          {unit ?? "px"}
        </span>
      </label>
      <input
        className="appearance-range"
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function SettingsPage() {
  const { settings: appearance, update: updateAppearance, reset: resetAppearance } = useAppearance();
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
      navigator.serviceWorker?.getRegistration("/").then((reg) => {
        if (reg) {
          reg.pushManager.getSubscription().then((sub) => {
            setPushSubscribed(!!sub);
          });
        }
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

      // 2. Ensure a service worker is registered (sw-push.js handles push events)
      let reg: ServiceWorkerRegistration;
      const existingReg = await navigator.serviceWorker.getRegistration("/");
      if (existingReg) {
        reg = existingReg;
      } else {
        reg = await navigator.serviceWorker.register("/sw-push.js", { scope: "/" });
        // Wait for it to be active
        await new Promise<void>((resolve, reject) => {
          const sw = reg.installing || reg.waiting || reg.active;
          if (reg.active) { resolve(); return; }
          if (!sw) { reject(new Error("Service worker failed to install")); return; }
          const timeout = setTimeout(() => reject(new Error("Service worker activation timed out")), 8000);
          sw.addEventListener("statechange", () => {
            if (sw.state === "activated") { clearTimeout(timeout); resolve(); }
          });
        });
      }

      // 3. Get VAPID public key from proxy
      const { publicKey } = await api.getVapidKey();

      // 4. Subscribe via PushManager
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 5. Send subscription to proxy
      await api.subscribePush(sub.toJSON());

      setPushSubscribed(true);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to subscribe");
    } finally {
      setPushLoading(false);
    }
  }, []);

  const handleUnsubscribePush = useCallback(async () => {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
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

  const [pollDraft, setPollDraft] = useState(pollIntervalSec);
  const pollDirty = pollDraft !== pollIntervalSec;

  const handleSavePollInterval = useCallback(async () => {
    const sec = pollDraft;
    setPollIntervalSec(sec);
    try {
      await api.setPollInterval(sec * 1000);
    } catch {
      // Ignore
    }
  }, [pollDraft]);

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

        {/* ── Appearance ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Appearance</h3>
          <p className="settings-section-desc">
            Customize the look and feel. Changes apply instantly.
          </p>

          {/* Theme preset */}
          <div className="appearance-control">
            <label className="settings-label">Theme</label>
            <select
              className="settings-select"
              value={appearance.theme}
              onChange={(e) =>
                updateAppearance("theme", e.target.value as AppearanceSettings["theme"])
              }
            >
              <option value="dark">Dark</option>
              <option value="midnight">Midnight</option>
              <option value="warm">Warm</option>
            </select>
          </div>

          {/* Accent color */}
          <div className="appearance-control">
            <label className="settings-label">Accent Color</label>
            <div className="appearance-color-row">
              <input
                type="color"
                className="appearance-color-input"
                value={rgbToHex(appearance.accentColor)}
                onChange={(e) => updateAppearance("accentColor", hexToRgb(e.target.value))}
              />
              <span className="appearance-color-label">
                {rgbToHex(appearance.accentColor)}
              </span>
            </div>
          </div>

          {/* Swiper controls */}
          <div className="appearance-group">
            <label className="settings-label" style={{ marginBottom: 4 }}>Chat Swiper</label>
            <div className="appearance-toggle-row">
              <span className="appearance-toggle-label">Show swiper</span>
              <button
                className={`appearance-toggle ${appearance.swiperVisible ? "on" : ""}`}
                onClick={() => updateAppearance("swiperVisible", !appearance.swiperVisible)}
              >
                <span className="appearance-toggle-thumb" />
              </button>
            </div>
            {appearance.swiperVisible && (
              <>
                <div className="appearance-toggle-row">
                  <span className="appearance-toggle-label">All projects</span>
                  <button
                    className={`appearance-toggle ${appearance.swiperAllProjects ? "on" : ""}`}
                    onClick={() => updateAppearance("swiperAllProjects", !appearance.swiperAllProjects)}
                  >
                    <span className="appearance-toggle-thumb" />
                  </button>
                </div>
                <SliderControl
                  label="Chip width"
                  value={appearance.swiperChipWidth}
                  min={80}
                  max={200}
                  onChange={(v) => updateAppearance("swiperChipWidth", v)}
                />
                <SliderControl
                  label="Chip height"
                  value={appearance.swiperChipHeight}
                  min={24}
                  max={60}
                  onChange={(v) => updateAppearance("swiperChipHeight", v)}
                />
                <SliderControl
                  label="Max visible"
                  value={appearance.swiperMaxVisible}
                  min={3}
                  max={15}
                  unit=""
                  onChange={(v) => updateAppearance("swiperMaxVisible", v)}
                />
                <SliderControl
                  label="Active glow"
                  value={appearance.swiperActiveGlow}
                  min={0}
                  max={20}
                  onChange={(v) => updateAppearance("swiperActiveGlow", v)}
                />
                <SliderControl
                  label="Active border"
                  value={Math.round(appearance.swiperActiveBorderOpacity * 100)}
                  min={20}
                  max={100}
                  unit="%"
                  onChange={(v) => updateAppearance("swiperActiveBorderOpacity", v / 100)}
                />
                <SliderControl
                  label="Dot size"
                  value={appearance.swiperDotSize}
                  min={4}
                  max={16}
                  onChange={(v) => updateAppearance("swiperDotSize", v)}
                />
                <div className="appearance-control">
                  <label className="settings-label">Layout</label>
                  <select
                    className="settings-select"
                    value={appearance.swiperLayout}
                    onChange={(e) =>
                      updateAppearance("swiperLayout", e.target.value as "scroll" | "grid")
                    }
                  >
                    <option value="scroll">Scroll</option>
                    <option value="grid">Grid</option>
                  </select>
                </div>
                {appearance.swiperLayout === "grid" && (
                  <>
                    <SliderControl
                      label="Grid columns"
                      value={appearance.swiperGridColumns}
                      min={2}
                      max={6}
                      unit=""
                      onChange={(v) => updateAppearance("swiperGridColumns", v)}
                    />
                    <SliderControl
                      label="Grid rows"
                      value={appearance.swiperGridRows}
                      min={1}
                      max={4}
                      unit=""
                      onChange={(v) => updateAppearance("swiperGridRows", v)}
                    />
                  </>
                )}
              </>
            )}
          </div>

          {/* Per-project color overrides */}
          {appearance.swiperVisible && appearance.swiperAllProjects && (
            <div className="appearance-group">
              <label className="settings-label" style={{ marginBottom: 4 }}>Project Colors</label>
              <p className="settings-section-desc" style={{ margin: "0 0 8px", fontSize: 11 }}>
                Override the auto-assigned color for each project.
              </p>
              {Object.entries(appearance.projectColorOverrides).map(([name, hex]) => (
                <div key={name} className="appearance-color-row" style={{ marginBottom: 6 }}>
                  <input
                    type="color"
                    className="appearance-color-input"
                    value={hex}
                    onChange={(e) => {
                      const next = { ...appearance.projectColorOverrides, [name]: e.target.value };
                      updateAppearance("projectColorOverrides", next);
                    }}
                  />
                  <span className="appearance-color-label" style={{ flex: 1 }}>{name}</span>
                  <button
                    className="msg-action-btn"
                    title="Remove override"
                    onClick={() => {
                      const next = { ...appearance.projectColorOverrides };
                      delete next[name];
                      updateAppearance("projectColorOverrides", next);
                    }}
                    style={{ fontSize: 12, padding: "2px 6px" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="appearance-color-row" style={{ marginTop: 4 }}>
                <button
                  className="settings-save-btn"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-secondary)",
                    fontSize: 11,
                    padding: "6px 10px",
                  }}
                  onClick={() => {
                    const name = prompt("Project name to add a color for:");
                    if (name?.trim()) {
                      const next = {
                        ...appearance.projectColorOverrides,
                        [name.trim()]: "#6c8bef",
                      };
                      updateAppearance("projectColorOverrides", next);
                    }
                  }}
                >
                  + Add project color
                </button>
              </div>
            </div>
          )}

          {/* Input controls */}
          <div className="appearance-group">
            <label className="settings-label" style={{ marginBottom: 4 }}>Input</label>
            <SliderControl
              label="Model selector width"
              value={appearance.modelSelectorWidth}
              min={80}
              max={220}
              onChange={(v) => updateAppearance("modelSelectorWidth", v)}
            />
          </div>

          {/* Text controls */}
          <div className="appearance-group">
            <label className="settings-label" style={{ marginBottom: 4 }}>Text</label>
            <SliderControl
              label="Message font size"
              value={appearance.messageFontSize}
              min={12}
              max={18}
              step={0.5}
              onChange={(v) => updateAppearance("messageFontSize", v)}
            />
            <SliderControl
              label="Code font size"
              value={appearance.codeFontSize}
              min={10}
              max={16}
              step={0.5}
              onChange={(v) => updateAppearance("codeFontSize", v)}
            />
          </div>

          {/* Layout controls */}
          <div className="appearance-group">
            <label className="settings-label" style={{ marginBottom: 4 }}>Layout</label>
            <SliderControl
              label="Border radius"
              value={appearance.borderRadius}
              min={0}
              max={20}
              onChange={(v) => updateAppearance("borderRadius", v)}
            />
            <div className="appearance-control">
              <label className="settings-label">Density</label>
              <select
                className="settings-select"
                value={appearance.density}
                onChange={(e) =>
                  updateAppearance("density", e.target.value as AppearanceSettings["density"])
                }
              >
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="spacious">Spacious</option>
              </select>
            </div>
          </div>

          {/* Reset */}
          <button
            className="settings-save-btn"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
            onClick={resetAppearance}
          >
            Reset to Defaults
          </button>
        </section>

        <hr className="settings-divider" />

        {/* ── Notifications ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Notifications</h3>

          <div className="appearance-toggle-row" style={{ marginBottom: 12 }}>
            <span className="appearance-toggle-label">In-app toasts</span>
            <button
              className={`appearance-toggle ${appearance.showToasts ? "on" : ""}`}
              onClick={() => updateAppearance("showToasts", !appearance.showToasts)}
            >
              <span className="appearance-toggle-thumb" />
            </button>
          </div>

          <h4 className="settings-label" style={{ marginBottom: 4 }}>Push Notifications</h4>
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
                  min={0}
                  max={60}
                  value={pollDraft}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0 && v <= 60) setPollDraft(v);
                  }}
                  style={{ width: 70, textAlign: "center" }}
                />
                <span className="settings-poll-unit">seconds</span>
                {pollDirty && (
                  <button
                    className="settings-save-btn"
                    onClick={handleSavePollInterval}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Save
                  </button>
                )}
              </div>
              {pollDraft === 0 && (
                <p className="settings-section-desc" style={{ fontSize: 11, marginTop: 2 }}>
                  Polling disabled — no automatic checks.
                </p>
              )}

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
