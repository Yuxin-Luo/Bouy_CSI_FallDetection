import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Smartphone, Radio, Layers, Bell, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/resident/settings")({
  head: () => ({ meta: [{ title: "Safety settings — Hearth" }] }),
  component: SettingsPage,
});

type Mode = "home" | "phone" | "both";

function SettingsPage() {
  const [mode, setMode] = useState<Mode>("home");
  const [notify, setNotify] = useState(true);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-primary/70 font-medium">Safety</p>
        <h1 className="font-serif text-4xl mt-1">How you're protected</h1>
        <p className="text-muted-foreground mt-2">
          Choose what watches over you. Home sensors work everywhere in the apartment without a wearable. Phone fall detection works only when your phone is with you.
        </p>
      </header>

      <div className="rounded-2xl bg-card border border-border/60 p-5 shadow-[var(--shadow-soft)]">
        <h2 className="font-serif text-2xl">Fall detection</h2>
        <div className="mt-4 space-y-2">
          <ModeOption
            Icon={Radio}
            title="Use home sensors only"
            description="The mesh of receivers in Open Living watches for falls. Recommended."
            selected={mode === "home"}
            onSelect={() => setMode("home")}
          />
          <ModeOption
            Icon={Smartphone}
            title="Use phone fall detection only"
            description="Your phone watches for sudden drops while you carry it."
            selected={mode === "phone"}
            onSelect={() => setMode("phone")}
          />
          <ModeOption
            Icon={Layers}
            title="Use both"
            description="An extra safety layer when you have your phone with you."
            selected={mode === "both"}
            onSelect={() => setMode("both")}
          />
        </div>
      </div>

      <Toggle
        Icon={Bell}
        title="Notify caregivers when phone detects a fall"
        description="Sarah and James will get a push notification."
        value={notify}
        onChange={setNotify}
      />

      <button className="w-full rounded-2xl bg-primary text-primary-foreground py-4 font-medium flex items-center justify-center gap-2 hover:opacity-90 transition shadow-[var(--shadow-soft)]">
        <PlayCircle className="h-5 w-5" /> Test the alert flow
      </button>

      <p className="text-xs text-muted-foreground text-center">
        A test won't call anyone — it just shows you what would happen.
      </p>
    </div>
  );
}

function ModeOption({
  Icon, title, description, selected, onSelect,
}: {
  Icon: typeof Radio; title: string; description: string; selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-3 rounded-xl p-4 border transition ${
        selected
          ? "border-primary bg-primary-soft"
          : "border-border hover:bg-secondary/60"
      }`}
    >
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
        selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <span
        className={`mt-1 h-5 w-5 rounded-full border-2 ${
          selected ? "border-primary bg-primary" : "border-border"
        }`}
      />
    </button>
  );
}

function Toggle({
  Icon, title, description, value, onChange,
}: {
  Icon: typeof Bell; title: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-5 flex items-center gap-4 shadow-[var(--shadow-soft)]">
      <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-7 w-12 rounded-full transition ${value ? "bg-primary" : "bg-border"}`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow transition-transform ${
            value ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
