import { sensors, rooms, type SensorStatus } from "@/lib/home-data";
import { CheckCircle2, AlertTriangle, XCircle, Radio } from "lucide-react";

const statusMeta: Record<SensorStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  online:   { label: "Online",   cls: "bg-primary-soft text-primary",        Icon: CheckCircle2 },
  degraded: { label: "Degraded", cls: "bg-accent text-accent-foreground",    Icon: AlertTriangle },
  offline:  { label: "Offline",  cls: "bg-destructive/10 text-destructive",  Icon: XCircle },
};

export function SensorHealth({ compact = false }: { compact?: boolean }) {
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "—";

  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="p-6 pb-4 flex items-baseline justify-between">
        <div>
          <h3 className="font-serif text-2xl text-foreground">Sensor health</h3>
          {!compact && (
            <p className="text-sm text-muted-foreground mt-1">
              All receivers and the transmitter for this home.
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{sensors.length} devices</span>
      </div>
      <ul className="divide-y divide-border/60">
        {sensors.map((s) => {
          const meta = statusMeta[s.status];
          return (
            <li key={s.id} className="px-6 py-4 flex items-center gap-4">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${meta.cls}`}>
                <Radio className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="font-medium text-foreground">{s.id}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.kind === "TX" ? "Transmitter" : "Receiver"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {roomName(s.roomId)} · {s.packetRate} pkt/s · RSSI {s.rssi} dBm
                </p>
                {s.status === "degraded" && (
                  <p className="text-xs text-accent-foreground mt-1">
                    Low packet rate — fall detection confidence may be reduced.
                  </p>
                )}
                {s.status === "offline" && (
                  <p className="text-xs text-destructive mt-1">
                    Device offline — coverage in this area is reduced.
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                  <meta.Icon className="h-3 w-3" />
                  {meta.label}
                </span>
                <p className="text-[11px] text-muted-foreground mt-1">Seen {s.lastSeen}</p>
                <p className="text-[11px] text-muted-foreground">
                  Calib: {s.calibration === "ok" ? "OK" : "Re-check"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
