/**
 * Web Push Notification Service
 *
 * - Auto-generates and stores VAPID keys on first run
 * - Stores push subscriptions from clients
 * - Background poller monitors conversation status
 * - Sends push notifications when tasks complete
 */

import webpush from "web-push";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { discovery, rpc, normalizeWorkspaceId, uriToWorkspaceId } from "./routing.js";

const PORTA_DIR = join(homedir(), ".porta");
const PUSH_FILE = join(PORTA_DIR, "push.json");

interface PushData {
  vapid: {
    publicKey: string;
    privateKey: string;
    subject: string;
  };
  subscriptions: webpush.PushSubscription[];
  pollIntervalMs: number;
}

const DEFAULT_POLL_MS = 10_000; // 10 seconds default

let pushData: PushData | null = null;
let pollerTimer: ReturnType<typeof setInterval> | null = null;
const prevRunning = new Set<string>();
let initialized = false;

// ── Persistence ──

async function loadPushData(): Promise<PushData> {
  try {
    const raw = await readFile(PUSH_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    // Generate fresh VAPID keys
    const vapidKeys = webpush.generateVAPIDKeys();
    const data: PushData = {
      vapid: {
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey,
        subject: "mailto:porta@localhost",
      },
      subscriptions: [],
      pollIntervalMs: DEFAULT_POLL_MS,
    };
    await savePushData(data);
    return data;
  }
}

async function savePushData(data: PushData): Promise<void> {
  await mkdir(PORTA_DIR, { recursive: true });
  await writeFile(PUSH_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Public API ──

export async function initPushService(): Promise<void> {
  pushData = await loadPushData();
  webpush.setVapidDetails(
    pushData.vapid.subject,
    pushData.vapid.publicKey,
    pushData.vapid.privateKey,
  );
  console.log(`[push] initialized, ${pushData.subscriptions.length} subscription(s)`);
  startPoller();
}

export function getVapidPublicKey(): string {
  return pushData?.vapid.publicKey ?? "";
}

export async function addSubscription(sub: webpush.PushSubscription): Promise<void> {
  if (!pushData) return;
  // Deduplicate by endpoint
  pushData.subscriptions = pushData.subscriptions.filter(
    (s) => s.endpoint !== sub.endpoint,
  );
  pushData.subscriptions.push(sub);
  await savePushData(pushData);
  console.log(`[push] subscription added (total: ${pushData.subscriptions.length})`);
  startPoller(); // Ensure poller is running
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (!pushData) return;
  pushData.subscriptions = pushData.subscriptions.filter(
    (s) => s.endpoint !== endpoint,
  );
  await savePushData(pushData);
  console.log(`[push] subscription removed (total: ${pushData.subscriptions.length})`);
}

export function getPollIntervalMs(): number {
  return pushData?.pollIntervalMs ?? DEFAULT_POLL_MS;
}

export async function setPollIntervalMs(ms: number): Promise<void> {
  if (!pushData) return;
  pushData.pollIntervalMs = Math.max(3000, Math.min(60000, ms));
  await savePushData(pushData);
  // Restart poller with new interval
  startPoller();
}

export function getSubscriptionCount(): number {
  return pushData?.subscriptions.length ?? 0;
}

// ── Background Poller ──

function startPoller(): void {
  if (pollerTimer) clearInterval(pollerTimer);
  if (!pushData || pushData.subscriptions.length === 0) return;

  const interval = pushData.pollIntervalMs;
  console.log(`[push] poller started (every ${interval / 1000}s)`);
  pollerTimer = setInterval(() => void pollConversations(), interval);
}

async function pollConversations(): Promise<void> {
  if (!pushData || pushData.subscriptions.length === 0) return;

  try {
    const instances = await discovery.getInstances();
    if (instances.length === 0) return;

    const currentRunning = new Set<string>();
    const convNames = new Map<string, string>();

    // Fetch all conversation summaries
    await Promise.allSettled(
      instances.map(async (inst) => {
        try {
          const data = await rpc.call<{
            trajectorySummaries: Record<string, Record<string, unknown>>;
          }>("GetAllCascadeTrajectories", {}, inst);
          const summaries = data.trajectorySummaries ?? {};
          for (const [id, summary] of Object.entries(summaries)) {
            if (summary.status === "CASCADE_RUN_STATUS_RUNNING") {
              currentRunning.add(id);
            }
            if (summary.summary) {
              convNames.set(id, summary.summary as string);
            }
          }
        } catch {
          // Skip unreachable instance
        }
      }),
    );

    // Skip first poll to avoid false positives
    if (!initialized) {
      initialized = true;
      for (const id of currentRunning) prevRunning.add(id);
      return;
    }

    // Detect RUNNING → done transitions
    for (const id of prevRunning) {
      if (!currentRunning.has(id)) {
        const title = convNames.get(id) || id.slice(0, 8) + "…";
        console.log(`[push] task completed: ${title}`);
        await sendPushToAll("✅ Task Complete", title);
      }
    }

    // Update tracking
    prevRunning.clear();
    for (const id of currentRunning) prevRunning.add(id);
  } catch (err) {
    console.warn(`[push] poll error: ${(err as Error).message}`);
  }
}

export async function sendPushToAll(title: string, body: string): Promise<void> {
  if (!pushData) return;

  const payload = JSON.stringify({ title, body });
  const expired: string[] = [];

  await Promise.allSettled(
    pushData.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or invalid — mark for removal
          expired.push(sub.endpoint);
        } else {
          console.warn(`[push] send failed: ${(err as Error).message}`);
        }
      }
    }),
  );

  // Remove expired subscriptions
  if (expired.length > 0) {
    pushData.subscriptions = pushData.subscriptions.filter(
      (s) => !expired.includes(s.endpoint),
    );
    await savePushData(pushData);
    console.log(`[push] removed ${expired.length} expired subscription(s)`);
  }
}
