"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPoisa } from "@/lib/money";
import { addToCart } from "@/lib/cart";

export type CustomizerItem = {
  id: string;
  name: string;
  slug: string;
  pricePoisa: number;
  groups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    options: { id: string; name: string; priceDeltaPoisa: number }[];
  }[];
};

type Choice = { groupId: string; optionId: string; name: string; priceDeltaPoisa: number };

/**
 * The only place a guest decides what goes on a dish. What leaves this component
 * is ids and a quantity — the price the kitchen sees is rebuilt from the database
 * when the order is created, so editing this page cannot change a total.
 */
export function ItemCustomizer({ item, symbol }: { item: CustomizerItem; symbol: string }) {
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitPoisa = useMemo(() => {
    const extras = Object.values(choices).reduce(
      (total, group) => total + group.reduce((sum, option) => sum + option.priceDeltaPoisa, 0),
      0,
    );
    return item.pricePoisa + extras;
  }, [choices, item.pricePoisa]);

  function toggle(group: CustomizerItem["groups"][number], option: Choice) {
    setError(null);
    setChoices((current) => {
      const picked = current[group.id] ?? [];
      const already = picked.some((choice) => choice.optionId === option.optionId);
      if (group.maxSelect <= 1) {
        return { ...current, [group.id]: already ? [] : [option] };
      }
      if (already) {
        return { ...current, [group.id]: picked.filter((choice) => choice.optionId !== option.optionId) };
      }
      if (picked.length >= group.maxSelect) {
        setError(`${group.name}: pick at most ${group.maxSelect}.`);
        return current;
      }
      return { ...current, [group.id]: [...picked, option] };
    });
  }

  function add() {
    for (const group of item.groups) {
      const picked = choices[group.id] ?? [];
      const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
      if (picked.length < minimum) {
        setError(
          group.maxSelect <= 1
            ? `Please choose one option for ${group.name}.`
            : `Please choose ${minimum} or more for ${group.name}.`,
        );
        return;
      }
    }
    const named = Object.values(choices).flat();
    addToCart(
      { id: item.id, name: item.name, slug: item.slug, pricePoisa: item.pricePoisa },
      named.map((choice) => ({ ...choice })),
      quantity,
      instructions.trim() || null,
    );
    setError(null);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2500);
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label">Order this dish</p>
        <p className="price text-xl">{formatPoisa(unitPoisa * quantity, { symbol })}</p>
      </div>
      <p className="hint mt-1">
        {formatPoisa(item.pricePoisa, { symbol })} each{quantity > 1 ? ` · ${quantity} selected` : ""}
      </p>

      {item.groups.length === 0 ? (
        <p className="mt-4 text-sm soft">
          This dish has no choices to make — it comes the way the kitchen makes it.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {item.groups.map((group) => (
            <fieldset key={group.id}>
              <legend className="label">
                {group.name}
                {group.required ? " (required)" : group.maxSelect > 1 ? ` (choose up to ${group.maxSelect})` : " (optional)"}
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => {
                  const picked = (choices[group.id] ?? []).some((choice) => choice.optionId === option.id);
                  const inputType = group.maxSelect <= 1 ? "radio" : "checkbox";
                  return (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                        picked ? "border-brand bg-brand/5" : "border-line"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={inputType}
                          name={group.id}
                          checked={picked}
                          onChange={() => toggle(group, { groupId: group.id, optionId: option.id, name: option.name, priceDeltaPoisa: option.priceDeltaPoisa })}
                        />
                        {option.name}
                      </span>
                      {option.priceDeltaPoisa !== 0 ? (
                        <span className="muted">
                          {option.priceDeltaPoisa > 0 ? "+" : "−"}
                          {formatPoisa(Math.abs(option.priceDeltaPoisa), { symbol })}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      <div className="mt-5">
        <label className="label" htmlFor="instructions">
          Note for the kitchen (optional)
        </label>
        <textarea
          id="instructions"
          className="textarea mt-1"
          maxLength={280}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Less chilli, no coriander, extra on the side…"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Fewer">
            −
          </button>
          <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="More">
            +
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={add}>
          Add to order
        </button>
        {added ? (
          <Link href="/cart" className="btn btn-ghost btn-sm">
            Added — view your order
          </Link>
        ) : null}
      </div>

      {error ? <p className="notice notice-error mt-4">{error}</p> : null}
    </div>
  );
}
