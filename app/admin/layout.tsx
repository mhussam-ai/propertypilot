import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenantContext } from "@/lib/tenant/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    redirect("/app");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r bg-muted/30">
        <div className="p-4">
          <Link href="/admin/ops" className="text-base font-semibold">Admin</Link>
          <p className="text-xs text-muted-foreground">{ctx.tenantName}</p>
        </div>
        <nav className="flex flex-col gap-1 px-2 text-sm">
          <Link href="/admin/ops" className="rounded-md px-3 py-2 hover:bg-accent">Ops health</Link>
          <Link href="/admin/usage" className="rounded-md px-3 py-2 hover:bg-accent">Usage</Link>
          <Link href="/app" className="mt-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-accent">
            ← Back to app
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
