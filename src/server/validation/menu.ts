import { z } from "zod";
import { bdtToPoisa } from "@/lib/money";

/**
 * Menu validation. Staff and customer forms submit Taka amounts as text; each
 * transform below yields integer poisa, so nothing downstream multiplies floats.
 */

/** Form value in Taka; the transform produces poisa. */
export const pricePoisa = z
  .union([z.string(), z.number()])
  .refine((value) => String(value).trim() !== "", "Enter an amount.")
  .transform((value) => {
    try {
      return bdtToPoisa(value);
    } catch {
      return Number.NaN;
    }
  })
  .refine((value) => Number.isInteger(value) && value >= 0, "Amount must be a positive number.")
  .refine((value) => value <= 100_000_000, "Amount is unrealistically large.");

const slugPattern = /^[a-z0-9][a-z0-9-]{1,71}$/;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, "Category name is required.").max(60),
  slug: z.string().trim().toLowerCase().regex(slugPattern, "Use lowercase letters, numbers and dashes.").optional(),
  description: z.string().trim().max(400).nullish(),
  imageUrl: z.string().trim().max(500).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const menuItemInputSchema = z.object({
  name: z.string().trim().min(2, "Item name is required.").max(80),
  slug: z.string().trim().toLowerCase().regex(slugPattern, "Use lowercase letters, numbers and dashes.").optional(),
  description: z.string().trim().max(600).nullish(),
  categoryId: z.string().min(1, "Choose a category."),
  pricePoisa,
  imageUrl: z.string().trim().max(500).nullish(),
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
  prepMinutes: z.coerce.number().int().min(0).max(600).nullish(),
  ingredients: z.string().trim().max(600).nullish(),
  allergens: z.string().trim().max(400).nullish(),
  spicyLevel: z.coerce.number().int().min(0).max(5).default(0),
  servesInfo: z.string().trim().max(120).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const customizationOptionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Option name is required.").max(60),
  priceDeltaPoisa: pricePoisa,
  available: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const customizationGroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(60),
  required: z.boolean().default(false),
  minSelect: z.coerce.number().int().min(0).max(10).default(0),
  maxSelect: z.coerce.number().int().min(1).max(10).default(1),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  options: z.array(customizationOptionSchema).min(1, "Add at least one option.").max(20),
});

export const menuItemStatusSchema = z.object({ available: z.boolean() });
export const menuItemFeaturedSchema = z.object({ featured: z.boolean() });

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export type CustomizationGroupInput = z.infer<typeof customizationGroupSchema>;
