import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, isStaffRole } from "@/lib/auth/session";
import { LoginForm } from "@/components/site/auth-forms";

async function LoginBody() {
  const user = await getCurrentUser();
  if (user) redirect(isStaffRole(user.role) ? "/admin" : "/account");

  return (
    <div className="shell max-w-md py-12">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm soft">
        Customers keep their orders and bookings here. Staff use the same door to reach the admin panel.
      </p>
      <div className="mt-6">
        <LoginForm staffHint="Staff: after signing in you will be taken to the admin panel." />
      </div>
      <p className="hint mt-6">
        Just scanning a table code? You do not need an account for that —{" "}
        <Link href="/order" className="underline">
          open your table
        </Link>
        .
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-md py-12">
          <span className="skeleton block h-9 w-32" />
          <span className="skeleton mt-6 block h-56" />
        </div>
      }
    >
      <LoginBody />
    </Suspense>
  );
}
