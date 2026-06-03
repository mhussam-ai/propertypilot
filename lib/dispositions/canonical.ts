import type { DispositionDefinition } from "@/lib/bolna/types";
import type { PropertyFormT } from "@/lib/schema/property-form";

/**
 * The canonical PropertyPilot disposition set, registered with every property's
 * Bolna agent via POST /dispositions/bulk at property-save time.
 *
 * Each disposition is one question Bolna's post-call extraction LLM is asked against
 * the transcript. Together they form the queryable typed outcome we display in
 * /app/calls/[id] and roll up into CMO analytics.
 */

export function buildCanonicalDispositions(property: Pick<PropertyFormT, "bhk_configs">): DispositionDefinition[] {
  const bhkValues = property.bhk_configs.map((c) => c.bhk);
  return [
    // ---------- Lead Quality ----------
    {
      name: "Call Outcome",
      category: "Lead Quality",
      question:
        "What was the overall outcome of this call with respect to scheduling a site visit?",
      model: "gpt-4o-mini",
      is_objective: true,
      is_subjective: true,
      subjective_type: "text",
      objective_options: [
        {
          value: "interested",
          condition:
            "The caller expressed clear interest in the property and either agreed to a site visit, asked for more info, or asked the agent to call back at a specific time.",
        },
        {
          value: "not_interested",
          condition:
            "The caller declined every proposal and did not ask any follow-up questions about the property.",
        },
        {
          value: "follow_up",
          condition:
            "The caller is undecided or busy and asked the agent to call back later, without giving a clear interested/not-interested signal.",
        },
        {
          value: "wrong_person",
          condition:
            "The person who answered is not the lead — wrong number, deceased, family member who knows nothing about the inquiry, etc.",
        },
        {
          value: "dnc_request",
          condition:
            "The caller explicitly asked to be removed from the list or to never be called again.",
        },
      ],
    },

    // ---------- Visit Details ----------
    {
      name: "Visit Promised",
      category: "Visit Details",
      question:
        "Did the caller commit to a specific site-visit time? Answer true only if both a day AND a time were agreed.",
      model: "gpt-4o-mini",
      is_objective: true,
      objective_options: [
        { value: "true", condition: "Caller agreed to a specific day and time for the site visit." },
        { value: "false", condition: "No firm day-and-time commitment was made." },
      ],
    },
    {
      name: "Visit Day",
      category: "Visit Details",
      question:
        "If the caller agreed to a site visit, what day did they pick? Capture as a weekday name or ISO date.",
      is_subjective: true,
      subjective_type: "text",
    },
    {
      name: "Visit Time",
      category: "Visit Details",
      question:
        "If the caller agreed to a site-visit time, capture the time as ISO 8601 timestamp in the caller's local timezone.",
      is_subjective: true,
      subjective_type: "timestamp",
    },
    {
      name: "BHK Preference",
      category: "Visit Details",
      question:
        "Which BHK configuration is the caller most interested in? Pick from the property's offered configurations.",
      is_objective: true,
      objective_options: bhkValues.map((v) => ({
        value: v,
        condition: `Caller expressed preference for a ${v} BHK unit.`,
      })),
    },
    {
      name: "Budget INR",
      category: "Visit Details",
      question:
        "What budget did the caller mention (in INR)? Capture the upper bound if they gave a range. Numeric only.",
      is_subjective: true,
      subjective_type: "numeric",
    },
    {
      name: "Purpose",
      category: "Visit Details",
      question: "Is the caller buying for self-use (end-user) or as an investment?",
      is_objective: true,
      objective_options: [
        { value: "self", condition: "Caller is buying for personal/family use." },
        { value: "investment", condition: "Caller is buying for rental income or capital appreciation." },
        { value: "unknown", condition: "Purpose was not discussed or is ambiguous." },
      ],
    },

    // ---------- Conversation ----------
    {
      name: "Language Detected",
      category: "Conversation",
      question:
        "Which language did the caller primarily speak in? Use an ISO 639-1 code (en, hi, mr, gu, ta, te, kn, ml, bn, pa).",
      is_subjective: true,
      subjective_type: "regex",
      subjective_type_config: {
        pattern: "^(en|hi|mr|gu|ta|te|kn|ml|bn|pa)$",
        description: "ISO 639-1 code for an Indian language supported by Bolna.",
      },
    },
    {
      name: "Caller Name Confirmed",
      category: "Conversation",
      question:
        "Did the caller confirm the name we addressed them by? Answer false if they corrected the name or if no name was used.",
      is_objective: true,
      objective_options: [
        { value: "true", condition: "Caller confirmed they are the named lead, or didn't object." },
        { value: "false", condition: "Caller corrected the name or denied being that person." },
      ],
    },
    {
      name: "Needs Human",
      category: "Conversation",
      question:
        "Should this call be reviewed by a human SDR before any follow-up? True if the caller asked complex questions the agent couldn't answer well, or if the agent's responses seem off-topic or evasive.",
      is_objective: true,
      objective_options: [
        { value: "true", condition: "Caller asked questions outside the agent's competence, or the agent's responses were unclear." },
        { value: "false", condition: "The agent handled the call well and the outcome is clear." },
      ],
    },
    {
      name: "Hangup Reason",
      category: "Conversation",
      question: "What ended the call?",
      is_objective: true,
      objective_options: [
        { value: "agent_end", condition: "The Bolna agent ended the call after closing it cleanly." },
        { value: "caller_end", condition: "The caller hung up the call." },
        { value: "wrong_person", condition: "Call was ended because the agent reached the wrong person." },
        { value: "busy", condition: "Line was busy and the call never connected." },
        { value: "no_answer", condition: "The phone rang but no one picked up." },
        { value: "silence_timeout", condition: "The agent ended the call after detecting prolonged silence." },
        { value: "voicemail", condition: "The call was answered by voicemail." },
      ],
    },
  ];
}

/**
 * Stable category and disposition names that the rest of PropertyPilot depends on
 * for outcome routing. If you rename anything in buildCanonicalDispositions, update here too.
 */
export const CANONICAL_NAMES = {
  CALL_OUTCOME: { category: "Lead Quality", name: "Call Outcome" },
  VISIT_PROMISED: { category: "Visit Details", name: "Visit Promised" },
  VISIT_DAY: { category: "Visit Details", name: "Visit Day" },
  VISIT_TIME: { category: "Visit Details", name: "Visit Time" },
  BHK_PREFERENCE: { category: "Visit Details", name: "BHK Preference" },
  BUDGET_INR: { category: "Visit Details", name: "Budget INR" },
  PURPOSE: { category: "Visit Details", name: "Purpose" },
  LANGUAGE_DETECTED: { category: "Conversation", name: "Language Detected" },
  CALLER_NAME_CONFIRMED: { category: "Conversation", name: "Caller Name Confirmed" },
  NEEDS_HUMAN: { category: "Conversation", name: "Needs Human" },
  HANGUP_REASON: { category: "Conversation", name: "Hangup Reason" },
} as const;
