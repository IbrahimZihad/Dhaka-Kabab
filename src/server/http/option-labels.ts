/**
 * Reading the option choices off an order line.
 *
 * Order lines store each chosen add-on as `{ groupName, optionName, priceDeltaPoisa }`
 * (see the snapshot builder in order.service.ts) — a name snapshot taken at the
 * moment of ordering, so a later menu edit cannot rewrite history. Every screen
 * that shows a line has to read `optionName`; reading `name` instead yields an
 * empty string and the add-on silently disappears from the ticket, which is how a
 * paid-for "extra naan" never reaches the cook.
 */
export function optionLabels(snapshot: unknown, withGroup = false): string[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const record = entry as Record<string, unknown>;
      const option = typeof record.optionName === "string" ? record.optionName : "";
      if (!withGroup) return option;
      const group = typeof record.groupName === "string" ? record.groupName : "";
      return group && option ? `${group}: ${option}` : option;
    })
    .filter(Boolean);
}
