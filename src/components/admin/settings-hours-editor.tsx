"use client";

import { useSyncExternalStore } from "react";
import type { OpeningHourRule } from "@/lib/time";
import { describeOpeningHours, isOpenAt } from "@/lib/time";
import { EmptyState, Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import {
  currentPayload,
  parseRow,
  useTrackedDraft,
  type SaveResponse,
  type SectionProps,
  type SettingsRow,
  type SettingsWire,
} from "@/components/admin/settings-form";

/**
 * Opening hours as they are actually stored: a list of rules, each one
 * `{ days: number[], opens: "HH:MM", closes: "HH:MM" }` with 0 = Sunday. An empty
 * list means "not recorded" — the website then says so to guests instead of
 * inventing a time, and the booking grid has no slot to offer.
 *
 * The guest site renders these with `describeOpeningHours` and answers
 * open-or-closed with `isOpenAt`, so the same functions drive the live preview
 * here: the sentence shown while you edit is the sentence the next guest reads
 * once this section is saved.
 */

export const MAX_OPENING_RULES = 14;

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(value: string): number | null {
  if (!TIME_PATTERN.test(value)) return null;
  const parts = value.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** Shapes the server's bounds reject outright (day indices, HH:MM, one day minimum). */
function ruleHardProblem(rule: OpeningHourRule): string | null {
  if (rule.days.length === 0) return "Choose at least one day for this range.";
  if (rule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return "Day numbers must run from 0 (Sunday) to 6 (Saturday).";
  }
  if (minutesOf(rule.opens) === null) return `“${rule.opens}” is not a 24-hour time. Use HH:MM, for example 19:30.`;
  if (minutesOf(rule.closes) === null) return `“${rule.closes}” is not a 24-hour time. Use HH:MM, for example 23:00.`;
  return null;
}

export function openingHoursProblems(rules: OpeningHourRule[]): string[] {
  if (rules.length > MAX_OPENING_RULES) return [`At most ${MAX_OPENING_RULES} opening ranges can be stored.`];
  return rules
    .map((rule, index) => {
      const problem = ruleHardProblem(rule);
      return problem ? `Range ${index + 1}: ${problem}` : null;
    })
    .filter((message): message is string => message !== null);
}

/**
 * Warnings the server accepts but a kitchen should think twice about: a range
 * closing at or before it opens, and two ranges sharing part of a day. An
 * overnight range is legal (`isOpenAt` treats a close earlier than the open as
 * running past midnight) but leaves the booking grid no bookable slot on that day,
 * because the last seating is computed as close minus the table hold.
 */
export function openingHoursWarnings(rules: OpeningHourRule[]): string[] {
  const warnings: string[] = [];
  const usable = rules.filter((rule) => ruleHardProblem(rule) === null);

  usable.forEach((rule, index) => {
    const opens = minutesOf(rule.opens);
    const closes = minutesOf(rule.closes);
    if (opens === null || closes === null) return;
    if (closes === opens) {
      warnings.push(`Range ${index + 1} closes at the same minute it opens, so it serves nobody.`);
    } else if (closes < opens) {
      warnings.push(
        `Range ${index + 1} (${rule.opens}–${rule.closes}) runs past midnight. That is allowed and the open-or-closed badge understands it, but no booking slot can be offered from it — record two ranges instead, one up to midnight and one from midnight.`,
      );
    }
  });

  for (let a = 0; a < usable.length; a += 1) {
    for (let b = a + 1; b < usable.length; b += 1) {
      const shared = usable[a]!.days.filter((day) => usable[b]!.days.includes(day));
      if (shared.length === 0) continue;
      if (intervalsOverlap(usable[a]!, usable[b]!)) {
        warnings.push(
          `Ranges ${a + 1} and ${b + 1} cover the same hours on ${shared
            .map((day) => DAY_LABELS[day])
            .join(", ")}. The guest sees both; the kitchen sees one table with two closing times.`,
        );
      }
    }
  }
  return warnings;
}

function intervalsOverlap(first: OpeningHourRule, second: OpeningHourRule): boolean {
  const ranges: [number, number][] = [];
  for (const rule of [first, second]) {
    const opens = minutesOf(rule.opens);
    const closes = minutesOf(rule.closes);
    if (opens === null || closes === null) return false;
    if (closes > opens) {
      ranges.push([opens, closes]);
    } else if (closes < opens) {
      ranges.push([opens, 1440]);
      ranges.push([0, closes]);
    }
  }
  return ranges.some(([leftStart, leftEnd]) =>
    ranges.some(([rightStart, rightEnd]) => leftStart < rightEnd && rightStart < leftEnd),
  );
}

function sortDays(days: number[]): number[] {
  return [...days].sort((a, b) => a - b);
}

export function SettingsHoursEditor({
  rules,
  suggestedDay,
  onRulesChange,
}: {
  rules: OpeningHourRule[];
  /** The restaurant's own weekday, so a new range starts on the day it is. */
  suggestedDay: number;
  onRulesChange: (rules: OpeningHourRule[]) => void;
}) {
  function updateRule(index: number, patch: Partial<OpeningHourRule>) {
    onRulesChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  function toggleDay(index: number, day: number) {
    const rule = rules[index];
    if (!rule) return;
    const days = rule.days.includes(day) ? rule.days.filter((value) => value !== day) : sortDays([...rule.days, day]);
    updateRule(index, { days });
  }

  function addRule() {
    if (rules.length >= MAX_OPENING_RULES) return;
    onRulesChange([...rules, { days: [suggestedDay], opens: "11:00", closes: "23:00" }]);
  }

  function removeRule(index: number) {
    onRulesChange(rules.filter((_, position) => position !== index));
  }

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <EmptyState title="No opening ranges are recorded">
          Until one is added, the website tells guests that opening hours have not been configured and the booking form
          has no slot to offer.
        </EmptyState>
      ) : null}

      {rules.map((rule, index) => {
        const problem = ruleHardProblem(rule);
        return (
          <div key={index} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="label mb-0">Range {index + 1}</p>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => removeRule(index)}>
                Remove this range
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {SHORT_DAY_LABELS.map((label, day) => (
                <label
                  key={label}
                  className={`badge cursor-pointer select-none ${rule.days.includes(day) ? "badge-open" : ""}`}
                  title={DAY_LABELS[day]}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={rule.days.includes(day)}
                    onChange={() => toggleDay(index, day)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`hours-open-${index}`}>
                  Opens (24-hour clock)
                </label>
                <input
                  id={`hours-open-${index}`}
                  className="input"
                  type="time"
                  value={rule.opens}
                  onChange={(event) => updateRule(index, { opens: event.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`hours-close-${index}`}>
                  Closes (24-hour clock)
                </label>
                <input
                  id={`hours-close-${index}`}
                  className="input"
                  type="time"
                  value={rule.closes}
                  onChange={(event) => updateRule(index, { closes: event.target.value })}
                />
              </div>
            </div>

            {problem ? <p className="notice notice-error mt-3">{problem}</p> : null}
          </div>
        );
      })}

      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={addRule}
        disabled={rules.length >= MAX_OPENING_RULES}
      >
        Add an opening range
      </button>
      <p className="hint mt-1">
        Every range is stored exactly as shown and is what the website, the booking grid and the assistant all read
        from. Two ranges on the same day are allowed, for a split lunch and dinner service.
      </p>
    </div>
  );
}

function fromRow(row: SettingsRow): OpeningHourRule[] {
  return row.openingHours.map((rule) => ({ days: sortDays(rule.days), opens: rule.opens, closes: rule.closes }));
}

/**
 * The whole panel: the rule list, a live preview of the sentence guests will
 * read, and a Save that PATCHes the complete row with only openingHours changed.
 */
export function SettingsHoursForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft: rules, setValue, reset, markSaved } = useTrackedDraft(row, fromRow);
  const problems = openingHoursProblems(rules);
  const warnings = problems.length === 0 ? openingHoursWarnings(rules) : [];

  // The open-now preview reads the wall clock, so it is only computed on the
  // client once mounted — server render and hydration must agree.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const now = mounted ? new Date() : null;
  const usable = rules.filter((rule) => ruleHardProblem(rule) === null);
  const previewOpen = now !== null && usable.length > 0 ? isOpenAt(now, usable, row.timezone) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length > 0) return;
    const overrides: Partial<SettingsWire> = {
      openingHours: rules.map((rule) => ({ days: sortDays(rule.days), opens: rule.opens, closes: rule.closes })),
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice(
      next.openingHours.length === 0
        ? "Saved. No ranges remain, so the website now tells guests that opening hours are not recorded and bookings stop until one is added."
        : `Saved. Guests now see: ${describeOpeningHours(next.openingHours)}.`,
    );
  }

  return (
    <Panel
      title="Opening hours"
      description={`Ranges, not one fixed schedule. The saved hours are what the badge at the top of this page is computed from right now.`}
    >
      <form onSubmit={submit}>
        <SettingsHoursEditor
          rules={rules}
          suggestedDay={now ? weekdayIndexInZone(now, row.timezone) : 1}
          onRulesChange={(next) => setValue(next)}
        />

        {problems.length === 0 ? (
          <div className="mt-4 rounded-lg border border-line p-3">
            <p className="label">Live preview — exactly what the guest site will say</p>
            <p className="soft text-sm">{describeOpeningHours(rules)}</p>
            {previewOpen !== null ? (
              <p className="hint mt-2">
                With these rules, at this moment in {row.timezone} the restaurant would read as{" "}
                <strong>{previewOpen ? "Open" : "Closed"}</strong> to a guest.
              </p>
            ) : null}
            {warnings.map((warning) => (
              <p key={warning} className="notice mt-2">
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        <p className="hint mt-3">
          The advertised hours, the open-or-closed badge and every bookable slot change with a save here; nothing moves
          until the server accepts it.
        </p>
        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save opening hours"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}

function subscribeNoop() {
  return () => {};
}

/** The restaurant's own weekday (0 = Sunday) for pre-filling a new range. */
function weekdayIndexInZone(instant: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(instant);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}
