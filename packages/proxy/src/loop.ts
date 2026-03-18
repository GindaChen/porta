/**
 * Autopilot Loop Manager
 *
 * Runs server-side timers that periodically send messages to conversations,
 * keeping the AI agent working autonomously. Loops persist across proxy
 * restarts via ~/.porta/loops.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  discovery,
  rpc,
  rpcForConversation,
  getStepCount,
} from "./routing.js";
import { getMetadata } from "./metadata.js";
import { runConversationMutation } from "./conversation-mutations.js";
import { conversationSignals } from "./signals.js";
import { sendPushToAll } from "./push.js";

// ── Types ──

export interface LoopConfig {
  /** Conversation/cascade ID */
  sessionId: string;
  /** Messages to cycle through. Sent in order, then loops back. */
  messages: string[];
  /** Delay between checks in ms (default: 5 min) */
  intervalMs: number;
  /** Max iterations before auto-stop (default: 50, 0 = unlimited) */
  maxIterations: number;
  /** Whether to stop the loop if the agent errors */
  stopOnError: boolean;
}

export interface LoopState extends LoopConfig {
  /** Zero-based count of messages actually sent */
  iterationCount: number;
  /** ISO timestamp of last sent message */
  lastSentAt: string | null;
  /** When the loop was created */
  createdAt: string;
  /** Current loop status */
  status: "active" | "paused" | "completed" | "stopped" | "error";
  /** Last error message, if any */
  errorMessage?: string;
}

// ── Persistence ──

const PORTA_DIR = join(homedir(), ".porta");
const LOOPS_FILE = join(PORTA_DIR, "loops.json");

async function loadLoops(): Promise<Record<string, LoopState>> {
  try {
    const raw = await readFile(LOOPS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveLoops(
  loops: Record<string, LoopState>,
): Promise<void> {
  await mkdir(PORTA_DIR, { recursive: true });
  await writeFile(LOOPS_FILE, JSON.stringify(loops, null, 2) + "\n", "utf-8");
}

// ── In-memory state ──

let loops: Record<string, LoopState> = {};
const timers = new Map<string, ReturnType<typeof setInterval>>();

// ── Core tick logic ──

async function tick(sessionId: string): Promise<void> {
  const loop = loops[sessionId];
  if (!loop || loop.status !== "active") return;

  try {
    // 1. Check conversation status
    const instances = await discovery.getInstances();
    if (instances.length === 0) {
      console.log(`[loop] ${sessionId.slice(0, 8)}… no LS instances, skipping`);
      return;
    }

    let status = "unknown";
    let convTitle = sessionId.slice(0, 8) + "…";

    for (const inst of instances) {
      try {
        const data = await rpc.call<{
          trajectorySummaries: Record<
            string,
            { status?: string; summary?: string }
          >;
        }>("GetAllCascadeTrajectories", {}, inst);
        const summary = data.trajectorySummaries?.[sessionId];
        if (summary) {
          status = (summary.status as string) ?? "unknown";
          if (summary.summary) convTitle = summary.summary as string;
          break;
        }
      } catch {
        // Try next instance
      }
    }

    // 2. Skip if agent is still running
    if (status === "CASCADE_RUN_STATUS_RUNNING") {
      console.log(
        `[loop] ${sessionId.slice(0, 8)}… agent still running, skipping tick`,
      );
      return;
    }

    // 3. Check for error status
    if (status === "CASCADE_RUN_STATUS_ERROR" && loop.stopOnError) {
      loop.status = "error";
      loop.errorMessage = "Agent returned an error status";
      clearTimer(sessionId);
      await saveLoops(loops);
      console.log(`[loop] ${sessionId.slice(0, 8)}… stopped: agent error`);
      await sendPushToAll(
        "⚠️ Loop Stopped",
        `${convTitle} — agent errored after ${loop.iterationCount} iterations`,
      );
      return;
    }

    // 4. Check max iterations
    if (loop.maxIterations > 0 && loop.iterationCount >= loop.maxIterations) {
      loop.status = "completed";
      clearTimer(sessionId);
      await saveLoops(loops);
      console.log(
        `[loop] ${sessionId.slice(0, 8)}… completed: reached max iterations (${loop.maxIterations})`,
      );
      await sendPushToAll(
        "✅ Loop Complete",
        `${convTitle} — ${loop.iterationCount} iterations done`,
      );
      return;
    }

    // 5. Pick the next message (cycle through the list)
    const messageIndex = loop.iterationCount % loop.messages.length;
    const message = loop.messages[messageIndex];

    // 6. Send the message via the existing mutation infrastructure
    const metadata = await getMetadata(true);
    const { instance } = await getStepCount(sessionId);

    await runConversationMutation(sessionId, async () => {
      await rpcForConversation(
        "SendUserCascadeMessage",
        sessionId,
        {
          metadata,
          cascadeId: sessionId,
          items: [{ userInputText: message }],
          cascadeConfig: {
            plannerConfig: {
              plannerTypeConfig: { conversational: {} },
            },
          },
        },
        instance,
      );
    });

    conversationSignals.emit("activate", sessionId);

    // 7. Update state
    loop.iterationCount += 1;
    loop.lastSentAt = new Date().toISOString();
    await saveLoops(loops);

    console.log(
      `[loop] ${sessionId.slice(0, 8)}… iteration ${loop.iterationCount}/${loop.maxIterations || "∞"}: "${message.slice(0, 60)}"`,
    );

    // Push notification every 5th iteration (avoid spam)
    if (loop.iterationCount % 5 === 0) {
      await sendPushToAll(
        "♻️ Loop Progress",
        `${convTitle} — iteration ${loop.iterationCount}/${loop.maxIterations || "∞"}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[loop] ${sessionId.slice(0, 8)}… tick error: ${msg}`);

    // Don't stop the loop on transient errors — just log and retry next tick
    loop.errorMessage = msg;
    await saveLoops(loops);
  }
}

// ── Timer management ──

function startTimer(sessionId: string): void {
  clearTimer(sessionId);
  const loop = loops[sessionId];
  if (!loop || loop.status !== "active") return;

  console.log(
    `[loop] timer started for ${sessionId.slice(0, 8)}… (every ${loop.intervalMs / 1000}s)`,
  );
  timers.set(sessionId, setInterval(() => void tick(sessionId), loop.intervalMs));
}

function clearTimer(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    timers.delete(sessionId);
  }
}

// ── Public API ──

export async function initLoopService(): Promise<void> {
  loops = await loadLoops();

  // Resume active loops
  const active = Object.entries(loops).filter(
    ([, l]) => l.status === "active",
  );
  if (active.length > 0) {
    console.log(`[loop] resuming ${active.length} active loop(s)`);
    for (const [id] of active) {
      startTimer(id);
    }
  } else {
    console.log("[loop] no active loops");
  }
}

export function startLoop(config: LoopConfig): LoopState {
  // Stop any existing loop for this session
  if (loops[config.sessionId]) {
    clearTimer(config.sessionId);
  }

  const state: LoopState = {
    ...config,
    // 0 = "as soon as idle" → poll every 15s; otherwise min 60s
    intervalMs: config.intervalMs <= 0 ? 15_000 : Math.max(60_000, config.intervalMs),
    maxIterations: config.maxIterations ?? 50,
    iterationCount: 0,
    lastSentAt: null,
    createdAt: new Date().toISOString(),
    status: "active",
  };

  loops[config.sessionId] = state;
  void saveLoops(loops);
  startTimer(config.sessionId);

  // Fire first tick immediately (don't wait for the interval)
  void tick(config.sessionId);

  return state;
}

export function stopLoop(sessionId: string): LoopState | null {
  const loop = loops[sessionId];
  if (!loop) return null;

  loop.status = "stopped";
  clearTimer(sessionId);
  void saveLoops(loops);
  console.log(
    `[loop] stopped ${sessionId.slice(0, 8)}… after ${loop.iterationCount} iterations`,
  );
  return loop;
}

export function getLoop(sessionId: string): LoopState | null {
  return loops[sessionId] ?? null;
}

export function getAllLoops(): Record<string, LoopState> {
  return { ...loops };
}

export function deleteLoop(sessionId: string): boolean {
  if (!loops[sessionId]) return false;
  clearTimer(sessionId);
  delete loops[sessionId];
  void saveLoops(loops);
  return true;
}
