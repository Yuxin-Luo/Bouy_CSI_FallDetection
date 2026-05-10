import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { HomeMap } from "@/components/HomeMap";
import { NotificationsList } from "@/components/NotificationsList";
import { houseProfile } from "@/lib/home-data";
import { Activity, Footprints, Heart, MapPin, Users, Radio, Phone, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hearth — Home overview" },
      { name: "description", content: "Calm, real-time monitoring overview for the people you care about." },
    ],
  }),
  component: Overview,
});

function Overview() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="House profile"
        title={houseProfile.name}
        description={houseProfile.description}
      >
        <Link to="/notifications" className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
          1 alert needs review
        </Link>
      </PageHeader>

      {/* House profile card */}
      <section className="rounded-3xl bg-gradient-to-br from-primary to-[oklch(0.42_0.08_150)] text-primary-foreground p-8 mb-8 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative grid md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-70">Resident</p>
            <p className="font-serif text-3xl mt-1">{houseProfile.resident}</p>
            <p className="text-sm opacity-80 mt-1 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {houseProfile.address}</p>
          </div>
          <Stat label="Currently in" value="Open Living" />
          <Stat label="Care circle" value={`${4} people`} sub={houseProfile.primaryGroup} />
        </div>
      </section>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MiniCard Icon={Activity} label="Heart rate" value="72 bpm" tone="ok" />
        <MiniCard Icon={Footprints} label="Steps today" value="2,184" tone="ok" />
        <MiniCard Icon={Heart} label="Vitals" value="Stable" tone="ok" />
        <MiniCard Icon={Radio} label="Sensors" value="3 of 4 healthy" tone="warn" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <SectionHeader title="Home map" to="/map" cta="Open map" />
            <HomeMap activeRoomId="open" highlightSensorId="RX1" />
          </div>
          <div>
            <SectionHeader title="Recent notifications" to="/notifications" cta="View all" />
            <NotificationsList limit={3} />
          </div>
        </div>

        <div className="space-y-4">
          <QuickAction Icon={Phone} title="Call Margaret" subtitle="Voice or video" />
          <QuickAction Icon={Users} title="Care circle" subtitle="4 caregivers · routing OK" to="/caregivers" />
          <QuickAction Icon={Radio} title="Sensor health" subtitle="RX2 reporting low packet rate" to="/sensors" />
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider opacity-70">{label}</p>
      <p className="font-serif text-3xl mt-1">{value}</p>
      {sub && <p className="text-sm opacity-80 mt-1">{sub}</p>}
    </div>
  );
}

function MiniCard({ Icon, label, value, tone }: { Icon: typeof Activity; label: string; value: string; tone: "ok" | "warn" }) {
  const cls = tone === "ok" ? "bg-primary-soft text-primary" : "bg-accent text-accent-foreground";
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-5 shadow-[var(--shadow-soft)]">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${cls}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm text-muted-foreground mt-4">{label}</p>
      <p className="font-serif text-2xl text-foreground mt-1">{value}</p>
    </div>
  );
}

function SectionHeader({ title, to, cta }: { title: string; to: string; cta: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      <Link to={to} className="text-sm text-primary hover:underline flex items-center gap-1">
        {cta} <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function QuickAction({ Icon, title, subtitle, to }: { Icon: typeof Phone; title: string; subtitle: string; to?: string }) {
  const inner = (
    <div className="rounded-2xl bg-card border border-border/60 p-5 shadow-[var(--shadow-soft)] flex items-center gap-4 hover:bg-secondary/40 transition">
      <div className="h-11 w-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : <button className="block w-full text-left">{inner}</button>;
}
