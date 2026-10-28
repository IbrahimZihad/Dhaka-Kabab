import { Suspense } from "react";
import type { Metadata } from "next";
import { StaffShell } from "@/components/admin/staff-shell";

export const metadata: Metadata = {
  title: { default: "Kitchen screen", template: "%s · Kitchen screen" },
  robots: { index: false, follow: false },
};

function ShellFallback() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="shell space-y-4 py-8">
        <span className="skeleton block h-9 w-64" />
        <span className="skeleton block h-96" />
      </div>
    </div>
  );
}

/**
 * Same guard as the panel — only a role with kitchen:view reaches it — but the
 * page inside is built for a screen on a wall: large type, no money, no names.
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
