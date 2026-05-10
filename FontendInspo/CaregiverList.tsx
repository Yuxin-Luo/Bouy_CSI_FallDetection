import { rooms, sensors, type SensorStatus } from "@/lib/home-data";

const statusColor: Record<SensorStatus, string> = {
  online: "var(--success)",
  degraded: "var(--warning)",
  offline: "var(--destructive)",
};

interface HomeMapProps {
  highlightSensorId?: string;
  activeRoomId?: string;
}

export function HomeMap({ highlightSensorId, activeRoomId }: HomeMapProps) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-[var(--shadow-soft)] p-4 sm:p-6">
      <svg
        viewBox="0 0 600 200"
        className="w-full h-auto"
        role="img"
        aria-label="Top-down map of the home"
      >
        {/* Rooms */}
        {rooms.map((r) => {
          const isActive = activeRoomId === r.id;
          const isLiving = r.type === "living";
          const isHall = r.type === "hallway";
          const fill = isLiving
            ? "var(--primary-soft)"
            : isHall
              ? "var(--secondary)"
              : "var(--card)";
          return (
            <g key={r.id}>
              <rect
                x={r.x}
                y={r.y}
                width={r.width}
                height={r.height}
                rx={isHall ? 6 : 8}
                fill={fill}
                stroke={isActive ? "var(--primary)" : "var(--border)"}
                strokeWidth={isActive ? 2 : 1.2}
              />
              <text
                x={r.x + r.width / 2}
                y={isHall ? r.y + r.height / 2 + 4 : r.y + r.height - 10}
                textAnchor="middle"
                fontSize={isHall ? 10 : 11}
                fill="var(--muted-foreground)"
                fontFamily="Inter, sans-serif"
                fontWeight={500}
              >
                {r.name}
              </text>
            </g>
          );
        })}

        {/* Sensors */}
        {sensors.map((s) => {
          const highlighted = highlightSensorId === s.id;
          return (
            <g key={s.id}>
              {highlighted && (
                <circle cx={s.x} cy={s.y} r={12} fill={statusColor[s.status]} opacity={0.18}>
                  <animate attributeName="r" values="8;16;8" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={s.x}
                cy={s.y}
                r={5}
                fill={statusColor[s.status]}
                stroke="var(--card)"
                strokeWidth={2}
              />
              <text
                x={s.x + 8}
                y={s.y + 3}
                fontSize={9}
                fill="var(--foreground)"
                fontFamily="Inter, sans-serif"
                fontWeight={600}
              >
                {s.id}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} /> Online</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--warning)" }} /> Degraded</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--destructive)" }} /> Offline</span>
        <span className="ml-auto">Sensors are installed in the Open Living area.</span>
      </div>
    </div>
  );
}
