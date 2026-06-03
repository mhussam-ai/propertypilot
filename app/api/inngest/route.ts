import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  callStart,
  callFinalize,
  leadRouteHot,
  leadRecallCold,
  campaignDispatch,
  bolnaPoll,
  bolnaSyncCalls,
  dncScrub,
  tenantCostRollup,
} from "@/inngest/functions";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    callStart,
    callFinalize,
    leadRouteHot,
    leadRecallCold,
    campaignDispatch,
    bolnaPoll,
    bolnaSyncCalls,
    dncScrub,
    tenantCostRollup,
  ],
});
