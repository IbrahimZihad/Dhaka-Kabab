import Link from "next/link";
import { Suspense } from "react";
import { ResetCompleteForm, ResetStartForm } from "@/components/site/auth-forms";

async function ResetBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <div className="shell max-w-md py-12">
      <h1 className="text-3xl font-bold tracking-tight">{token ? "Choose a new password" : "Reset your password"}</h1>
      <p className="mt-1 text-sm soft">
        {token
          ? "This link is single-use and expires on its own. Changing the password signs every other device out."
          : "We send a link to the address on the account. We do not tell anyone whether an address is registered — that is how a login page gives away accounts."}
      </p>
      <div className="mt-6">{token ? <ResetCompleteForm token={token} /> : <ResetStartForm />}</div>
      <p className="hint mt-6">
        Remembered it?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}

export default function ResetPasswordPage(props: PageProps<"/reset-password">) {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-md py-12">
          <span className="skeleton block h-9 w-56" />
          <span className="skeleton mt-6 block h-40" />
        </div>
      }
    >
      <ResetBody searchParams={props.searchParams} />
    </Suspense>
  );
}
