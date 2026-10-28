import Link from "next/link";
import { Suspense } from "react";
import { bpsToPercentLabel } from "@/lib/money";
import { orUnset, siteContext } from "@/server/http/site";

async function FooterInner() {
  const site = await siteContext();
  const { info, money } = site;
  const address = [info.addressLine1, info.addressLine2, info.city, info.country].filter(Boolean).join(", ");
  const charges = [
    money.serviceChargeBps > 0 ? `service charge ${bpsToPercentLabel(money.serviceChargeBps)}%` : null,
    money.vatBps > 0 ? `VAT ${bpsToPercentLabel(money.vatBps)}%` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const channels = [
    info.allowDineIn ? "dine-in with the table QR code" : null,
    info.allowTakeaway ? "takeaway" : null,
    info.allowDelivery ? "delivery" : null,
  ].filter(Boolean);

  return (
    <footer className="mt-16 border-t border-line bg-paper-raised">
      <div className="shell grid gap-8 py-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-base font-bold text-ink">{info.name}</p>
          <p className="mt-2 text-sm soft">
            {address ? address : <span className="muted italic">Our address has not been recorded yet.</span>}
          </p>
          <p className="mt-2 text-sm soft">
            {info.phonePrimary ? (
              <a href={`tel:${info.phonePrimary}`} className="hover:text-brand">
                {info.phonePrimary}
              </a>
            ) : (
              <span className="muted italic">No telephone number recorded yet.</span>
            )}
            {info.emailPublic ? (
              <>
                {" · "}
                <a href={`mailto:${info.emailPublic}`} className="hover:text-brand">
                  {info.emailPublic}
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-2 text-sm muted">
            {site.hours} · {site.open ? "open now" : "closed"} ({orUnset(info.timezone, "Asia/Dhaka")})
          </p>
          {info.mapsUrl ? (
            <a href={info.mapsUrl} target="_blank" rel="noreferrer noopener" className="btn btn-outline btn-sm mt-3">
              Directions
            </a>
          ) : null}
        </div>

        <nav aria-label="Pages" className="text-sm">
          <p className="label">Visit</p>
          <ul className="space-y-2">
            <li>
              <Link href="/menu" className="hover:text-brand">
                Full menu
              </Link>
            </li>
            <li>
              <Link href="/reservations" className="hover:text-brand">
                Book a table
              </Link>
            </li>
            <li>
              <Link href="/track" className="hover:text-brand">
                Track an order
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-brand">
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-brand">
                About us
              </Link>
            </li>
          </ul>
        </nav>

        <div className="text-sm">
          <p className="label">Ordering &amp; bills</p>
          <p className="muted">
            {channels.length > 0 ? `You can order ${channels.join(", ")}.` : "Online ordering is closed right now; please order at the counter."}
          </p>
          <p className="muted mt-2">
            {charges ? `Bills add ${charges}.` : "No service charge or VAT is added to a bill."} Online payments count only once the bank confirms them.
          </p>
          <div className="mt-3 flex gap-3">
            {info.facebookUrl ? (
              <a href={info.facebookUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand">
                Facebook
              </a>
            ) : null}
            {info.instagramUrl ? (
              <a href={info.instagramUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand">
                Instagram
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

export function SiteFooter() {
  return (
    <Suspense fallback={<footer className="mt-16 border-t border-line bg-paper-raised" aria-hidden />}>
      <FooterInner />
    </Suspense>
  );
}
