/**
 * Hook for browser push notifications.
 *
 * - Requests permission on first call to `requestPermission()`
 * - `notify()` fires a notification if permission is granted
 * - Tracks conversation status changes to auto-notify when a run finishes
 */

import { useRef, useCallback, useEffect, useState } from "react";
import type { ConversationEntry } from "./useConversations";

type Permission = "default" | "granted" | "denied";

const isSupported =
  typeof window !== "undefined" && "Notification" in window;

export function useNotifications(conversations: ConversationEntry[]) {
  const [permission, setPermission] = useState<Permission>(
    isSupported ? Notification.permission : "denied",
  );

  // Track which conversations were running on the previous poll
  const prevRunningRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async () => {
    if (!isSupported) return "denied" as Permission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const notify = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported || permission !== "granted") return;
      try {
        const n = new Notification(title, {
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          ...options,
        });
        // Auto-close after 8 seconds
        setTimeout(() => n.close(), 8000);
      } catch {
        // Notifications can fail in some contexts (e.g. insecure HTTP)
      }
    },
    [permission],
  );

  // Auto-detect when conversations finish running
  useEffect(() => {
    if (permission !== "granted") return;
    if (conversations.length === 0) return;

    const currentRunning = new Set<string>();
    for (const conv of conversations) {
      if (conv.summary.status === "CASCADE_RUN_STATUS_RUNNING") {
        currentRunning.add(conv.id);
      }
    }

    // Find conversations that WERE running but are now done
    const prevRunning = prevRunningRef.current;
    for (const id of prevRunning) {
      if (!currentRunning.has(id)) {
        // This conversation just finished
        const conv = conversations.find((c) => c.id === id);
        if (conv) {
          const title = conv.summary.summary || "Conversation";
          notify("✅ Task Complete", {
            body: title,
            tag: `porta-done-${id}`, // Prevent duplicate notifications
          });
        }
      }
    }

    prevRunningRef.current = currentRunning;
  }, [conversations, permission, notify]);

  // Auto-request permission on first load if not yet decided
  useEffect(() => {
    if (isSupported && permission === "default") {
      requestPermission();
    }
  }, [permission, requestPermission]);

  return {
    isSupported,
    permission,
    requestPermission,
    notify,
  };
}
