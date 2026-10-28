import { describe, expect, it } from "vitest";
import { toCsv } from "@/server/services/analytics.service";

/**
 * `toCsv` out of `src/server/services/analytics.service.ts`. Only the pure CSV
 * builder is imported — nothing in these tests reaches the database.
 *
 * Two jobs: spreadsheet-safe output (formula injection guard, RFC-style quoting)
 * and a stable header contract for the admin report downloads.
 */

const BOM = "﻿";

describe("toCsv — formula injection guard", () => {
  const guarded: { name: string; value: string }[] = [
    { name: "leading equals", value: "=1+1" },
    { name: "leading plus", value: "+1+1" },
    { name: "leading minus", value: "-1+1" },
    { name: "leading at sign", value: "@SUM(A1)" },
    { name: "the classic DDE payload", value: '=cmd|\' /C calc\'!A0' },
    { name: "a hyperlink payload", value: "=HYPERLINK(\"http://evil.test\")" },
  ];

  it.each(guarded)("neutralises $name", ({ value }) => {
    const csv = toCsv([{ cell: value }]);
    expect(csv).toContain(`'${value.replace(/"/g, '""')}`);
    expect(csv).not.toContain(`,${value},`);
    expect(csv.split("\r\n")[1]?.startsWith("=")).toBe(false);
  });

  it("leaves an ordinary string alone", () => {
    expect(toCsv([{ cell: "Seekh Kabab" }])).toBe(`${BOM}cell\r\nSeekh Kabab\r\n`);
  });

  it("only guards the first character, so a value with = inside is untouched", () => {
    expect(toCsv([{ cell: "Discount = 10%" }])).toBe(`${BOM}cell\r\nDiscount = 10%\r\n`);
  });

  it("guards a formula that hides behind leading space", () => {
    // Excel ignores the space when it decides whether the cell is a formula, so
    // the guard has to look past it.
    expect(toCsv([{ cell: " =1+1" }])).toBe(`${BOM}cell\r\n' =1+1\r\n`);
  });

  it("guards the header row like any other cell", () => {
    // Column names can come from a dynamic report, so a leading "=" in a name is
    // as dangerous as one in a value.
    expect(toCsv([{ "=cmd": 1 }])).toBe(`${BOM}'=cmd\r\n1\r\n`);
    expect(toCsv([{ "a,b": 1 }])).toBe(`${BOM}"a,b"\r\n1\r\n`);
  });

  it("keeps a negative number numeric", () => {
    // A variance column must still total in the spreadsheet; only text is quoted.
    expect(toCsv([{ delta: -250 }])).toBe(`${BOM}delta\r\n-250\r\n`);
    expect(toCsv([{ delta: "-250 paid back" }])).toBe(`${BOM}delta\r\n'-250 paid back\r\n`);
  });
});

describe("toCsv — quoting and escaping", () => {
  const escaped: { name: string; value: string; expected: string }[] = [
    { name: "embedded quotes", value: 'He said "hi"', expected: '"He said ""hi"""' },
    { name: "a comma", value: "Dhaka, BD", expected: '"Dhaka, BD"' },
    { name: "a newline", value: "line1\nline2", expected: '"line1\nline2"' },
    { name: "a CRLF", value: "line1\r\nline2", expected: '"line1\r\nline2"' },
    { name: "a carriage return", value: "line1\rline2", expected: '"line1\rline2"' },
    { name: "money with a thousands separator", value: "৳ 1,250.00", expected: '"৳ 1,250.00"' },
    { name: "quotes plus a comma", value: 'Kabab, "spicy"', expected: '"Kabab, ""spicy"""' },
    { name: "a guarded formula that also needs quoting", value: "=1,2", expected: "\"'=1,2\"" },
  ];

  it.each(escaped)("escapes $name", ({ value, expected }) => {
    expect(toCsv([{ cell: value }])).toBe(`${BOM}cell\r\n${expected}\r\n`);
  });

  it.each([
    { name: "null", value: null, expected: "" },
    { name: "undefined", value: undefined, expected: "" },
    { name: "zero", value: 0, expected: "0" },
    { name: "a whole number", value: 125000, expected: "125000" },
    { name: "false", value: false, expected: "false" },
    { name: "true", value: true, expected: "true" },
    { name: "an empty string", value: "", expected: "" },
  ])("renders $name as $expected", ({ value, expected }) => {
    expect(toCsv([{ cell: value }])).toBe(`${BOM}cell\r\n${expected}\r\n`);
  });

  it("uses one CRLF between lines and terminates the file", () => {
    const csv = toCsv([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n3,4\r\n`);
  });
});

describe("toCsv — headers and column selection", () => {
  it("derives columns from the first row when no headers are given", () => {
    expect(toCsv([{ orderNumber: "ORD-1", totalPoisa: 45000 }])).toBe(
      `${BOM}orderNumber,totalPoisa\r\nORD-1,45000\r\n`,
    );
  });

  it("reorders columns and drops unlisted keys when headers are given", () => {
    const rows = [{ totalPoisa: 45000, orderNumber: "ORD-1", internalNote: "keep out of exports" }];
    expect(toCsv(rows, ["orderNumber", "totalPoisa"])).toBe(`${BOM}orderNumber,totalPoisa\r\nORD-1,45000\r\n`);
  });

  it("writes an empty cell for a header no row carries", () => {
    expect(toCsv([{ a: 1 }], ["a", "missing"])).toBe(`${BOM}a,missing\r\n1,\r\n`);
  });

  it("keeps row lengths uniform when later rows are missing keys", () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 3 },
    ];
    expect(toCsv(rows)).toBe(`${BOM}a,b\r\n1,2\r\n3,\r\n`);
  });

  it("exports a realistic report row set", () => {
    const rows = [
      { date: "2026-10-28", orders: 41, revenue: "৳ 18,450.00", currency: "BDT" },
      { date: "2026-10-29", orders: 0, revenue: "৳ 0", currency: "BDT" },
    ];
    expect(toCsv(rows, ["date", "orders", "revenue", "currency"])).toBe(
      `${BOM}date,orders,revenue,currency\r\n2026-10-28,41,"৳ 18,450.00",BDT\r\n2026-10-29,0,৳ 0,BDT\r\n`,
    );
  });
});

describe("toCsv — empty result sets", () => {
  it("still emits the header line for a filtered-to-nothing report", () => {
    expect(toCsv([], ["date", "orders"])).toBe(`${BOM}date,orders\r\n`);
  });

  it("emits a lone CRLF when there are no headers either", () => {
    expect(toCsv([])).toBe(`${BOM}\r\n`);
    expect(toCsv([], [])).toBe(`${BOM}\r\n`);
  });

  it("carries the BOM on every file, populated or not", () => {
    // Excel decides the encoding from the first bytes, so an empty report has to
    // look like the populated one rather than being the odd shape out.
    expect(toCsv([], ["revenue"])).toContain(BOM);
    expect(toCsv([{ revenue: 0 }])).toContain(BOM);
  });

  it("round-trips a value with a comma back out of the quoted field", () => {
    const csv = toCsv([{ label: "Kabab, large" }]);
    const dataLine = csv.slice(BOM.length).split("\r\n")[1];
    expect(dataLine).toBe('"Kabab, large"');
    expect(dataLine.slice(1, -1)).toBe("Kabab, large");
  });
});
