import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, isStaffRole } from "@/lib/auth/session";
import { RegisterForm } from "@/components/site/auth-forms";

async function RegisterBody() {
  const user = await getCurrentUser();
  if (user) redirect(isStaffRole(user.role) ? "/admin" : "/account");

  return (
    <div className="shell max-w-md py-12">
      <h1 className="text-3xl font-bold tracking-tight">Create an account</h1>
      <p className="mt-1 text-sm soft">
        Optional for everything on this site. It saves your details for takeaway and keeps your orders and bookings
        together.
      </p>
      <div className="mt-6">
        <RegisterForm />
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-md py-12">
          <span className="skeleton block h-9 w-48" />
          <span className="skeleton mt-6 block h-72" />
        </div>
      }
    >
      <RegisterBody />
    </Suspense>
  );
}
