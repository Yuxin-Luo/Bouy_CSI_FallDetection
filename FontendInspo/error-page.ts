import { useState } from "react";
import { notifications as initial, rooms, type EventType, type ReviewStatus, type NotificationEvent } from "@/lib/home-data";
import { AlertTriangle, AlertOctagon, CheckCircle2, Eye, Info, Radio, MoonStar, UserRound } from "lucide-react";

const typeMeta: Record<EventType, { label: string; Icon: typeof Info; cls: string }> = {
  possible_fall:  { label: "Possible fall",  Icon: AlertTriangle, cls: "bg-accent text-accent-foreground" },
  confirmed_fall: { label: "Confirmed fall", Icon: AlertOctagon,  cls: "bg-destructive/10 text-destructive" },
  false_alarm:    { label: "False alarm",    Icon: CheckCircle2,  cls: "bg-primary-soft text-primary" },
  presence:       { label: "Presence",       Icon: UserRound,     cls: "bg-secondary text-foreground" },
  no_motion:      { label: "No motion",      Icon: MoonStar,      cls: "bg-secondary text-foreground" },
  sensor_offline: { label: "Sensor alert",   Icon: Radio,         cls: "bg-accent text-accent-foreground" },
};

const reviewLabel: Record<ReviewStatus, string> = {
  needs_review: "Needs review",
  real_fall: "Real fall",
  false_alarm: "False alarm",
  informational: "Informational",
};

export function NotificationsList({ limit, reviewable = true }: { limit?: number; reviewable?: boolean }) {
  const [events, setEvents] = useState<NotificationEvent[]>(initial);
  const list = limit ? events.slice(0, limit) : events;
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "—";

  const setStatus = (id: string, status: ReviewStatus) =>
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));

  return (
    <ul className="space-y-3">
      {list.map((e) => {
        const meta = typeMeta[e.type];
        const showReview =
          reviewable && (e.type === "possible_fall" || e.type === "confirmed_fall");
        return (
          <li
            key={e.id}
            className="rounded-2xl bg-card border border-border/60 p-5 shadow-[var(--shadow-soft)]"
          >
            <div className="flex items-start gap-4">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${meta.cls}`}>
                <meta.Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="font-medium text-foreground">{meta.label}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {e.date} · {e.time}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{e.detail}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  <span>Room: {roomName(e.roomId)}</span>
                  {e.sensorId && <span>Sensor: {e.sensorId}</span>}
                  {e.confidence !== undefined && (
                    <span>Confidence: {Math.round(e.confidence * 100)}%</span>
                  )}
                  <span>Status: {reviewLabel[e.status]}</span>
                </div>

                {showReview && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => setStatus(e.id, "real_fall")}
                      className={`text-xs rounded-full px-3 py-1.5 border transition ${
                        e.status === "real_fall"
                          ? "bg-destructive text-destructive-foreground border-destructive"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      Real fall
                    </button>
                    <button
                      onClick={() => setStatus(e.id, "false_alarm")}
                      className={`text-xs rounded-full px-3 py-1.5 border transition ${
                        e.status === "false_alarm"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      False alarm
                    </button>
                    <button
                      onClick={() => setStatus(e.id, "needs_review")}
                      className={`text-xs rounded-full px-3 py-1.5 border transition flex items-center gap-1 ${
                        e.status === "needs_review"
                          ? "bg-accent text-accent-foreground border-accent"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      <Eye className="h-3 w-3" /> Needs review
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
