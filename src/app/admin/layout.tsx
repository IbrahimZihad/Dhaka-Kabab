import { Suspense } from "react";
import type { Metadata } from "next";
import { StaffShell } from "@/components/admin/staff-shell";

/** A staff screen is never a public page, whatever the site-wide settings say. */
export const metadata: Metadata = {
  title: { default: "Staff panel", template: "%s · Staff panel" },
  robots: { index: false, follow: false },
};

function ShellFallback() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="border-b border-line bg-paper-raised">
        <div className="shell space-y-3 py-4">
          <span className="skeleton block h-6 w-40" />
          <span className="skeleton block h-8 w-full" />
        </div>
      </div>
      <div className="shell space-y-4 py-8">
        <span className="skeleton block h-9 w-64" />
        <span className="skeleton block h-48" />
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
