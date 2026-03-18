import { useRef, useEffect } from "react";
import type { ConversationEntry } from "../hooks/useConversations";

interface Props {
  conversations: ConversationEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const MAX_VISIBLE = 8;

function chipLabel(summary: string): string {
  // Truncate long titles for the chip
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

export function ChatSwiper({ conversations, activeId, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only show if there's more than 1 conversation
  if (conversations.length <= 1) return null;

  const visible = conversations.slice(0, MAX_VISIBLE);

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

          return (
            <button
              key={conv.id}
              data-chip-id={conv.id}
              className={`chat-swiper-chip ${statusClass}`}
              onClick={() => onSelect(conv.id)}
              title={conv.summary.summary}
            >
              <span className="chat-swiper-chip-dot" />
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
    </div>
  );
}
