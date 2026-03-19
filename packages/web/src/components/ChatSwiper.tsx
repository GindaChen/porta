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

function projectColor(name: string, overrideHex?: string): { bg: string; border: string; dot: string } {
  if (overrideHex) {
    // Convert hex to HSL-ish inline styles
    return {
      bg: `${overrideHex}24`,       // hex + ~14% alpha
      border: `${overrideHex}59`,   // hex + ~35% alpha
      dot: overrideHex,
    };
  }
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
  allConversations,
  onPin,
  onUnpin,
  onDismiss,
}: {
  menu: ContextMenuState;
  isPinned: boolean;
  allConversations: ConversationEntry[];
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onDismiss: () => void;
}) {
  // Compute project stats
  const projectConvs = allConversations.filter(
    (c) => extractProjectName(c) === menu.project,
  );
  const runningCount = projectConvs.filter(
    (c) => c.summary.status === "CASCADE_RUN_STATUS_RUNNING",
  ).length;
  const conv = allConversations.find((c) => c.id === menu.convId);
  const lastActive = conv?.summary.lastModifiedTime
    ? relativeTimeShort(conv.summary.lastModifiedTime) + " ago"
    : "";

  // Position: try to keep on-screen
  const menuY = Math.max(8, menu.y - 160);
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
            {" · "}
            {projectConvs.length} conversation{projectConvs.length !== 1 ? "s" : ""}
            {runningCount > 0 && ` · ${runningCount} running`}
          </div>
        )}
        {lastActive && (
          <div className="chip-context-menu-title" style={{ opacity: 0.35, paddingTop: 0, fontSize: 10 }}>
            Last active: {lastActive}
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
  const [gridPage, setGridPage] = useState(0);

  const isGrid = settings.swiperLayout === "grid";
  const gridPerPage = settings.swiperGridColumns * settings.swiperGridRows;

  // Auto-scroll to keep the active chip visible (scroll mode only)
  useEffect(() => {
    if (isGrid || !scrollRef.current || !activeId) return;
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
  }, [activeId, isGrid]);

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

  // Pagination for grid mode, max-visible for scroll mode
  let visible: ConversationEntry[];
  let totalPages = 1;
  if (isGrid) {
    totalPages = Math.ceil(sorted.length / gridPerPage);
    const safePage = Math.min(gridPage, totalPages - 1);
    visible = sorted.slice(safePage * gridPerPage, (safePage + 1) * gridPerPage);
  } else {
    visible = sorted.slice(0, settings.swiperMaxVisible);
  }

  const showProjectColors = settings.swiperAllProjects;

  const trackClass = isGrid
    ? "chat-swiper-track grid-layout"
    : "chat-swiper-track";

  const trackStyle: React.CSSProperties = isGrid
    ? { ["--swiper-grid-cols" as string]: settings.swiperGridColumns }
    : {};

  return (
    <div className="chat-swiper">
      <div className={trackClass} ref={scrollRef} style={trackStyle}>
        {visible.map((conv) => {
          const isActive = conv.id === activeId;
          const isRunning =
            conv.summary.status === "CASCADE_RUN_STATUS_RUNNING";
          const isIdle = conv.summary.status === "CASCADE_RUN_STATUS_IDLE";
          const isError = conv.summary.status === "CASCADE_RUN_STATUS_ERROR";
          const isPinned = pinnedIds.has(conv.id);

          // Status classes are additive (active + running can coexist)
          const classes = ["chat-swiper-chip"];
          if (isActive) classes.push("active");
          if (isRunning) classes.push("running");
          else if (isError) classes.push("error");
          else if (isIdle) classes.push("done");
          if (isPinned) classes.push("pinned");

          const project = extractProjectName(conv);
          const overrideHex = settings.projectColorOverrides?.[project];
          const colors = showProjectColors ? projectColor(project, overrideHex) : null;

          // Always keep project color — even when active (brightness filter handles highlight)
          const chipStyle: React.CSSProperties = colors
            ? {
                background: colors.bg,
                borderColor: colors.border,
              }
            : {};

          const dotStyle: React.CSSProperties =
            colors && !isRunning && !isError
              ? { background: colors.dot }
              : {};

          const tooltipText = showProjectColors
            ? `[${project}] ${conv.summary.summary}`
            : conv.summary.summary;

          return (
            <button
              key={conv.id}
              data-chip-id={conv.id}
              className={classes.join(" ")}
              onClick={() => {
                if (!menu) onSelect(conv.id);
              }}
              style={chipStyle}
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
              onContextMenu={(e) => {
                e.preventDefault();
                showMenu(conv.id, conv.summary.summary, project, e.clientX, e.clientY);
              }}
              title={tooltipText}
            >
              <span className="chat-swiper-chip-dot" style={dotStyle} />
              <span className="chat-swiper-chip-text">
                {showProjectColors && (
                  <span className="chat-swiper-chip-project">{project}</span>
                )}
                <span className="chat-swiper-chip-label">
                  {chipLabel(conv.summary.summary)}
                </span>
              </span>
              <span className="chat-swiper-chip-time">
                {relativeTimeShort(conv.summary.lastModifiedTime)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid pagination */}
      {isGrid && totalPages > 1 && (
        <div className="chat-swiper-grid-nav">
          <button
            disabled={gridPage <= 0}
            onClick={() => setGridPage((p) => Math.max(0, p - 1))}
          >
            ‹ Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              className={i === Math.min(gridPage, totalPages - 1) ? "active" : ""}
              onClick={() => setGridPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            disabled={gridPage >= totalPages - 1}
            onClick={() => setGridPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next ›
          </button>
        </div>
      )}

      {/* iOS-style context menu on long-press */}
      {menu && (
        <ContextMenu
          menu={menu}
          isPinned={pinnedIds.has(menu.convId)}
          allConversations={allConversations}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
