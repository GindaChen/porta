const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function previewBody(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 120) return singleLine;
  return `${singleLine.slice(0, 117)}...`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {
      msg = body;
    }
    throw new Error(`API ${res.status}: ${msg}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    const body = previewBody(await res.text());
    throw new Error(
      `API returned non-JSON for ${path}: ${body || "<empty response>"}`,
    );
  }

  return res.json();
}

export const api = {
  health: () => request<import("../types").HealthResponse>("/api/health"),

  conversations: () =>
    request<import("../types").ConversationsResponse>("/api/conversations"),

  getConversation: (cascadeId: string) =>
    request<import("../types").ConversationDetail>(
      `/api/conversations/${cascadeId}`,
    ),

  /** Fetch steps with optional limit. Returns { steps, offset, stepCount? }. */
  getSteps: (cascadeId: string, offset = 0, limit?: number, tail?: number) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (limit !== undefined) params.set("limit", String(limit));
    if (tail !== undefined) params.set("tail", String(tail));
    return request<import("../types").StepsPageResponse>(
      `/api/conversations/${cascadeId}/steps?${params}`,
    );
  },

  getWorkspaces: () =>
    request<{
      workspaceInfos?: { workspaceUri: string; gitRootUri?: string }[];
    }>("/api/workspaces"),

  startConversation: (workspaceUri?: string, fileAccessGranted = false) =>
    request<{ cascadeId: string }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        ...(workspaceUri ? { workspaceFolderAbsoluteUri: workspaceUri } : {}),
        fileAccessGranted,
      }),
    }),

  sendMessage: (
    cascadeId: string,
    items: unknown[],
    clientMessageId?: string,
    model?: string,
    media?: Array<{ mimeType: string; inlineData: string }>,
    plannerType?: string,
    fileAccessGranted = false,
  ) =>
    request(`/api/conversations/${cascadeId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        items,
        clientMessageId,
        model,
        media,
        plannerType,
        fileAccessGranted,
      }),
    }),

  stop: (cascadeId: string) =>
    request(`/api/conversations/${cascadeId}/stop`, { method: "POST" }),

  filePermission: (
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) =>
    request(`/api/conversations/${cascadeId}/file-permission`, {
      method: "POST",
      body: JSON.stringify({
        trajectoryId,
        stepIndex,
        allow,
        scope,
        absolutePathUri,
      }),
    }),

  commandAction: (
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) =>
    request(`/api/conversations/${cascadeId}/command-action`, {
      method: "POST",
      body: JSON.stringify({
        trajectoryId,
        stepIndex,
        approved,
      }),
    }),

  revert: (cascadeId: string, stepIndex: number, model?: string) =>
    request(`/api/conversations/${cascadeId}/revert`, {
      method: "POST",
      body: JSON.stringify({ stepIndex, model }),
    }),

  deleteConversation: (cascadeId: string) =>
    request(`/api/conversations/${cascadeId}`, { method: "DELETE" }),

  models: () =>
    request<{
      clientModelConfigs: Array<{
        label: string;
        modelOrAlias: { model: string };
        supportsImages: boolean;
        isRecommended: boolean;
        quotaInfo?: { remainingFraction: number };
      }>;
      defaultOverrideModelConfig?: { modelOrAlias: { model: string } };
    }>("/api/models"),

  rpc: (method: string, body: Record<string, unknown> = {}) =>
    request(`/api/rpc/${method}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  search: (query: string) =>
    request<{
      query: string;
      results: {
        id: string;
        title: string;
        snippets: string[];
        matchCount: number;
      }[];
      totalConversations: number;
      elapsedMs: number;
    }>(`/api/search?q=${encodeURIComponent(query)}`),

  getSettings: () =>
    request<Record<string, unknown>>("/api/settings"),

  saveSettings: (settings: any) =>
    request("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  transcribe: async (audioBlob: Blob): Promise<{ text: string }> => {
    const form = new FormData();
    form.append("audio", audioBlob, "recording.webm");
    const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      let msg: string;
      try {
        msg = JSON.parse(body).error ?? body;
      } catch {
        msg = body;
      }
      throw new Error(msg);
    }
    return res.json();
  },

  // ── Push Notifications ──

  getVapidKey: () =>
    request<{ publicKey: string }>("/api/push/vapid-key"),

  subscribePush: (subscription: PushSubscriptionJSON) =>
    request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint: string) =>
    request("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),

  getPushStatus: () =>
    request<{ subscriptionCount: number; pollIntervalMs: number }>("/api/push/status"),

  setPollInterval: (ms: number) =>
    request<{ pollIntervalMs: number }>("/api/push/poll-interval", {
      method: "PUT",
      body: JSON.stringify({ pollIntervalMs: ms }),
    }),

  // ── Autopilot Loop ──

  startLoop: (config: {
    sessionId: string;
    messages?: string[];
    message?: string;
    intervalMs?: number;
    maxIterations?: number;
    stopOnError?: boolean;
  }) =>
    request<Record<string, unknown>>("/api/loop/start", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  stopLoop: (sessionId: string) =>
    request<Record<string, unknown>>("/api/loop/stop", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  getLoopStatus: () =>
    request<Record<string, Record<string, unknown>>>("/api/loop/status"),

  getLoop: (sessionId: string) =>
    request<Record<string, unknown>>(`/api/loop/${sessionId}`),

  deleteLoop: (sessionId: string) =>
    request(`/api/loop/${sessionId}`, { method: "DELETE" }),
};
