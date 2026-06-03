/**
 * TypeScript types for the Bolna v2 API.
 *
 * Source: https://www.bolna.ai/docs/api-reference/agent/v2/overview
 * and related pages aggregated in bolna-llms-full.txt.
 *
 * Only the surface PropertyPilot consumes is modeled here.
 */

export type CallStatus =
  | "scheduled"
  | "queued"
  | "initiated"
  | "dialing"
  | "in-progress"
  | "completed"
  | "failed"
  | "no-answer"
  | "busy"
  | "voicemail"
  | "rescheduled"
  | "error";

export interface RetryConfig {
  enabled: boolean;
  max_retries?: number;
  retry_on_statuses?: Array<"no-answer" | "busy" | "failed" | "error">;
  retry_on_voicemail?: boolean;
  retry_intervals_minutes?: number[];
}

export interface CallingGuardrails {
  call_start_hour: number; // 0-23, recipient's local timezone
  call_end_hour: number;
}

export interface AgentTaskTools {
  tools?: Array<Record<string, unknown>>;
}

export interface AgentConfig {
  agent_name: string;
  agent_welcome_message: string;
  webhook_url: string;
  tasks: Array<Record<string, unknown>>;
  calling_guardrails?: CallingGuardrails;
  ingest_source_config?: Record<string, unknown>;
}

export interface AgentPrompts {
  task_1?: { system_prompt: string };
  [k: string]: { system_prompt: string } | undefined;
}

export interface CreateAgentRequest {
  agent_config: AgentConfig;
  agent_prompts: AgentPrompts;
}

export interface CreateAgentResponse {
  agent_id: string;
  state?: string;
}

export interface AgentRecord {
  agent_id: string;
  agent_config: AgentConfig;
  agent_prompts: AgentPrompts;
  created_at: string;
  updated_at?: string;
}

export interface StartCallRequest {
  agent_id: string;
  recipient_phone_number: string;
  from_phone_number?: string;
  user_data?: Record<string, unknown>;
  /** Override agent config at call time. Currently supports voice_id (Feb 2026). */
  agent_data?: { voice_id?: string };
  retry_config?: RetryConfig;
  bypass_call_guardrails?: boolean;
  /** ISO 8601 timestamp for future-scheduled calls (Aug 2025). */
  scheduled_at?: string;
}

export interface StartCallResponse {
  execution_id: string;
  status: CallStatus;
}

export interface RetryHistoryEntry {
  attempt: number;
  status: string;
  at: string;
}

export interface ExtractedDispositionResult {
  subjective: string | null;
  objective: string | string[] | null;
  confidence: number;
  confidence_label: "High" | "Medium" | "Low";
  reasoning_subjective?: string;
  reasoning_objective?: string;
  validation?: { is_valid: boolean; expected_type: string };
}

export type ExtractedData = Record<string, Record<string, ExtractedDispositionResult>>;

export interface TelephonyData {
  duration?: number;
  to_number?: string;
  from_number?: string;
  recording_url?: string | null;
  hosted_telephony?: boolean;
  provider_call_id?: string;
  call_type?: string;
  provider?: string;
  hangup_by?: string | null;
  hangup_reason?: string | null;
  hangup_provider_code?: string | null;
  ring_duration?: number | null;
  post_dial_delay?: number | null;
  to_number_carrier?: string | null;
}

export interface ExecutionRecord {
  id: string;
  agent_id: string;
  status: CallStatus;
  /** Bolna returns conversation_duration, NOT conversation_time */
  conversation_duration?: number;
  /** Bolna returns total_cost, NOT cost */
  total_cost?: number;
  transcript?: string | null;
  summary?: string | null;
  error_message?: string | null;
  answered_by_voice_mail?: boolean | null;
  /** Top-level phone fields */
  user_number?: string;
  agent_number?: string;
  /** Telephony details nested under telephony_data */
  telephony_data?: TelephonyData;
  user_data?: Record<string, unknown>;
  extracted_data?: ExtractedData;
  retry_count?: number;
  retry_config?: RetryConfig;
  retry_history?: RetryHistoryEntry[];
  scheduled_at?: string;
  initiated_at?: string;
  created_at: string;
  updated_at?: string;
  provider?: string;
}

export interface ListExecutionsResponse {
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  data: ExecutionRecord[];
}

/* ---------- Dispositions (Mar 2026) ---------- */

export type SubjectiveType = "text" | "timestamp" | "numeric" | "boolean" | "email" | "regex";

export interface ObjectiveOption {
  value: string;
  condition: string;
  sub_options?: ObjectiveOption[];
}

export interface SubjectiveTypeConfig {
  pattern: string;
  description?: string;
}

export interface DispositionDefinition {
  name: string;
  question: string;
  system_prompt?: string;
  category: string;
  model?: string; // default gpt-4o-mini
  is_subjective?: boolean;
  is_objective?: boolean;
  subjective_type?: SubjectiveType;
  subjective_type_config?: SubjectiveTypeConfig | null;
  objective_options?: ObjectiveOption[];
}

export interface DispositionRecord extends DispositionDefinition {
  id: string;
  agent_ids: string[];
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface BulkCreateDispositionsRequest {
  agent_id: string;
  dispositions: DispositionDefinition[];
}

export interface BulkCreateDispositionsResponse {
  message: string;
  ids: string[];
}

export interface TestDispositionsRequest {
  transcript: string;
  user_data?: Record<string, unknown>;
}

export interface TestDispositionsResponse {
  extracted_data: ExtractedData;
}

/* ---------- Batches ---------- */

export interface CreateBatchRequest {
  agent_id: string;
  /** CSV body as a Buffer/Blob (multipart upload). */
  file: Blob | File;
  from_phone_number?: string;
  retry_config?: RetryConfig;
}

export interface BatchRecord {
  batch_id: string;
  agent_id: string;
  status: "draft" | "scheduled" | "running" | "completed" | "stopped" | "failed";
  scheduled_at?: string;
  total_rows: number;
  created_at: string;
}

export interface ScheduleBatchRequest {
  scheduled_at: string; // ISO 8601
}

/* ---------- Custom function tool spec (for prompt tools) ---------- */

export interface BolnaCustomFunctionTool {
  name: string;
  description: string;
  pre_call_message?: string | Record<string, string>;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  key: "custom_task";
  value: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    param: Record<string, string>;
    api_token?: string;
    headers?: Record<string, string>;
  };
}
