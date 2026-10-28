import { describe, expect, it } from "vitest";
import { optionLabels } from "@/server/http/option-labels";

/**
 * `src/server/http/option-labels.ts` — reads the add-on names off an order line
 * snapshot `{ groupName, optionName, priceDeltaPoisa }`. The wrong key (`name`)
 * yields nothing rather than throwing, which is how a paid extra silently never
 * reaches the cook, so the junk cases matter as much as the happy path.
 */

type OptionSnapshotEntry = { groupName: string; optionName: string; priceDeltaPoisa: number };

const seekhKabab: OptionSnapshotEntry[] = [
  { groupName: "Spice level", optionName: "Medium", priceDeltaPoisa: 0 },
  { groupName: "Sides", optionName: "Extra naan", priceDeltaPoisa: 5000 },
];

describe("optionLabels", () => {
  it("reads every optionName from a real order-line snapshot", () => {
    expect(optionLabels(seekhKabab)).toEqual(["Medium", "Extra naan"]);
  });

  it("prefixes the group name when asked", () => {
    expect(optionLabels(seekhKabab, true)).toEqual(["Spice level: Medium", "Sides: Extra naan"]);
  });

  it("ignores the price delta entirely", () => {
    const pricey: OptionSnapshotEntry[] = [{ groupName: "Sides", optionName: "Cheese", priceDeltaPoisa: 25000 }];
    expect(optionLabels(pricey)).toEqual(["Cheese"]);
    expect(optionLabels(pricey, true)).toEqual(["Sides: Cheese"]);
  });

  it("keeps the snapshot order and ignores unknown extra keys", () => {
    const withExtras = [
      { groupName: "A", optionName: "One", priceDeltaPoisa: 0, id: "opt-1", isDefault: false },
      { groupName: "B", optionName: "Two", priceDeltaPoisa: 100 },
    ];
    expect(optionLabels(withExtras)).toEqual(["One", "Two"]);
    expect(optionLabels(withExtras, true)).toEqual(["A: One", "B: Two"]);
  });

  it("defaults toGroup off", () => {
    expect(optionLabels(seekhKabab)).toEqual(optionLabels(seekhKabab, false));
  });

  describe("junk tolerance", () => {
    const emptyCases: { name: string; value: unknown }[] = [
      { name: "null", value: null },
      { name: "undefined", value: undefined },
      { name: "a bare object", value: {} },
      { name: "a string", value: "Medium" },
      { name: "a number", value: 7 },
      { name: "an empty array", value: [] },
    ];

    it.each(emptyCases)("returns [] for $value as the whole snapshot", ({ value }) => {
      expect(optionLabels(value)).toEqual([]);
      expect(optionLabels(value, true)).toEqual([]);
    });

    const entryCases: { name: string; entry: unknown }[] = [
      { name: "null entry", entry: null },
      { name: "undefined entry", entry: undefined },
      { name: "string entry", entry: "Medium" },
      { name: "number entry", entry: 3 },
      { name: "array entry", entry: ["Medium"] },
      { name: "object with no keys", entry: {} },
      { name: "optionName that is not a string", entry: { optionName: 42 } },
      { name: "optionName that is null", entry: { optionName: null } },
      { name: "blank optionName", entry: { optionName: "" } },
      { name: "group but no option", entry: { groupName: "Sides" } },
    ];

    it.each(entryCases)("drops $name", ({ entry }) => {
      expect(optionLabels([entry])).toEqual([]);
      expect(optionLabels([entry, true])).toEqual([]);
    });

    it("keeps the readable entries when junk is mixed in", () => {
      const messy = [null, { optionName: "Extra rice" }, "junk", {}, { optionName: "Mint chutney" }];
      expect(optionLabels(messy)).toEqual(["Extra rice", "Mint chutney"]);
    });

    it("falls back to the bare option when the group is missing or blank", () => {
      expect(optionLabels([{ optionName: "Extra rice" }], true)).toEqual(["Extra rice"]);
      expect(optionLabels([{ groupName: "", optionName: "Extra rice" }], true)).toEqual(["Extra rice"]);
      expect(optionLabels([{ groupName: 99, optionName: "Extra rice" }], true)).toEqual(["Extra rice"]);
    });

    it("shows the group alone is never enough to make a label", () => {
      expect(optionLabels([{ groupName: "Sides", optionName: "" }], true)).toEqual([]);
    });
  });

  it("does not mutate the snapshot it is given", () => {
    const snapshot = [{ groupName: "Sides", optionName: "Extra naan", priceDeltaPoisa: 5000 }];
    const copy = structuredClone(snapshot);
    optionLabels(snapshot, true);
    expect(snapshot).toEqual(copy);
  });

  it("a blank optionName never survives into a printed ticket", () => {
    const labels = optionLabels([{ groupName: "Sides", optionName: "" }]).concat(
      optionLabels([{ groupName: "Sides", optionName: "" }], true),
    );
    expect(labels).toEqual([]);
  });
});
