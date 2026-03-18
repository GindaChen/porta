/**
 * Push notification API routes.
 *
 * GET  /api/push/vapid-key       → { publicKey }
 * POST /api/push/subscribe       → subscribe a push endpoint
 * POST /api/push/unsubscribe     → remove a push endpoint
 * GET  /api/push/status          → { subscriptionCount, pollIntervalMs }
 * PUT  /api/push/poll-interval   → { pollIntervalMs }
 */

import type { Hono } from "hono";
import {
  getVapidPublicKey,
  addSubscription,
  removeSubscription,
  getSubscriptionCount,
  getPollIntervalMs,
  setPollIntervalMs,
} from "../push.js";

export function registerPushRoutes(app: Hono): void {
  // Return the VAPID public key for client-side pushManager.subscribe()
  app.get("/api/push/vapid-key", (c) => {
    return c.json({ publicKey: getVapidPublicKey() });
  });

  // Store a push subscription
  app.post("/api/push/subscribe", async (c) => {
    const body = await c.req.json();
    if (!body.endpoint || !body.keys) {
      return c.json({ error: "Invalid subscription: missing endpoint or keys" }, 400);
    }
    await addSubscription(body);
    return c.json({ ok: true });
  });

  // Remove a push subscription
  app.post("/api/push/unsubscribe", async (c) => {
    const body = await c.req.json();
    if (!body.endpoint) {
      return c.json({ error: "Missing endpoint" }, 400);
    }
    await removeSubscription(body.endpoint);
    return c.json({ ok: true });
  });

  // Status check
  app.get("/api/push/status", (c) => {
    return c.json({
      subscriptionCount: getSubscriptionCount(),
      pollIntervalMs: getPollIntervalMs(),
    });
  });

  // Update poll interval
  app.put("/api/push/poll-interval", async (c) => {
    const body = await c.req.json();
    const ms = Number(body.pollIntervalMs);
    if (isNaN(ms) || ms < 3000 || ms > 60000) {
      return c.json({ error: "pollIntervalMs must be between 3000 and 60000" }, 400);
    }
    await setPollIntervalMs(ms);
    return c.json({ pollIntervalMs: getPollIntervalMs() });
  });
}
