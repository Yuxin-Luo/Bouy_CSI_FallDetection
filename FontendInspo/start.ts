import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { NotificationsList } from "@/components/NotificationsList";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Hearth" },
      { name: "description", content: "Past events, falls, presence updates, and sensor warnings." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="History"
        title="Past notifications"
        description="A complete log of presence updates, possible falls, and sensor health events. Review possible falls to teach Hearth what's normal for your home."
      />
      <div className="flex gap-2 mb-5 text-sm">
        {["All", "Falls", "Presence", "Sensors", "Needs review"].map((t, i) => (
          <button
            key={t}
            className={`rounded-full px-3 py-1.5 border transition ${
              i === 0 ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <NotificationsList />
    </AppShell>
  );
}
