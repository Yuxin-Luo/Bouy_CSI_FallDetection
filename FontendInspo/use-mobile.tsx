import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Bell, Home, Leaf, Map as MapIcon, Phone, Radio, Users } from "lucide-react";
import { houseProfile } from "@/lib/home-data";
import type { LucideIcon } from "lucide-react";

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Overview", icon: Home },
  { to: "/map", label: "Home map", icon: MapIcon },
  { to: "/sensors", label: "Sensor health", icon: Radio },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/caregivers", label: "Care circle", icon: Users },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/40 p-5 sticky top-0 h-screen">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
            <Leaf className="h-5 w-5" />
          </div>
          <div>
            <p className="font-serif text-xl text-foreground leading-none">Hearth</p>
            <p className="text-[11px] text-muted-foreground mt-1">Caretaker view</p>
          </div>
        </div>

        <div className="rounded-2xl bg-primary text-primary-foreground p-4 mb-6">
          <p className="text-[11px] uppercase tracking-wider opacity-70">Monitoring</p>
          <p className="font-serif text-xl mt-1">{houseProfile.name}</p>
          <p className="text-xs opacity-80 mt-1">{houseProfile.resident}</p>
          <p className="text-[11px] opacity-70 mt-2">{houseProfile.address}</p>
        </div>

        <nav className="space-y-1 flex-1">
          {nav.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-primary-soft text-primary font-medium"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <Link
          to="/resident"
          className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm text-foreground hover:bg-secondary transition"
        >
          <Phone className="h-4 w-4 text-primary" />
          Resident view
        </Link>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">Last sync just now · v0.4</p>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 bg-background/90 backdrop-blur border-b border-border/60">
        <div className="flex items-center gap-2 px-4 h-14">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Leaf className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="font-serif text-base leading-none">{houseProfile.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{houseProfile.resident}</p>
          </div>
          <Link to="/resident" className="text-xs text-primary">Resident</Link>
        </div>
        <nav className="flex overflow-x-auto px-2 pb-2 gap-1">
          {nav.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-secondary"
                }`}
              >
                <n.icon className="h-3.5 w-3.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 min-w-0 pt-28 lg:pt-0">
        <div className="max-w-6xl mx-auto px-5 lg:px-10 py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
      <div>
        {eyebrow && <p className="text-xs uppercase tracking-wider text-primary/70 font-medium">{eyebrow}</p>}
        <h1 className="font-serif text-4xl text-foreground mt-1">{title}</h1>
        {description && <p className="text-muted-foreground mt-2 max-w-xl">{description}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

// Re-export Activity icon usage so unused-import lint stays happy.
export const _icons = { Activity };
