"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { formatPoisa, poisaToInputValue } from "@/lib/money";
import { MenuImageUpload } from "@/components/admin/menu-image-upload";

/**
 * The dish editor — create or edit one menu item.
 *
 * MONEY: the price box holds TAKA exactly as the person types it (e.g. "350.00").
 * That string is sent verbatim in the `pricePoisa` field and the server's
 * validation turns it into integer poisa; nothing here multiplies by 100. The
 * save button repeats the amount so a slip is visible before it is committed.
 *
 * A failed save keeps every field: the values live in component state and the
 * server's refusal is shown above the form, never wiped.
 */

export type DishRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  pricePoisa: number;
  imageUrl: string | null;
  available: boolean;
  featured: boolean;
  prepMinutes: number | null;
  ingredients: string | null;
  allergens: string | null;
  spicyLevel: number;
  servesInfo: string | null;
  sortOrder: number;
};

type CategoryOption = { id: string; name: string };

const SPICY_LABELS = ["No heat", "Mild", "Medium", "Hot", "Very hot", "Fiery"];

export function MenuItemForm({
  mode,
  symbol,
  categories,
  dish,
}: {
  mode: "create" | "edit";
  symbol: string;
  categories: CategoryOption[];
  dish?: DishRecord;
}) {
  const router = useRouter();
  const { busy, error, notice, run } = useAdminAction();

  const [name, setName] = useState(dish?.name ?? "");
  const [slug, setSlug] = useState(dish?.slug ?? "");
  const [categoryId, setCategoryId] = useState(dish?.categoryId ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(dish ? poisaToInputValue(dish.pricePoisa) : "");
  const [description, setDescription] = useState(dish?.description ?? "");
  const [ingredients, setIngredients] = useState(dish?.ingredients ?? "");
  const [allergens, setAllergens] = useState(dish?.allergens ?? "");
  const [servesInfo, setServesInfo] = useState(dish?.servesInfo ?? "");
  const [prepMinutes, setPrepMinutes] = useState(dish?.prepMinutes != null ? String(dish.prepMinutes) : "");
  const [spicyLevel, setSpicyLevel] = useState(String(dish?.spicyLevel ?? 0));
  const [sortOrder, setSortOrder] = useState(String(dish?.sortOrder ?? 0));
  const [imageUrl, setImageUrl] = useState<string | null>(dish?.imageUrl ?? null);
  const [available, setAvailable] = useState(dish?.available ?? true);
  const [featured, setFeatured] = useState(dish?.featured ?? false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = {
      name: name.trim(),
      slug: slug.trim() ? slug.trim() : undefined,
      categoryId,
      pricePoisa: price.trim(),
      description: description.trim() ? description.trim() : null,
      imageUrl: imageUrl ?? null,
      available,
      featured,
      prepMinutes: prepMinutes.trim() === "" ? null : Number(prepMinutes),
      ingredients: ingredients.trim() ? ingredients.trim() : null,
      allergens: allergens.trim() ? allergens.trim() : null,
      spicyLevel: Number(spicyLevel) || 0,
      servesInfo: servesInfo.trim() ? servesInfo.trim() : null,
      sortOrder: Number(sortOrder) || 0,
    };

    if (mode === "create") {
      const result = await run<DishRecord>("POST", "/api/admin/menu/items", body);
      if (result) {
        router.push(`/admin/menu/${result.id}`);
      }
      return;
    }

    if (!dish) return;
    const result = await run<DishRecord>("PATCH", `/api/admin/menu/items/${dish.id}`, body);
    if (result) {
      router.refresh();
    }
  }

  const pricePreview = price.trim() || "0";

  return (
    <form className="card space-y-4 p-5" onSubmit={submit}>
      {notice ? <p className="notice notice-ok">{notice}</p> : null}
      {error ? (
        <p className="notice notice-error">
          {error} Nothing was changed — your entries are still here.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="dish-name">
            Name
          </label>
          <input
            id="dish-name"
            className="input"
            required
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="dish-category">
            Section
          </label>
          <select id="dish-category" className="select" required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.length === 0 ? <option value="">No section exists yet</option> : null}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dish-price">
            Price (taka)
          </label>
          <input
            id="dish-price"
            className="input"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="350.00"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <p className="hint mt-1">
            Type the taka amount as you would say it (e.g. 350 or 350.00). Stored as {symbol} {pricePreview}.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="dish-slug">
            Web address (optional)
          </label>
          <input
            id="dish-slug"
            className="input"
            maxLength={72}
            autoComplete="off"
            placeholder="auto from name"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
          <p className="hint mt-1">Lowercase letters, numbers and dashes. Left blank, it is made from the name.</p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="dish-description">
          Description (optional)
        </label>
        <textarea
          id="dish-description"
          className="textarea"
          maxLength={600}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="dish-ingredients">
            Ingredients (optional)
          </label>
          <textarea
            id="dish-ingredients"
            className="textarea"
            maxLength={600}
            value={ingredients}
            onChange={(event) => setIngredients(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="dish-allergens">
            Allergens (optional)
          </label>
          <textarea
            id="dish-allergens"
            className="textarea"
            maxLength={400}
            value={allergens}
            onChange={(event) => setAllergens(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="dish-serves">
            Serves (optional)
          </label>
          <input
            id="dish-serves"
            className="input"
            maxLength={120}
            value={servesInfo}
            onChange={(event) => setServesInfo(event.target.value)}
            placeholder="e.g. 2 people"
          />
        </div>
        <div>
          <label className="label" htmlFor="dish-prep">
            Prep minutes
          </label>
          <input
            id="dish-prep"
            className="input"
            type="number"
            min={0}
            max={600}
            inputMode="numeric"
            value={prepMinutes}
            onChange={(event) => setPrepMinutes(event.target.value)}
            placeholder="not recorded"
          />
        </div>
        <div>
          <label className="label" htmlFor="dish-spicy">
            Heat
          </label>
          <select id="dish-spicy" className="select" value={spicyLevel} onChange={(event) => setSpicyLevel(event.target.value)}>
            {SPICY_LABELS.map((label, index) => (
              <option key={label} value={String(index)}>
                {index} — {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dish-sort">
            Order in section
          </label>
          <input
            id="dish-sort"
            className="input"
            type="number"
            min={0}
            max={9999}
            inputMode="numeric"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} />
          Available to order
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
          Featured on the front page
        </label>
      </div>
      {!available ? (
        <p className="hint">
          Unavailable means sold out for now: the dish stays visible to guests with a plain note, it is not removed. To
          remove it, use the menu (soft delete) at the foot of this page.
        </p>
      ) : null}

      <div className="border-t border-line pt-4">
        <p className="label mb-2">Picture</p>
        <MenuImageUpload id="dish" value={imageUrl} onChange={setImageUrl} alt={name || "Dish picture"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !categoryId}>
          {busy
            ? "Saving…"
            : mode === "create"
              ? `Create dish at ${symbol} ${pricePreview}`
              : `Save changes · ${symbol} ${pricePreview}`}
        </button>
      </div>
      {dish ? <p className="hint">Current stored price: {formatPoisa(dish.pricePoisa, { symbol })}.</p> : null}
    </form>
  );
}

/** Collapsible "add a dish" control for the list page. */
export function MenuItemCreate({ symbol, categories }: { symbol: string; categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={categories.length === 0}>
        Add a dish
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="label">A new dish</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {categories.length === 0 ? (
        <p className="notice notice-error">Add a section first — every dish must belong to one.</p>
      ) : (
        <MenuItemForm mode="create" symbol={symbol} categories={categories} />
      )}
    </div>
  );
}
