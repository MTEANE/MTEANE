/**
 * Typed client for the Triggrr REST API.
 *
 * All methods target Next.js API proxy routes (/api/*) so the real
 * TRIGGRR_API_KEY never reaches the browser.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

export interface Rule {
  id: string;
  name: string;
  event_type: string;
  condition: Condition;
  action_type: 'webhook' | 'email' | 'slack';
  action_config: Record<string, unknown>;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  last_triggered_at: string | null;
}

export interface CreateRuleInput {
  name: string;
  event_type: string;
  condition: Condition;
  action_type: 'webhook' | 'email' | 'slack';
  action_config: Record<string, unknown>;
}

export type RulePatchInput = {
  name?: string;
  condition?: Condition;
  action_config?: Record<string, unknown>;
  is_active?: boolean;
};

export interface ActionLog {
  id: string;
  event_id: string;
  rule_id: string;
  rule_name: string;
  rule_action_type: string;
  rule_event_type: string;
  status: 'pending' | 'success' | 'failed' | 'retrying' | 'dead';
  attempt_count: number;
  error_message: string | null;
  response_body: string | null;
  executed_at: string | null;
  created_at: string;
}

export interface TopRule {
  rule_id: string;
  rule_name: string;
  count: number;
}

export interface OrgStats {
  total: number;
  success: number;
  failed: number;
  dead: number;
  success_rate: number;
  top_rules: TopRule[];
}

export interface EventResponse {
  event_id: string;
  received_at: string;
  status: string;
}

export interface LogsResponse {
  logs: ActionLog[];
  next_cursor: string | null;
}

export interface HealthProbe {
  status: 'ok' | 'down' | 'high';
  latency_ms?: number;
  error?: string;
  usage_mb?: number;
  threshold_mb?: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  redis: 'ok' | 'down';
  memory: 'ok' | 'high';
  memory_mb: number;
  uptime: number;
}

export interface RegisterResponse {
  org_id: string;
  api_key: string;
  warning: string;
}

export interface DlqJob {
  id: string;
  eventId: string;
  orgId: string;
  eventType: string;
  failedReason: string;
  finalAttempt: boolean;
  timestamp: number;
  processedOn: number | null;
}

export interface RuleLogsResponse {
  logs: ActionLog[];
}

export interface DemoWebhookDelivery {
  id: string;
  received_at: string;
  event_id: string | null;
  event_type: string | null;
  org_id: string | null;
  payload: unknown;
  body: unknown;
}

export interface DemoWebhookResponse {
  url: string;
  deliveries: DemoWebhookDelivery[];
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((body as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Public API surface ────────────────────────────────────────────────────────

export const triggrr = {
  health: {
    check(): Promise<HealthResponse> {
      return req<HealthResponse>('/api/health');
    },
  },

  auth: {
    register(name: string, slug: string): Promise<RegisterResponse> {
      return req<RegisterResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, slug }),
      });
    },
  },

  events: {
    send(eventType: string, payload: Record<string, unknown>): Promise<EventResponse> {
      return req<EventResponse>('/api/events', {
        method: 'POST',
        body: JSON.stringify({ event_type: eventType, payload }),
      });
    },
  },

  rules: {
    list(): Promise<{ rules: Rule[] }> {
      return req<{ rules: Rule[] }>('/api/rules');
    },
    create(input: CreateRuleInput): Promise<Rule> {
      return req<Rule>('/api/rules', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    update(id: string, patch: RulePatchInput): Promise<Rule> {
      return req<Rule>(`/api/rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },
    toggle(id: string, is_active: boolean): Promise<Rule> {
      return req<Rule>(`/api/rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active }),
      });
    },
    delete(id: string): Promise<{ message: string }> {
      return req<{ message: string }>(`/api/rules/${id}`, { method: 'DELETE' });
    },
    getLogs(id: string): Promise<RuleLogsResponse> {
      return req<RuleLogsResponse>(`/api/rules/${id}/logs`);
    },
  },

  logs: {
    list(params?: {
      status?: string;
      cursor?: string;
      limit?: number;
    }): Promise<LogsResponse> {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.cursor) qs.set('cursor', params.cursor);
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return req<LogsResponse>(`/api/logs${query ? `?${query}` : ''}`);
    },
  },

  stats: {
    get(): Promise<{ stats: OrgStats }> {
      return req<{ stats: OrgStats }>('/api/stats');
    },
  },

  dlq: {
    list(): Promise<{ jobs: DlqJob[] }> {
      return req<{ jobs: DlqJob[] }>('/api/dlq');
    },
    retry(jobId: string): Promise<{ message: string; eventId: string }> {
      return req<{ message: string; eventId: string }>(`/api/dlq/${jobId}/retry`, {
        method: 'POST',
      });
    },
  },

  demoWebhook: {
    get(): Promise<DemoWebhookResponse> {
      return req<DemoWebhookResponse>('/api/demo-webhook');
    },
    clear(): Promise<{ ok: boolean }> {
      return req<{ ok: boolean }>('/api/demo-webhook', { method: 'DELETE' });
    },
  },
};
