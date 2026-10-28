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

/** The two lines printed on every bill, kept as a section of their own. */

type ReceiptDraft = {
  receiptHeader: string;
  receiptFooter: string;
};

function fromRow(row: SettingsRow): ReceiptDraft {
  return { receiptHeader: row.receiptHeader, receiptFooter: row.receiptFooter };
}

export function SettingsReceiptForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, fromRow);

  const problems: string[] = [];
  if (draft.receiptHeader.trim().length > 120) problems.push("The receipt heading is limited to 120 characters.");
  if (draft.receiptFooter.trim().length > 300) problems.push("The receipt footer is limited to 300 characters.");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length > 0) return;
    const overrides: Partial<SettingsWire> = {
      receiptHeader: draft.receiptHeader.trim(),
      receiptFooter: draft.receiptFooter.trim(),
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice("Saved. Bills printed from now on carry these lines; receipts already printed are unchanged.");
  }

  return (
    <Panel title="Receipt wording" description="The heading and footer printed on every new bill.">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="set-receipt-header"
            label="Heading"
            value={draft.receiptHeader}
            maxLength={120}
            onChange={(value) => update({ receiptHeader: value })}
          />
          <TextField
            id="set-receipt-footer"
            label="Footer"
            value={draft.receiptFooter}
            maxLength={300}
            onChange={(value) => update({ receiptFooter: value })}
          />
        </div>
        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save receipt wording"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}
