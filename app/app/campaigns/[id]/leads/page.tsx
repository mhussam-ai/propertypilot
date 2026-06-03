import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CampaignLeadManager } from "@/components/feature/CampaignLeadManager";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CampaignAddLeadsPage({ params }: PageProps) {
  const { id: campaignId } = await params;
  const supabase = await createSupabaseServerClient();

  // Validate campaign exists and fetch details
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, property_id")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    redirect("/app/campaigns");
  }

  // Fetch past campaigns
  const { data: pastCampaigns } = await supabase
    .from("campaigns")
    .select("id, name")
    .neq("id", campaignId)
    .order("created_at", { ascending: false });

  // Optional: fetch lead counts for past campaigns
  // For simplicity, we just use the name here. In a robust app, we might join against leads or use a view.

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Leads to Campaign</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Campaign: <span className="font-medium text-foreground">{campaign.name}</span>
        </p>
      </div>

      <CampaignLeadManager 
        campaignId={campaignId} 
        pastCampaigns={pastCampaigns ?? []} 
      />
    </div>
  );
}
