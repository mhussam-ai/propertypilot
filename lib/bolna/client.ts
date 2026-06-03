import { logger } from "@/lib/logger";
import { withBreaker } from "@/lib/resilience/circuit-breaker";
import { withRetry } from "@/lib/resilience/retry";
import { newTraceId, TRACE_HEADER } from "@/lib/middleware/trace-id";
import type {
  AgentRecord,
  BatchRecord,
  BulkCreateDispositionsRequest,
  BulkCreateDispositionsResponse,
  CreateAgentRequest,
  CreateAgentResponse,
  DispositionRecord,
  ExecutionRecord,
  ListExecutionsResponse,
  ScheduleBatchRequest,
  StartCallRequest,
  StartCallResponse,
  TestDispositionsRequest,
  TestDispositionsResponse,
} from "./types";

export class BolnaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ? `${message}: ${JSON.stringify(body)}` : `Bolna API error ${status}: ${JSON.stringify(body)}`);
    this.name = "BolnaApiError";
  }
}

export interface BolnaClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Optional logical prefix for breakers. Useful when one process talks to many tenants' Bolna accounts. */
  breakerPrefix?: string;
  fetchImpl?: typeof fetch;
  /** Default per-request timeout. Caller can override per call. Default 20_000ms. */
  defaultTimeoutMs?: number;
}

interface BolnaRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Used for multipart uploads (batch CSV). When set, body must be a FormData. */
  multipart?: boolean;
  /** Override the default retry/breaker label. */
  label?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Hard deadline per attempt. If unset, BolnaClient.defaultTimeoutMs applies. */
  timeoutMs?: number;
  /** External cancellation signal (e.g. user navigated away). Linked into the per-attempt controller. */
  signal?: AbortSignal;
}

export class BolnaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly breakerPrefix: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  /** In-flight GET requests deduplicated by URL. */
  private inflight = new Map<string, Promise<unknown>>();

  constructor(opts: BolnaClientOptions) {
    if (!opts.apiKey) throw new Error("BolnaClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? process.env.BOLNA_API_BASE_URL ?? "https://api.bolna.ai").replace(/\/+$/, "");
    this.breakerPrefix = opts.breakerPrefix ?? "bolna";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 20_000;
  }

  /* ---------- Agents ---------- */

  async createAgent(req: CreateAgentRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CreateAgentResponse> {
    return this.request<CreateAgentResponse>({
      method: "POST",
      path: "/v2/agent",
      body: req,
      label: "createAgent",
      timeoutMs: opts.timeoutMs ?? 15_000,
      signal: opts.signal,
    });
  }

  async getAgent(agentId: string): Promise<AgentRecord> {
    return this.request<AgentRecord>({
      method: "GET",
      path: `/v2/agent/${agentId}`,
      label: "getAgent",
    });
  }

  async patchAgent(agentId: string, patch: Partial<CreateAgentRequest["agent_config"]> & Record<string, unknown>): Promise<AgentRecord> {
    return this.request<AgentRecord>({
      method: "PATCH",
      path: `/v2/agent/${agentId}`,
      body: patch,
      label: "patchAgent",
    });
  }

  async updateAgent(agentId: string, req: CreateAgentRequest): Promise<AgentRecord> {
    return this.request<AgentRecord>({
      method: "PUT",
      path: `/v2/agent/${agentId}`,
      body: req,
      label: "updateAgent",
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request<void>({
      method: "DELETE",
      path: `/v2/agent/${agentId}`,
      label: "deleteAgent",
    });
  }

  async stopAgentQueuedCalls(agentId: string): Promise<void> {
    await this.request<void>({
      method: "POST",
      path: `/v2/agent/${agentId}/stop`,
      label: "stopAgentQueuedCalls",
    });
  }

  /* ---------- Calls ---------- */

  async startCall(req: StartCallRequest): Promise<StartCallResponse> {
    return this.request<StartCallResponse>({
      method: "POST",
      path: "/call",
      body: req,
      label: "startCall",
    });
  }

  async stopCall(executionId: string): Promise<void> {
    await this.request<void>({
      method: "POST",
      path: `/call/${executionId}/stop`,
      label: "stopCall",
    });
  }

  /* ---------- Executions ---------- */

  async getExecution(executionId: string): Promise<ExecutionRecord> {
    // Dedupe in-flight GETs for the same execution.
    const key = `GET /executions/${executionId}`;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<ExecutionRecord>;
    const p = this.request<ExecutionRecord>({
      method: "GET",
      path: `/executions/${executionId}`,
      label: "getExecution",
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async listAgentExecutions(
    agentId: string,
    opts: { page_number?: number; page_size?: number } = {},
  ): Promise<ListExecutionsResponse> {
    return this.request<ListExecutionsResponse>({
      method: "GET",
      path: `/v2/agent/${agentId}/executions`,
      query: opts as Record<string, number>,
      label: "listAgentExecutions",
    });
  }

  /* ---------- Dispositions ---------- */

  async bulkCreateDispositions(req: BulkCreateDispositionsRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<BulkCreateDispositionsResponse> {
    return this.request<BulkCreateDispositionsResponse>({
      method: "POST",
      path: "/dispositions/bulk",
      body: req,
      label: "bulkCreateDispositions",
      timeoutMs: opts.timeoutMs ?? 15_000,
      signal: opts.signal,
    });
  }

  async listDispositions(agentId?: string): Promise<DispositionRecord[]> {
    const res = await this.request<{ data?: DispositionRecord[] } | DispositionRecord[]>({
      method: "GET",
      path: "/dispositions/",
      query: agentId ? { agent_id: agentId } : undefined,
      label: "listDispositions",
    });
    return Array.isArray(res) ? res : (res.data ?? []);
  }

  async deleteDisposition(dispositionId: string): Promise<void> {
    await this.request<void>({
      method: "DELETE",
      path: `/dispositions/${dispositionId}`,
      label: "deleteDisposition",
    });
  }

  async testAgentDispositions(agentId: string, req: TestDispositionsRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TestDispositionsResponse> {
    return this.request<TestDispositionsResponse>({
      method: "POST",
      path: `/v2/agent/${agentId}/dispositions/test`,
      body: req,
      label: "testAgentDispositions",
      timeoutMs: opts.timeoutMs ?? 30_000,
      signal: opts.signal,
    });
  }

  /* ---------- Batches ---------- */

  async createBatch(args: {
    agentId: string;
    csv: Blob | File;
    fromPhoneNumber?: string;
    retryConfig?: import("./types").RetryConfig;
  }): Promise<BatchRecord> {
    const form = new FormData();
    form.append("agent_id", args.agentId);
    form.append("file", args.csv, "batch.csv");
    if (args.fromPhoneNumber) form.append("from_phone_number", args.fromPhoneNumber);
    if (args.retryConfig) form.append("retry_config", JSON.stringify(args.retryConfig));
    return this.request<BatchRecord>({
      method: "POST",
      path: "/batches",
      body: form,
      multipart: true,
      label: "createBatch",
    });
  }

  async scheduleBatch(batchId: string, req: ScheduleBatchRequest): Promise<BatchRecord> {
    return this.request<BatchRecord>({
      method: "POST",
      path: `/batches/${batchId}/schedule`,
      body: req,
      label: "scheduleBatch",
    });
  }

  async stopBatch(batchId: string): Promise<BatchRecord> {
    return this.request<BatchRecord>({
      method: "POST",
      path: `/batches/${batchId}/stop`,
      label: "stopBatch",
    });
  }

  async getBatch(batchId: string): Promise<BatchRecord> {
    return this.request<BatchRecord>({
      method: "GET",
      path: `/batches/${batchId}`,
      label: "getBatch",
    });
  }

  /* ---------- Core request plumbing ---------- */

  private async request<T>(init: BolnaRequestInit): Promise<T> {
    const url = this.buildUrl(init.path, init.query);
    const traceId = newTraceId();
    const label = init.label ?? init.path;
    const breakerName = `${this.breakerPrefix}.${label}`;
    const timeoutMs = init.timeoutMs ?? this.defaultTimeoutMs;
    const external = init.signal;

    return withBreaker(breakerName, () =>
      withRetry(
        async () => {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            [TRACE_HEADER]: traceId,
          };
          let body: BodyInit | undefined;
          if (init.body !== undefined) {
            if (init.multipart) {
              body = init.body as BodyInit;
              // Let fetch set the multipart boundary automatically.
            } else {
              headers["Content-Type"] = "application/json";
              body = JSON.stringify(init.body);
            }
          }

          // Per-attempt cancellation: deadline OR external signal trips the controller.
          const controller = new AbortController();
          if (external?.aborted) controller.abort(external.reason);
          const onExternalAbort = () => controller.abort(external?.reason);
          external?.addEventListener("abort", onExternalAbort, { once: true });
          const timer = setTimeout(() => controller.abort(new Error("bolna-timeout")), timeoutMs);

          const start = Date.now();
          try {
            const res = await this.fetchImpl(url, {
              method: init.method ?? "GET",
              headers,
              body,
              signal: controller.signal,
            });
            const elapsedMs = Date.now() - start;
            const text = await res.text();
            let payload: unknown = null;
            if (text) {
              try {
                payload = JSON.parse(text);
              } catch {
                payload = text;
              }
            }
            logger.debug(
              { bolna: label, status: res.status, ms: elapsedMs, traceId },
              "Bolna call complete",
            );
            if (!res.ok) {
              throw new BolnaApiError(res.status, payload, `Bolna ${label} → ${res.status}`);
            }
            return payload as T;
          } catch (err) {
            // Translate abort/timeout to a retryable 408 so withRetry handles it uniformly.
            const isAbort =
              (err as { name?: string } | null)?.name === "AbortError" ||
              (err as { code?: string } | null)?.code === "ABORT_ERR";
            if (isAbort) {
              const externallyAborted = external?.aborted ?? false;
              if (externallyAborted) {
                // Caller cancelled; do not retry.
                throw err;
              }
              throw new BolnaApiError(
                408,
                { reason: "timeout", timeoutMs },
                `Bolna ${label} timed out after ${timeoutMs}ms`,
              );
            }
            throw err;
          } finally {
            clearTimeout(timer);
            external?.removeEventListener("abort", onExternalAbort);
          }
        },
        {
          label,
          retryable: (err) => {
            if (err instanceof BolnaApiError) {
              if (err.status === 408 || err.status === 429) return true;
              return err.status >= 500;
            }
            // External-abort errors are not BolnaApiError — surface them, do not retry.
            if ((err as { name?: string } | null)?.name === "AbortError") return false;
            return true; // network errors
          },
        },
      ),
    );
  }

  private buildUrl(path: string, query?: BolnaRequestInit["query"]): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}
