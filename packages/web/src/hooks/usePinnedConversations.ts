/**
 * usePinnedConversations — localStorage-backed set of pinned conversation IDs.
 *
 * Pinned conversations float to the top in the sidebar and swiper.
 */

import { useState, useCallback } from "react";

const STORAGE_KEY = "porta:pinned";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function savePinned(pins: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pins]));
  } catch {}
}

export function usePinnedConversations() {
  const [pinned, setPinned] = useState<Set<string>>(loadPinned);

  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      savePinned(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (id: string) => pinned.has(id),
    [pinned],
  );

  return { pinned, togglePin, isPinned };
}
