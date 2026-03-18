/**
 * /api/loop/* routes — Autopilot loop management
 */

import type { Hono } from "hono";
import {
  startLoop,
  stopLoop,
  getLoop,
  getAllLoops,
  deleteLoop,
  type LoopConfig,
} from "../loop.js";

export function registerLoopRoutes(app: Hono): void {
  // Start or restart a loop
  app.post("/api/loop/start", async (c) => {
    try {
      const body = await c.req.json();
      const {
        sessionId,
        messages,
        message,
        intervalMs,
        maxIterations,
        stopOnError,
      } = body;

      if (!sessionId) {
        return c.json({ error: "sessionId is required" }, 400);
      }

      // Accept either single message or array of messages
      const messageList: string[] = messages ??
        (message ? [message] : ["Continue working on the task."]);

      const config: LoopConfig = {
        sessionId,
        messages: messageList,
        intervalMs: intervalMs ?? 5 * 60_000, // 5 min default
        maxIterations: maxIterations ?? 50,
        stopOnError: stopOnError ?? true,
      };

      const state = startLoop(config);
      return c.json(state, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to start loop" },
        500,
      );
    }
  });

  // Stop a loop
  app.post("/api/loop/stop", async (c) => {
    try {
      const body = await c.req.json();
      const { sessionId } = body;

      if (!sessionId) {
        return c.json({ error: "sessionId is required" }, 400);
      }

      const state = stopLoop(sessionId);
      if (!state) {
        return c.json({ error: "No loop found for this session" }, 404);
      }

      return c.json(state);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to stop loop" },
        500,
      );
    }
  });

  // Get all loops
  app.get("/api/loop/status", (c) => {
    return c.json(getAllLoops());
  });

  // Get loop state for a specific session
  app.get("/api/loop/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const state = getLoop(sessionId);
    if (!state) {
      return c.json({ error: "No loop found" }, 404);
    }
    return c.json(state);
  });

  // Delete a loop (remove from persistence)
  app.delete("/api/loop/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const deleted = deleteLoop(sessionId);
    if (!deleted) {
      return c.json({ error: "No loop found" }, 404);
    }
    return c.json({ ok: true });
  });
}
