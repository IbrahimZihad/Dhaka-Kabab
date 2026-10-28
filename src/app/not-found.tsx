import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell max-w-xl py-20 text-center">
      <p className="badge badge-brand">404</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">There is no page here</h1>
      <p className="mt-2 text-sm soft">
        If you followed a link from a receipt, an order confirmation or a table code, the link may have expired — those
        are deliberately not permanent. Everything else is one of these doors.
      </p>
      <nav className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/menu" className="btn btn-primary">
          Menu
        </Link>
        <Link href="/order" className="btn btn-outline">
          Order at a table
        </Link>
        <Link href="/track" className="btn btn-outline">
          Track an order
        </Link>
        <Link href="/reservations" className="btn btn-outline">
          Book a table
        </Link>
        <Link href="/contact" className="btn btn-ghost">
          Contact
        </Link>
      </nav>
    </div>
  );
}
