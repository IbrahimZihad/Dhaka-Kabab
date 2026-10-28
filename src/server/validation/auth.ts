import { z } from "zod";
import { bdPhone } from "@/server/validation/common";
import { passwordProblem } from "@/lib/auth/password";

/** Authentication and staff account validation. */

/**
 * One rule set for every password the app accepts: the same `passwordProblem`
 * the services use, so a form cannot pass a password the domain would reject.
 */
export const strongPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200)
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: bdPhone,
  password: strongPassword,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: strongPassword,
});

export const passwordResetStartSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export const passwordResetCompleteSchema = z.object({
  token: z.string().min(16).max(128, "That reset link looks incomplete. Ask for a new one."),
  newPassword: strongPassword,
});

export const staffInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: bdPhone.optional().or(z.literal("").transform(() => undefined)),
  role: z.enum(["OWNER", "MANAGER", "CASHIER", "KITCHEN"]),
  password: strongPassword.optional(),
  isActive: z.boolean().default(true),
});

export const customerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: bdPhone.optional().or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(300).nullish(),
  /** Internal staff note; never rendered on a customer screen. */
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
});

/**
 * Edit form. Written out field by field rather than derived from the create
 * schema, because a `.partial()` of a schema with defaults would silently
 * re-activate a deactivated account whenever a name is corrected.
 */
export const staffPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: bdPhone.optional().or(z.literal("").transform(() => undefined)),
    role: z.enum(["OWNER", "MANAGER", "CASHIER", "KITCHEN"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const adminPasswordSchema = z.object({ newPassword: strongPassword });

/**
 * What a customer may change about their own account. Deliberately excludes
 * `notes` and `isActive`, which are staff-controlled fields.
 */
export const selfProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: bdPhone.optional().or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(300).nullish(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type StaffInput = z.infer<typeof staffInputSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
