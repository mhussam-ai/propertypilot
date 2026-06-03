import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

export const TRACE_HEADER = "x-trace-id";

/** Read the incoming trace id from request headers, or mint a new one. */
export async function getOrMintTraceId(): Promise<string> {
  try {
    const h = await headers();
    return h.get(TRACE_HEADER) ?? randomUUID();
  } catch {
    return randomUUID();
  }
}

export function newTraceId(): string {
  return randomUUID();
}
