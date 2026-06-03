"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapTenant } from "@/app/actions/bootstrap-tenant";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: signUpErr, data } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { company_name: companyName } },
    });
    setLoading(false);
    if (signUpErr) {
      setError(signUpErr.message);
      return;
    }
    if (data.user) {
      // If email confirmations are off (local dev), the session is already established.
      // Bootstrap the tenant: creates tenants/tenant_users/tenant_secrets atomically.
      const result = await bootstrapTenant(companyName);
      if (!result.ok) {
        setError(`Tenant setup failed: ${result.error}. Please contact support.`);
        return;
      }
      router.push("/app");
      router.refresh();
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
          <CardDescription>14-day trial. No card.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-sm font-medium" htmlFor="company">Company name</label>
              <input
                id="company"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                placeholder="Prestige Group"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Create workspace"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Have an account? <Link href="/login" className="underline">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
