import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { HomeMap } from "@/components/HomeMap";
import { rooms, sensors } from "@/lib/home-data";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Home map — Hearth" },
      { name: "description", content: "Top-down schematic of the monitored home with sensor positions and status." },
    ],
  }),
  component: MapPage,
});

function MapPage() {
  const liveRooms = rooms.filter((r) => r.type !== "hallway");
  return (
    <AppShell>
      <PageHeader
        eyebrow="Home map"
        title="Where things are"
        description="A simple top-down view of the apartment. Sensors are installed in the Open Living area; presence and fall events appear here in real time."
      />
      <HomeMap activeRoomId="open" highlightSensorId="RX1" />

      <div className="grid md:grid-cols-2 gap-6 mt-8">
        <div className="rounded-2xl bg-card border border-border/60 p-6 shadow-[var(--shadow-soft)]">
          <h3 className="font-serif text-2xl text-foreground">Rooms</h3>
          <ul className="mt-3 divide-y divide-border/60">
            {liveRooms.map((r) => (
              <li key={r.id} className="py-3 flex items-center justify-between text-sm">
                <span className="text-foreground">{r.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{r.type}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 p-6 shadow-[var(--shadow-soft)]">
          <h3 className="font-serif text-2xl text-foreground">Installed sensors</h3>
          <ul className="mt-3 divide-y divide-border/60">
            {sensors.map((s) => (
              <li key={s.id} className="py-3 flex items-center justify-between text-sm">
                <span className="text-foreground">
                  {s.id} <span className="text-muted-foreground text-xs">· {s.kind}</span>
                </span>
                <span className="text-xs text-muted-foreground">Open Living · {s.packetRate} pkt/s</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
