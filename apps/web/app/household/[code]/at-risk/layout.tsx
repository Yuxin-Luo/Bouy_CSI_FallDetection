import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bouy Care",
  manifest: "/manifest-care.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bouy Care",
  },
};

export default function AtRiskLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
