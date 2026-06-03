import type { BolnaCustomFunctionTool } from "./types";

/**
 * Build the `book_site_visit` custom function tool registered on every PropertyPilot
 * Bolna agent. The agent calls this when the caller verbally confirms a day + time.
 *
 * Auth: Bearer header set to the tenant's webhook_token (same token used to authenticate
 * inbound webhooks). The /api/v1/agent-tools/book-visit endpoint looks up the tenant by
 * matching the token across encrypted secrets.
 */
export function buildBookVisitTool(opts: {
  baseUrl: string;
  webhookToken: string;
  bhkOptions: string[];
}): BolnaCustomFunctionTool {
  return {
    name: "book_site_visit",
    description:
      "Use this function ONLY after the caller has verbally confirmed a specific day AND a specific time for a site visit. Captures the booking and tells the SDR team. Do not call this for tentative interest or vague day/time mentions.",
    pre_call_message: {
      en: "Got it, let me lock that in.",
      hi: "ठीक है, मैं इसे बुक कर देता हूँ।",
      mr: "ठीक आहे, मी बुक करतो.",
      gu: "બરાબર, હું બુક કરી રહ્યો છું.",
      ta: "சரி, நான் பதிவு செய்கிறேன்.",
    },
    parameters: {
      type: "object",
      properties: {
        day: {
          type: "string",
          description:
            "The day the caller agreed to visit. A weekday name (e.g. 'Saturday') or ISO date.",
        },
        time: {
          type: "string",
          description: "The time the caller agreed to visit, e.g. '11:00 AM' or '5:30 PM'.",
        },
        bhk: {
          type: "string",
          description: `The BHK configuration the caller is interested in. One of: ${opts.bhkOptions.join(", ")}.`,
        },
        budget_inr: {
          type: "integer",
          description:
            "The caller's budget in INR. Capture the upper bound if they gave a range. 0 if not mentioned.",
        },
        purpose: {
          type: "string",
          description: "Either 'self' (end-user) or 'investment'.",
        },
        caller_name: {
          type: "string",
          description: "Confirmed caller name from the conversation.",
        },
      },
      required: ["day", "time", "bhk"],
    },
    key: "custom_task",
    value: {
      method: "POST",
      url: `${opts.baseUrl}/api/v1/agent-tools/book-visit`,
      api_token: `Bearer ${opts.webhookToken}`,
      headers: { "Content-Type": "application/json" },
      param: {
        execution_id: "%(execution_id)s",
        day: "%(day)s",
        time: "%(time)s",
        bhk: "%(bhk)s",
        budget_inr: "%(budget_inr)i",
        purpose: "%(purpose)s",
        caller_name: "%(caller_name)s",
      },
    },
  };
}
