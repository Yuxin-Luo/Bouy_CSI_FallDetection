import { caregivers, escalation, type Priority } from "@/lib/home-data";
import { Phone, Mail, MessageCircle, BellRing, ShieldAlert, GripVertical } from "lucide-react";

const priorityMeta: Record<Priority, { label: string; cls: string }> = {
  primary:   { label: "Primary",   cls: "bg-primary text-primary-foreground" },
  backup:    { label: "Backup",    cls: "bg-primary-soft text-primary" },
  emergency: { label: "Emergency", cls: "bg-destructive/10 text-destructive" },
};

export function CaregiverList({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {caregivers.map((c) => {
          const p = priorityMeta[c.priority];
          return (
            <li
              key={c.id}
              className="rounded-2xl bg-card border border-border/60 p-5 shadow-[var(--shadow-soft)]"
            >
              <div className="flex items-start gap-4">
                {!readOnly && (
                  <button className="text-muted-foreground hover:text-foreground mt-1" aria-label="Reorder">
                    <GripVertical className="h-4 w-4" />
                  </button>
                )}
                <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium shrink-0">
                  {c.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.role}</p>
                    </div>
                    <span className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full font-medium ${p.cls}`}>
                      {p.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {c.phone}</span>
                    <span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {c.email}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Pill on={c.push}  Icon={BellRing}      label="Push" />
                    <Pill on={c.sms}   Icon={MessageCircle} label="SMS" />
                    <Pill on={c.emergencyCall} Icon={ShieldAlert}   label="Emergency call" />
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2 mt-4">
                      <button className="text-xs rounded-full px-3 py-1.5 border border-border hover:bg-secondary">Edit</button>
                      <button className="text-xs rounded-full px-3 py-1.5 border border-border hover:bg-secondary">Test alert</button>
                      <button className="text-xs rounded-full px-3 py-1.5 text-destructive hover:bg-destructive/10">Remove</button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl bg-card border border-border/60 p-6 shadow-[var(--shadow-soft)]">
        <h3 className="font-serif text-2xl text-foreground">Escalation rules</h3>
        <p className="text-sm text-muted-foreground mt-1">
          What happens when a possible fall is detected and nobody responds.
        </p>
        <ol className="mt-4 space-y-2">
          {escalation.map((step, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="font-serif text-2xl text-primary w-12 tabular-nums">{step.delay}</span>
              <span className="text-foreground">{step.action}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Pill({ on, Icon, label }: { on: boolean; Icon: typeof Phone; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        on ? "bg-primary-soft text-primary" : "bg-secondary text-muted-foreground line-through"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
