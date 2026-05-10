import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { SensorHealth } from "@/components/SensorHealth";
import { HomeMap } from "@/components/HomeMap";

export const Route = createFileRoute("/sensors")({
  head: () => ({
    meta: [
      { title: "Sensor health — Hearth" },
      { name: "description", content: "Status of every receiver and transmitter in the home." },
    ],
  }),
  component: SensorsPage,
});

function SensorsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Sensor health"
        title="Devices in this home"
        description="Hearth uses a small mesh of receivers around an open living area. We watch packet rate, signal strength, and calibration so fall detection stays trustworthy."
      />
      <SensorHealth />
      <div className="mt-8">
        <h2 className="font-serif text-2xl text-foreground mb-3">Coverage</h2>
        <HomeMap highlightSensorId="RX2" activeRoomId="open" />
      </div>
    </AppShell>
  );
}
