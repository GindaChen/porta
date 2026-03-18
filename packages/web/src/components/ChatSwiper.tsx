import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ConversationEntry } from "../hooks/useConversations";
import { useAppearance } from "../hooks/useAppearance";

interface Props {
  /** Conversations scoped to the current project */
  conversations: ConversationEntry[];
  /** All conversations across all projects */
  allConversations: ConversationEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

// ── Deterministic color palette for projects ──
// Higher saturation + lightness for better visual separation

const PROJECT_HUES = [
  210, // blue
  150, // teal
  30,  // orange
  270, // purple
  340, // pink
  60,  // yellow-green
  180, // cyan
  0,   // red
  120, // green
  300, // magenta
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function projectColor(name: string): { bg: string; border: string; dot: string } {
  const hue = PROJECT_HUES[hashString(name) % PROJECT_HUES.length];
  return {
    bg: `hsla(${hue}, 60%, 50%, 0.14)`,
    border: `hsla(${hue}, 60%, 55%, 0.35)`,
    dot: `hsl(${hue}, 70%, 65%)`,
  };
}

function extractProjectName(conv: ConversationEntry): string {
  const ws = conv.summary.workspaces?.[0];
  if (!ws) return "Others";
  const repo = ws.repository?.computedName;
  if (repo) return repo.split("/").pop() ?? repo;
  const uri = ws.workspaceFolderAbsoluteUri;
  if (uri) return uri.split("/").pop() ?? "Others";
  return "Others";
}

function chipLabel(summary: string): string {
  if (summary.length <= 28) return summary;
  return summary.slice(0, 26) + "…";
}

function relativeTimeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Pin persistence ──

const PINS_KEY = "porta:pinned-chats";

function loadPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function savePins(pins: Set<string>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify([...pins]));
  } catch {}
}

// ── Context menu state ──

interface ContextMenuState {
  convId: string;
  title: string;
  project: string;
  x: number;
  y: number;
}

// ── Long-press hook (returns context menu, not a simple popover) ──

const LONG_PRESS_MS = 400;

function useLongPressMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const startPress = useCallback(
    (convId: string, title: string, project: string, clientX: number, clientY: number) => {
      cancelPress();
      timerRef.current = setTimeout(() => {
        // Haptic feedback on supported devices
        if (navigator.vibrate) navigator.vibrate(10);
        setMenu({ convId, title, project, x: clientX, y: clientY });
      }, LONG_PRESS_MS);
    },
    [],
  );

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Show menu immediately (for right-click) */
  const showMenu = useCallback(
    (convId: string, title: string, project: string, clientX: number, clientY: number) => {
      cancelPress();
      if (navigator.vibrate) navigator.vibrate(10);
      setMenu({ convId, title, project, x: clientX, y: clientY });
    },
    [cancelPress],
  );

  const dismiss = useCallback(() => {
    setMenu(null);
    cancelPress();
  }, [cancelPress]);

  return { menu, startPress, cancelPress, showMenu, dismiss };
}

// ── Context Menu Component ──

function ContextMenu({
  menu,
  isPinned,
  onPin,
  onUnpin,
  onDismiss,
}: {
  menu: ContextMenuState;
  isPinned: boolean;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onDismiss: () => void;
}) {
  // Position: try to keep on-screen
  const menuY = Math.max(8, menu.y - 120);
  const menuX = Math.min(menu.x - 20, window.innerWidth - 270);

  return createPortal(
    <>
      <div className="chip-context-backdrop" onClick={onDismiss} onTouchStart={onDismiss} />
      <div
        className="chip-context-menu"
        style={{ left: Math.max(8, menuX), top: menuY }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chip-context-menu-title">{menu.title}</div>
        {menu.project !== "Others" && (
          <div className="chip-context-menu-title" style={{ opacity: 0.5, paddingTop: 0, fontSize: 10 }}>
            {menu.project}
          </div>
        )}
        <div className="chip-context-menu-divider" />
        {isPinned ? (
          <button
            className="chip-context-menu-item"
            onClick={() => {
              onUnpin(menu.convId);
              onDismiss();
            }}
          >
            <span className="chip-context-menu-item-icon">📌</span>
            Unpin from front
          </button>
        ) : (
          <button
            className="chip-context-menu-item"
            onClick={() => {
              onPin(menu.convId);
              onDismiss();
            }}
          >
            <span className="chip-context-menu-item-icon">📌</span>
            Pin to front
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

// ── Main Component ──

export function ChatSwiper({
  conversations,
  allConversations,
  activeId,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useAppearance();
  const { menu, startPress, cancelPress, showMenu, dismiss } = useLongPressMenu();
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(loadPins);

  // Auto-scroll to keep the active chip visible
  useEffect(() => {
    if (!scrollRef.current || !activeId) return;
    const activeChip = scrollRef.current.querySelector(
      `[data-chip-id="${activeId}"]`,
    ) as HTMLElement | null;
    if (activeChip) {
      activeChip.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeId]);

  // Pin/unpin handlers
  const handlePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      savePins(next);
      return next;
    });
  }, []);

  const handleUnpin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      savePins(next);
      return next;
    });
  }, []);

  const source = settings.swiperAllProjects ? allConversations : conversations;

  // Only show if there's more than 1 conversation
  if (source.length <= 1) return null;

  // Sort: pinned first, then by recency (original order)
  const sorted = [...source].sort((a, b) => {
    const aPinned = pinnedIds.has(a.id) ? 0 : 1;
    const bPinned = pinnedIds.has(b.id) ? 0 : 1;
    return aPinned - bPinned;
  });

  const visible = sorted.slice(0, settings.swiperMaxVisible);
  const showProjectColors = settings.swiperAllProjects;

  return (
    <div className="chat-swiper">
      <div className="chat-swiper-track" ref={scrollRef}>
        {visible.map((conv) => {
          const isActive = conv.id === activeId;
          const isRunning =
            conv.summary.status === "CASCADE_RUN_STATUS_RUNNING";
          const isIdle = conv.summary.status === "CASCADE_RUN_STATUS_IDLE";
          const isError = conv.summary.status === "CASCADE_RUN_STATUS_ERROR";
          const isPinned = pinnedIds.has(conv.id);

          let statusClass = "";
          if (isActive) statusClass = "active";
          else if (isRunning) statusClass = "running";
          else if (isError) statusClass = "error";
          else if (isIdle) statusClass = "done";
          if (isPinned) statusClass += " pinned";

          const project = extractProjectName(conv);
          const colors = showProjectColors ? projectColor(project) : null;

          const chipStyle: React.CSSProperties = colors
            ? {
                background: isActive ? undefined : colors.bg,
                borderColor: isActive ? undefined : colors.border,
              }
            : {};

          const dotStyle: React.CSSProperties =
            colors && !isActive && !isRunning && !isError
              ? { background: colors.dot }
              : {};

          const tooltipText = showProjectColors
            ? `[${project}] ${conv.summary.summary}`
            : conv.summary.summary;

          return (
            <button
              key={conv.id}
              data-chip-id={conv.id}
              className={`chat-swiper-chip ${statusClass}`}
              onClick={() => {
                // Only navigate if context menu is not open
                if (!menu) onSelect(conv.id);
              }}
              style={chipStyle}
              // Long-press for context menu (mobile)
              onTouchStart={(e) => {
                const touch = e.touches[0];
                startPress(
                  conv.id,
                  conv.summary.summary,
                  project,
                  touch.clientX,
                  touch.clientY,
                );
              }}
              onTouchEnd={cancelPress}
              onTouchMove={cancelPress}
              // Context menu on right-click (desktop)
              onContextMenu={(e) => {
                e.preventDefault();
                showMenu(conv.id, conv.summary.summary, project, e.clientX, e.clientY);
              }}
              // Hover title for desktop
              title={tooltipText}
            >
              <span className="chat-swiper-chip-dot" style={dotStyle} />
              <span className="chat-swiper-chip-label">
                {chipLabel(conv.summary.summary)}
              </span>
              <span className="chat-swiper-chip-time">
                {relativeTimeShort(conv.summary.lastModifiedTime)}
              </span>
            </button>
          );
        })}
      </div>

      {/* iOS-style context menu on long-press */}
      {menu && (
        <ContextMenu
          menu={menu}
          isPinned={pinnedIds.has(menu.convId)}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
