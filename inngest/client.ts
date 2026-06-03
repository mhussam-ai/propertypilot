import { EventSchemas, Inngest } from "inngest";

/**
 * Inngest event catalog for PropertyPilot. Keep these names stable — they
 * are referenced from the Inngest dashboard's run history.
 */
type Events = {
  "call.start": {
    data: {
      tenantId: string;
      leadId: string;
      campaignId: string;
      propertyId: string;
      promptVersion: number;
      traceId: string;
    };
  };
  "call.webhook.ingested": {
    data: {
      tenantId: string;
      callEventId: string;
      bolnaExecutionId: string;
      status: string;
    };
  };
  "lead.route_hot": {
    data: { tenantId: string; callId: string; leadId: string };
  };
  "lead.recall_cold": {
    data: { tenantId: string; campaignId: string };
  };
};

export const inngest = new Inngest({
  id: "propertypilot",
  schemas: new EventSchemas().fromRecord<Events>(),
});
