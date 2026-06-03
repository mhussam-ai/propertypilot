import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Users,
  Megaphone,
  PhoneCall,
  Inbox,
  BarChart3,
  Settings,
  ShieldCheck,
} from "lucide-react";

const nav = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/properties", label: "Properties", icon: Building2 },
  { href: "/app/leads", label: "Leads", icon: Users },
  { href: "/app/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/app/calls", label: "Calls", icon: PhoneCall },
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  tenantName,
  userEmail,
}: {
  children: React.ReactNode;
  tenantName: string;
  userEmail: string;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r bg-muted/30">
        <div className="p-4">
          <Link href="/app" className="text-base font-semibold">PropertyPilot</Link>
          <p className="text-xs text-muted-foreground">{tenantName}</p>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
          <Link
            href="/admin/ops"
            className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <ShieldCheck className="h-4 w-4" />
            Admin · Ops
          </Link>
        </nav>
        <div className="absolute bottom-0 w-60 border-t p-3 text-xs text-muted-foreground">
          {userEmail}
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
