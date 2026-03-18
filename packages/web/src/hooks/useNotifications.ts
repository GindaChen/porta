/**
 * In-app notification system.
 *
 * Tracks conversation status changes and shows an in-app toast + audio chime
 * when a task finishes running. Works on ALL browsers and protocols (no HTTPS
 * required, unlike browser Notification API).
 *
 * Also attempts browser Notification API if available (desktop Chrome, etc).
 */

import { useRef, useCallback, useEffect, useState } from "react";
import type { ConversationEntry } from "./useConversations";

// Browser Notification API (only available on HTTPS or localhost)
const browserNotifSupported =
  typeof window !== "undefined" && "Notification" in window;

export interface Toast {
  id: string;
  title: string;
  body: string;
  timestamp: number;
}

// Simple chime via Web Audio API (works everywhere, no file needed)
function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1); // D6
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Web Audio not available
  }
}

export function useNotifications(conversations: ConversationEntry[]) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Track which conversations were running on the previous poll
  const prevRunningRef = useRef<Set<string>>(new Set());
  // Skip the first poll (initial load) to avoid false positives
  const initializedRef = useRef(false);

  // Browser notification permission
  const [browserPermission, setBrowserPermission] = useState<string>(
    browserNotifSupported ? Notification.permission : "unsupported",
  );

  const requestBrowserPermission = useCallback(async () => {
    if (!browserNotifSupported) return "unsupported";
    const result = await Notification.requestPermission();
    setBrowserPermission(result);
    return result;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Show an in-app toast + optional browser notification
  const showNotification = useCallback(
    (title: string, body: string, convId: string) => {
      // In-app toast (always works)
      const toast: Toast = {
        id: `${convId}-${Date.now()}`,
        title,
        body,
        timestamp: Date.now(),
      };
      setToasts((prev) => [...prev, toast]);

      // Auto-dismiss after 6 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 6000);

      // Play chime
      playChime();

      // Push notification via ServiceWorker (works on iOS PWA + desktop)
      if (browserNotifSupported && Notification.permission === "granted") {
        navigator.serviceWorker?.ready
          .then((reg) => {
            reg.showNotification(title, {
              body,
              icon: "/favicon.ico",
              badge: "/favicon.ico",
              tag: `porta-done-${convId}`,
            });
          })
          .catch(() => {
            // Fallback: try direct Notification (desktop browsers)
            try {
              new Notification(title, {
                body,
                icon: "/favicon.ico",
                tag: `porta-done-${convId}`,
              });
            } catch {
              // Ignore
            }
          });
      }
    },
    [],
  );

  // Auto-detect when conversations finish running
  useEffect(() => {
    if (conversations.length === 0) return;

    const currentRunning = new Set<string>();
    for (const conv of conversations) {
      if (conv.summary.status === "CASCADE_RUN_STATUS_RUNNING") {
        currentRunning.add(conv.id);
      }
    }

    // Skip notification on first poll (avoid false "done" on page load)
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevRunningRef.current = currentRunning;
      return;
    }

    // Find conversations that WERE running but are now done
    const prevRunning = prevRunningRef.current;
    for (const id of prevRunning) {
      if (!currentRunning.has(id)) {
        const conv = conversations.find((c) => c.id === id);
        if (conv) {
          const title = conv.summary.summary || "Conversation";
          showNotification("✅ Task Complete", title, id);
        }
      }
    }

    prevRunningRef.current = currentRunning;
  }, [conversations, showNotification]);

  return {
    toasts,
    dismissToast,
    browserNotifSupported,
    browserPermission,
    requestBrowserPermission,
  };
}
