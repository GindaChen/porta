import { useRef, useEffect, useState, useCallback } from "react";
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
    bg: `hsla(${hue}, 50%, 50%, 0.10)`,
    border: `hsla(${hue}, 50%, 50%, 0.25)`,
    dot: `hsl(${hue}, 60%, 60%)`,
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

// ── Long-press popover hook ──

const LONG_PRESS_MS = 400;
const POPOVER_TIMEOUT_MS = 3000;

interface PopoverState {
  text: string;
  x: number;
  y: number;
}

function useLongPressPopover() {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout>>(null);

  const startPress = useCallback((text: string, clientX: number, clientY: number) => {
    cancelPress();
    timerRef.current = setTimeout(() => {
      setPopover({ text, x: clientX, y: clientY });
      // Auto-dismiss after a few seconds
      dismissRef.current = setTimeout(() => {
        setPopover(null);
      }, POPOVER_TIMEOUT_MS);
    }, LONG_PRESS_MS);
  }, []);

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    setPopover(null);
    cancelPress();
    if (dismissRef.current) {
      clearTimeout(dismissRef.current);
      dismissRef.current = null;
    }
  }, [cancelPress]);

  return { popover, startPress, cancelPress, dismiss };
}

// ── Component ──

export function ChatSwiper({
  conversations,
  allConversations,
  activeId,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useAppearance();
  const { popover, startPress, cancelPress, dismiss } = useLongPressPopover();

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

  // Dismiss popover on outside tap
  useEffect(() => {
    if (!popover) return;
    const handler = () => dismiss();
    document.addEventListener("touchstart", handler);
    document.addEventListener("click", handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("click", handler);
    };
  }, [popover, dismiss]);

  const source = settings.swiperAllProjects ? allConversations : conversations;

  // Only show if there's more than 1 conversation
  if (source.length <= 1) return null;

  const visible = source.slice(0, settings.swiperMaxVisible);
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

          let statusClass = "";
          if (isActive) statusClass = "active";
          else if (isRunning) statusClass = "running";
          else if (isError) statusClass = "error";
          else if (isIdle) statusClass = "done";

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
              onClick={() => onSelect(conv.id)}
              style={chipStyle}
              // Long-press for tooltip (mobile)
              onTouchStart={(e) => {
                const touch = e.touches[0];
                startPress(tooltipText, touch.clientX, touch.clientY);
              }}
              onTouchEnd={cancelPress}
              onTouchMove={cancelPress}
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

      {/* Long-press popover */}
      {popover && (
        <div
          className="chip-popover"
          style={{
            left: Math.min(popover.x, window.innerWidth - 220),
            top: popover.y - 48,
          }}
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
        >
          {popover.text}
        </div>
      )}
    </div>
  );
}
