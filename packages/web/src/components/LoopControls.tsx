/**
 * LoopControls — inline autopilot loop panel for the chat input area.
 *
 * Shows a compact bar with:
 *   - Start / Stop button
 *   - Status indicator (iteration count, last sent)
 *   - Expandable config (interval, max iterations, messages)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";

interface Props {
  sessionId: string | null;
  disabled?: boolean;
}

interface LoopState {
  status: "active" | "paused" | "completed" | "stopped" | "error" | null;
  iterationCount: number;
  maxIterations: number;
  intervalMs: number;
  messages: string[];
  lastSentAt: string | null;
  errorMessage?: string;
}

const DEFAULT_MESSAGES = [
  "Continue working on the task. If stuck, try a different approach.",
  "Keep going. Focus on completing the current objective.",
  "Check your progress. Are there remaining items? Continue.",
];


function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function LoopControls({ sessionId, disabled }: Props) {
  const [loop, setLoop] = useState<LoopState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Config state (for starting a new loop)
  const [intervalMin, setIntervalMin] = useState(5); // minutes
  const [maxIter, setMaxIter] = useState(50);
  const [messages, setMessages] = useState<string[]>(DEFAULT_MESSAGES);
  const [editingMessages, setEditingMessages] = useState(false);
  const [messagesText, setMessagesText] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval>>(null);

  // Poll loop status
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await api.getLoop(sessionId);
      setLoop({
        status: data.status as LoopState["status"],
        iterationCount: (data.iterationCount as number) ?? 0,
        maxIterations: (data.maxIterations as number) ?? 50,
        intervalMs: (data.intervalMs as number) ?? 300_000,
        messages: (data.messages as string[]) ?? DEFAULT_MESSAGES,
        lastSentAt: (data.lastSentAt as string) ?? null,
        errorMessage: data.errorMessage as string | undefined,
      });
    } catch {
      setLoop(null);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchStatus();
    // Poll every 10s while visible
    pollRef.current = setInterval(fetchStatus, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  const handleStart = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await api.startLoop({
        sessionId,
        messages,
        intervalMs: Math.max(1, intervalMin) * 60_000,
        maxIterations: maxIter,
        stopOnError: true,
      });
      await fetchStatus();
      setExpanded(false);
    } catch (err) {
      console.error("Failed to start loop:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, messages, intervalMin, maxIter, fetchStatus]);

  const handleStop = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await api.stopLoop(sessionId);
      await fetchStatus();
    } catch (err) {
      console.error("Failed to stop loop:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, fetchStatus]);

  if (!sessionId) return null;

  const isActive = loop?.status === "active";

  return (
    <div className="loop-controls">
      <div className="loop-controls-bar">
        {/* Left: status */}
        <div className="loop-controls-status">
          <span className={`loop-indicator ${isActive ? "active" : ""}`} />
          {isActive ? (
            <span className="loop-status-text">
              Loop {loop.iterationCount}/{loop.maxIterations || "∞"}
              {loop.lastSentAt && ` · ${relativeTime(loop.lastSentAt)}`}
            </span>
          ) : loop?.status === "completed" ? (
            <span className="loop-status-text done">
              ✅ Loop done ({loop.iterationCount} iter)
            </span>
          ) : loop?.status === "error" ? (
            <span className="loop-status-text error">
              ⚠️ {loop.errorMessage || "Error"}
            </span>
          ) : (
            <span className="loop-status-text idle">Autopilot</span>
          )}
        </div>

        {/* Right: actions */}
        <div className="loop-controls-actions">
          <button
            className="loop-config-btn"
            onClick={() => setExpanded((v) => !v)}
            title="Configure loop"
            disabled={disabled}
          >
            ⚙
          </button>
          {isActive ? (
            <button
              className="loop-stop-btn"
              onClick={handleStop}
              disabled={loading || disabled}
              title="Stop loop"
            >
              ■ Stop
            </button>
          ) : (
            <button
              className="loop-start-btn"
              onClick={handleStart}
              disabled={loading || disabled}
              title="Start autopilot loop"
            >
              {loading ? "…" : "▶ Start"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="loop-config-panel">
          <div className="loop-config-row">
            <label className="loop-config-label">Interval (min)</label>
            <input
              className="loop-config-input"
              type="number"
              min={0}
              max={120}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Math.max(0, Number(e.target.value)))}
              title="0 = send immediately when agent finishes"
            />
          </div>

          <div className="loop-config-row">
            <label className="loop-config-label">Max iterations</label>
            <input
              className="loop-config-input"
              type="number"
              min={0}
              max={500}
              value={maxIter}
              onChange={(e) => setMaxIter(Number(e.target.value))}
              placeholder="0 = unlimited"
            />
          </div>

          <div className="loop-config-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="loop-config-label">
                Messages ({messages.length})
              </label>
              <button
                className="loop-config-btn"
                style={{ fontSize: 10 }}
                onClick={() => {
                  if (editingMessages) {
                    // Save
                    const parsed = messagesText
                      .split("\n---\n")
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0);
                    if (parsed.length > 0) setMessages(parsed);
                    setEditingMessages(false);
                  } else {
                    setMessagesText(messages.join("\n---\n"));
                    setEditingMessages(true);
                  }
                }}
              >
                {editingMessages ? "Save" : "Edit"}
              </button>
            </div>
            {editingMessages ? (
              <textarea
                className="loop-config-textarea"
                value={messagesText}
                onChange={(e) => setMessagesText(e.target.value)}
                rows={4}
                placeholder="Separate messages with ---"
              />
            ) : (
              <div className="loop-messages-preview">
                {messages.map((msg, i) => (
                  <div key={i} className="loop-message-chip">
                    {i + 1}. {msg.slice(0, 50)}{msg.length > 50 ? "…" : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
