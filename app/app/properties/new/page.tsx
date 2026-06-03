import Link from "next/link";
import { createPropertyForm } from "@/app/actions/create-property";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_BHK = JSON.stringify(
  [
    { bhk: "2", carpet_area_sqft: 850, price_inr: 12_500_000 },
    { bhk: "3", carpet_area_sqft: 1180, price_inr: 18_000_000 },
  ],
  null,
  2,
);

const DEFAULT_VOICE_OVERRIDES = JSON.stringify(
  {
    hi: "sarvam-bulbul-v3-hindi",
    mr: "sarvam-bulbul-v3-marathi",
    ta: "sarvam-bulbul-v3-tamil",
    gu: "sarvam-bulbul-v3-gujarati",
  },
  null,
  2,
);

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
];

interface SearchParams { searchParams: Promise<{ error?: string }> }

export default async function NewPropertyPage({ searchParams }: SearchParams) {
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New property</h1>
          <p className="text-sm text-muted-foreground">
            Creates a Bolna agent, registers 11 canonical dispositions, and links the{" "}
            <code className="text-xs">book_site_visit</code> tool.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/properties">Cancel</Link>
        </Button>
      </div>

      {sp.error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{sp.error}</CardContent>
        </Card>
      )}

      <form action={createPropertyForm} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field name="name" label="Property name" placeholder="Prestige Falcon City" required />
            <Field name="rera" label="RERA number" placeholder="PR/KA/RERA/1251/308/PR/220523" required />
            <Field name="location" label="Location" placeholder="Whitefield, Bangalore" required className="md:col-span-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory & pitch</CardTitle>
            <CardDescription>BHK configs are JSON; amenities are comma-separated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              name="bhk_configs"
              label="BHK configurations (JSON)"
              defaultValue={DEFAULT_BHK}
              as="textarea"
              rows={6}
              required
            />
            <Field name="amenities" label="Amenities" placeholder="Clubhouse, Pool, Gym, Tennis Court" />
            <Field
              name="usp_lines"
              label="USP lines (one per line)"
              as="textarea"
              rows={4}
              placeholder={"35-acre integrated township\nPossession Q4 2027\n70% open green space"}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field name="price_min" label="Price band — min (INR)" type="number" defaultValue="12500000" required />
              <Field name="price_max" label="Price band — max (INR)" type="number" defaultValue="21000000" required />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calling guardrails</CardTitle>
            <CardDescription>
              Enforced by Bolna in the recipient&apos;s timezone. PropertyPilot does not gate
              calls itself.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field name="visit_start" label="Start hour (0-23)" type="number" defaultValue="9" min={0} max={23} required />
            <Field name="visit_end" label="End hour (0-23)" type="number" defaultValue="20" min={0} max={23} required />
            <Field name="daily_call_cap" label="Daily call cap" type="number" defaultValue="500" required />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice & languages</CardTitle>
            <CardDescription>Pick the languages this property supports; map each to a Bolna voice_id.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Supported languages</label>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                {LANGUAGES.map((l) => (
                  <label key={l.code} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <input
                      type="checkbox"
                      name="supported_languages"
                      value={l.code}
                      defaultChecked={["en", "hi"].includes(l.code)}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </div>
            <Field
              name="default_voice_id"
              label="Default voice_id (Bolna)"
              defaultValue="FiIgWdzVKAalJyAgg8Pg"
              required
            />
            <Field
              name="voice_overrides"
              label="Per-language voice overrides (JSON)"
              as="textarea"
              rows={6}
              defaultValue={DEFAULT_VOICE_OVERRIDES}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/app/properties">Cancel</Link>
          </Button>
          <Button type="submit">Create property & provision agent</Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  as,
  className,
  ...rest
}: {
  name: string;
  label: string;
  as?: "textarea";
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, "name">) {
  return (
    <div className={className}>
      <label className="text-sm font-medium" htmlFor={name}>{label}</label>
      {as === "textarea" ? (
        <textarea
          id={name}
          name={name}
          {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          className="mt-1 w-full rounded-md border bg-background p-3 font-mono text-xs"
        />
      ) : (
        <input
          id={name}
          name={name}
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
        />
      )}
    </div>
  );
}
