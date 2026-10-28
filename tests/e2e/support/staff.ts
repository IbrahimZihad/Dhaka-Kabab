import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { authStatePath, E2E_BASE_URL } from "./env";

export type StaffRole = "owner" | "kitchen";

/**
 * Reaching a staff screen the way a member of staff does: through the real login
 * form. There is no cookie minted behind the app's back — if the door breaks, the
 * setup that saves these states fails loudly instead of every screen behind it
 * reporting on a session nobody signed in to create.
 */

/** A browser context that is already signed in as staff, with the base URL wired up. */
export async function staffContext(browser: Browser, role: StaffRole): Promise<BrowserContext> {
  return browser.newContext({ baseURL: E2E_BASE_URL, storageState: authStatePath(role) });
}

/** A browser context with no session at all — a guest's own phone. */
export async function guestContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: E2E_BASE_URL });
}

/**
 * Signs in through the login page. Staff land on `/admin` whatever their role, so
 * that arrival is the success signal rather than a cookie we set ourselves.
 *
 * The form is a client component: clicked before React has hydrated it, the browser
 * submits it natively and the page lands on `/login?` having signed nobody in. A cold
 * dev compile of that chunk is slow enough for this to be a real race, so the page is
 * given time to go quiet first and the attempt is repeated if hydration lost.
 */
export async function signIn(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.getByLabel("Password", { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL(/\/admin/, { timeout: 40_000 });
      return;
    } catch {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
    }
  }
  throw new Error("Signing in through the real login form never reached /admin.");
}

/** The name and role the staff header shows for whoever is signed in. */
export function shellIdentity(page: Page): Locator {
  return page.locator("header").getByText(/·/);
}

/** Asserts the staff shell really is showing the role the spec needs. */
export async function expectSignedInAs(page: Page, roleLabel: string): Promise<void> {
  await expect(shellIdentity(page)).toContainText(`· ${roleLabel}`, { timeout: 30_000 });
}

/**
 * A defect the suite observed but did not cause. Recorded as a TestInfo annotation
 * so it reaches the report instead of being quietly asserted away, and instead of
 * a real product bug being written off as a flaky expectation.
 */
export function recordFinding(description: string): void {
  const info: TestInfo = test.info();
  info.annotations.push({ type: "finding", description });
}
