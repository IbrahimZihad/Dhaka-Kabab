"use client";

import { Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import {
  TextField,
  currentPayload,
  parseRow,
  useTrackedDraft,
  type SaveResponse,
  type SectionProps,
  type SettingsRow,
  type SettingsWire,
} from "@/components/admin/settings-form";

/**
 * Identity and contact. The guest footer and the page titles and metadata are
 * built from these fields, so a change here is a change to what every visitor
 * reads — including what a booking confirmation quotes as the restaurant's own
 * address and phone. (The sitemap lists pages only; it carries none of these
 * values.)
 */

type IdentityDraft = {
  name: string;
  logoUrl: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  country: string;
  phonePrimary: string;
  phoneSecondary: string;
  emailPublic: string;
  mapsUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  contactNote: string;
  timezone: string;
  currencyCode: string;
  currencySymbol: string;
};

function fromRow(row: SettingsRow): IdentityDraft {
  return {
    name: row.name,
    logoUrl: row.logoUrl ?? "",
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? "",
    city: row.city,
    country: row.country,
    phonePrimary: row.phonePrimary,
    phoneSecondary: row.phoneSecondary ?? "",
    emailPublic: row.emailPublic,
    mapsUrl: row.mapsUrl ?? "",
    facebookUrl: row.facebookUrl ?? "",
    instagramUrl: row.instagramUrl ?? "",
    contactNote: row.contactNote ?? "",
    timezone: row.timezone,
    currencyCode: row.currencyCode,
    currencySymbol: row.currencySymbol,
  };
}

// Mirrors the server's bdPhone validator (src/server/validation/common.ts).
const BD_PHONE = /^(\+?880|880|0)?1[3-9]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isUsableUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Courtesy checks mirroring the server's bounds; the server is still the authority. */
export function identityProblems(draft: IdentityDraft): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 80) problems.push("The restaurant name needs between 2 and 80 characters.");
  if (draft.logoUrl.trim() !== "" && draft.logoUrl.trim().length > 500) problems.push("The logo address is limited to 500 characters.");
  if (draft.logoUrl.trim() !== "" && !isUsableUrl(draft.logoUrl.trim())) problems.push("The logo address must be a full http(s) address.");
  const addressLine1 = draft.addressLine1.trim();
  if (addressLine1.length < 3 || addressLine1.length > 200) problems.push("Enter the street address (3 to 200 characters).");
  if (draft.addressLine2.trim().length > 200) problems.push("The second address line is too long (200 characters at most).");
  const city = draft.city.trim();
  if (city.length < 2 || city.length > 80) problems.push("Enter the city (2 to 80 characters).");
  const country = draft.country.trim();
  if (country.length < 2 || country.length > 80) problems.push("Enter the country (2 to 80 characters).");

  const phonePrimary = draft.phonePrimary.trim().replace(/[\s()-]/g, "");
  if (!BD_PHONE.test(phonePrimary)) problems.push("The main phone number must be a Bangladeshi mobile number, e.g. 01712345678.");
  const phoneSecondary = draft.phoneSecondary.trim().replace(/[\s()-]/g, "");
  if (phoneSecondary !== "" && !BD_PHONE.test(phoneSecondary)) problems.push("The second phone number is not a valid Bangladeshi mobile number.");

  const emailPublic = draft.emailPublic.trim();
  if (emailPublic !== "" && !EMAIL.test(emailPublic)) problems.push("The public email address is not valid.");

  for (const [label, value] of [
    ["Google Maps link", draft.mapsUrl],
    ["Facebook page", draft.facebookUrl],
    ["Instagram page", draft.instagramUrl],
  ] as const) {
    if (value.trim() !== "" && !isUsableUrl(value.trim())) problems.push(`The ${label.toLowerCase()} must be a full http(s) address.`);
  }
  if (draft.contactNote.trim().length > 400) problems.push("The note for the About page is limited to 400 characters.");

  const timezone = draft.timezone.trim();
  if (timezone.length < 3 || timezone.length > 60 || !isValidTimezone(timezone)) {
    problems.push("The timezone must be an IANA name the server recognises, such as Asia/Dhaka.");
  }
  if (draft.currencyCode.trim().length !== 3) problems.push("The currency code is three letters, e.g. BDT.");
  const symbol = draft.currencySymbol.trim();
  if (symbol.length < 1 || symbol.length > 3) problems.push("The currency symbol is 1 to 3 characters, e.g. ৳.");
  return problems;
}

function overrides(draft: IdentityDraft): Partial<SettingsWire> {
  return {
    name: draft.name.trim(),
    logoUrl: optionalText(draft.logoUrl),
    addressLine1: draft.addressLine1.trim(),
    addressLine2: optionalText(draft.addressLine2),
    city: draft.city.trim(),
    country: draft.country.trim(),
    phonePrimary: draft.phonePrimary.trim(),
    phoneSecondary: optionalText(draft.phoneSecondary),
    // A cleared public email is stored as an empty string, never as nothing.
    emailPublic: draft.emailPublic.trim(),
    mapsUrl: optionalText(draft.mapsUrl),
    facebookUrl: optionalText(draft.facebookUrl),
    instagramUrl: optionalText(draft.instagramUrl),
    contactNote: optionalText(draft.contactNote),
    timezone: draft.timezone.trim(),
    currencyCode: draft.currencyCode.trim(),
    currencySymbol: draft.currencySymbol.trim(),
  };
}

export function SettingsIdentityForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, fromRow);
  const problems = identityProblems(draft);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length > 0) return;
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides(draft),
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice(
      `Saved. The website now speaks as ${next.name} at ${next.addressLine1 || "no recorded address"}, telephoning ${
        next.phonePrimary || "no recorded number"
      }. Guests see this on the footer, the About and Contact pages and their booking confirmations from the next request.`,
    );
  }

  return (
    <Panel
      title="Identity and contact"
      description="The words guests see. The footer, the page titles and the metadata are built from these fields; the sitemap lists pages but carries none of these values."
    >
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField id="set-name" label="Restaurant name" value={draft.name} maxLength={80} onChange={(value) => update({ name: value })} hint="Shown in the header, the receipt and the assistant." />
          <TextField id="set-city" label="City" value={draft.city} maxLength={80} onChange={(value) => update({ city: value })} />
          <TextField id="set-country" label="Country" value={draft.country} maxLength={80} onChange={(value) => update({ country: value })} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField id="set-address1" label="Address line 1" value={draft.addressLine1} maxLength={200} onChange={(value) => update({ addressLine1: value })} hint="The street a guest is sent to." />
          <TextField id="set-address2" label="Address line 2" value={draft.addressLine2} maxLength={200} optional onChange={(value) => update({ addressLine2: value })} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField id="set-phone1" label="Main phone" value={draft.phonePrimary} maxLength={20} inputMode="tel" onChange={(value) => update({ phonePrimary: value })} hint="e.g. 01712345678 or +8801712345678." />
          <TextField id="set-phone2" label="Second phone" value={draft.phoneSecondary} maxLength={20} inputMode="tel" optional onChange={(value) => update({ phoneSecondary: value })} />
          <TextField id="set-email" label="Public email" value={draft.emailPublic} maxLength={200} inputMode="email" optional onChange={(value) => update({ emailPublic: value })} hint="Where guests write. Nothing arrives at this address unless the mail section below says sending works." />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField id="set-logo" label="Logo address" value={draft.logoUrl} maxLength={500} inputMode="url" optional onChange={(value) => update({ logoUrl: value })} hint="An http(s) image used in the header." />
          <TextField id="set-maps" label="Google Maps link" value={draft.mapsUrl} maxLength={500} inputMode="url" optional onChange={(value) => update({ mapsUrl: value })} />
          <TextField id="set-facebook" label="Facebook page" value={draft.facebookUrl} maxLength={500} inputMode="url" optional onChange={(value) => update({ facebookUrl: value })} />
          <TextField id="set-instagram" label="Instagram page" value={draft.instagramUrl} maxLength={500} inputMode="url" optional onChange={(value) => update({ instagramUrl: value })} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TextField id="set-timezone" label="Timezone (IANA name)" value={draft.timezone} maxLength={60} onChange={(value) => update({ timezone: value })} hint="Open hours, bookings and the till day are all counted in this zone." />
          <TextField id="set-currency-code" label="Currency code" value={draft.currencyCode} maxLength={3} onChange={(value) => update({ currencyCode: value })} hint="Three letters, e.g. BDT." />
          <TextField id="set-currency-symbol" label="Currency symbol" value={draft.currencySymbol} maxLength={3} onChange={(value) => update({ currencySymbol: value })} hint="Appears before every price, e.g. ৳." />
        </div>
        <div className="mt-3">
          <label className="label" htmlFor="set-contact-note">
            Note on the public About page
          </label>
          <textarea
            id="set-contact-note"
            className="textarea"
            maxLength={400}
            value={draft.contactNote}
            onChange={(event) => update({ contactNote: event.target.value })}
            placeholder="e.g. Home delivery runs inside Banani, Gulshan and Mohakhali only."
          />
        </div>
        <p className="hint mt-3">
          Anything left blank is shown to guests as not recorded. The website never fills in an address, a phone number
          or an email of its own, because an invented one sends people to the wrong door.
        </p>
        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save identity and contact"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}
