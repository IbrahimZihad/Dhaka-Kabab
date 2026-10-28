import { Suspense } from "react";
import { orUnset, siteContext } from "@/server/http/site";
import { ContactForm } from "@/components/site/contact-form";

async function ContactBody() {
  const site = await siteContext();
  const { info } = site;
  const address = [info.addressLine1, info.addressLine2, info.city].filter(Boolean).join(", ");

  return (
    <div className="shell max-w-4xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
      <p className="mt-1 text-sm soft">
        The details below are the ones the restaurant has recorded. Where something is missing we say so rather than
        guess — a wrong address or number is worse than an empty line.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <dl className="space-y-5 text-sm">
          <div>
            <dt className="label">Telephone</dt>
            <dd className="mt-1">
              {info.phonePrimary ? (
                <a href={`tel:${info.phonePrimary}`} className="font-semibold hover:text-brand">
                  {info.phonePrimary}
                </a>
              ) : (
                <span className="soft">No number recorded yet — ask at the counter or use the form.</span>
              )}
              {info.phoneSecondary ? <span className="hint block">Second line: {info.phoneSecondary}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="label">Email</dt>
            <dd className="mt-1">
              {info.emailPublic ? (
                <a href={`mailto:${info.emailPublic}`} className="hover:text-brand">
                  {info.emailPublic}
                </a>
              ) : (
                <span className="soft">Not recorded.</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="label">Address</dt>
            <dd className="mt-1 soft">
              {orUnset(address, "Not recorded yet")}
              {info.mapsUrl ? (
                <>
                  {" "}
                  <a href={info.mapsUrl} className="underline" rel="noreferrer" target="_blank">
                    Directions
                  </a>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="label">Hours</dt>
            <dd className="mt-1 soft">{site.hours}</dd>
            <dd className="hint">
              Local time is {site.clock} in {site.timeZone} — we are {site.open ? "open" : "closed"} right now.
            </dd>
          </div>
          {info.contactNote ? (
            <div>
              <dt className="label">A note from the restaurant</dt>
              <dd className="mt-1 soft">{info.contactNote}</dd>
            </div>
          ) : null}
          <div>
            <dt className="label">Elsewhere</dt>
            <dd className="mt-1 flex flex-wrap gap-3 text-sm">
              {info.facebookUrl ? (
                <a href={info.facebookUrl} className="hover:text-brand" rel="noreferrer" target="_blank">
                  Facebook
                </a>
              ) : null}
              {info.instagramUrl ? (
                <a href={info.instagramUrl} className="hover:text-brand" rel="noreferrer" target="_blank">
                  Instagram
                </a>
              ) : null}
              {!info.facebookUrl && !info.instagramUrl ? <span className="soft">No accounts recorded.</span> : null}
            </dd>
          </div>
        </dl>

        <div>
          <h2 className="text-lg font-bold">Write to us</h2>
          <p className="mt-1 text-sm soft">
            This reaches the same inbox as the site assistant, and a manager sees it flagged as needing a person.
          </p>
          <div className="mt-4">
            <ContactForm restaurantName={info.name} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ContactPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-4xl py-10">
          <span className="skeleton block h-9 w-40" />
          <span className="skeleton mt-6 block h-64" />
        </div>
      }
    >
      <ContactBody />
    </Suspense>
  );
}
