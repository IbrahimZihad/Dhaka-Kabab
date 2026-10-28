import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { AUTH_DIR, CREDENTIALS, REPO_ROOT, authStatePath } from "./env";
import { expectSignedInAs, signIn } from "./staff";

/**
 * Prepares the two staff sessions the specs borrow, through the app's own doors.
 *
 * The owner already exists in this machine's demo database. The kitchen account is
 * created with the project's own bootstrap script — `npm run admin:create`, which
 * takes its details from the environment only — because inventing a staff row
 * behind the app's back would test a shape the restaurant never produces.
 *
 * Both states are written under `test-results/`, which the repository ignores: a
 * session cookie is a credential and does not belong in the working tree. The
 * passwords themselves are never read back, printed, or asserted on.
 */

mkdirSync(AUTH_DIR, { recursive: true });

setup("owner sign-in state", async ({ page }) => {
  await signIn(page, CREDENTIALS.owner);
  await expectSignedInAs(page, "Owner");
  await page.context().storageState({ path: authStatePath("owner") });
});

setup("kitchen staff account and sign-in state", async ({ page }) => {
  const { name, email, password, role } = CREDENTIALS.kitchen;

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "admin:create"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 240_000,
    // The script reads ADMIN_* from the environment and prints no credential back.
    env: { ...process.env, ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_ROLE: role },
  });

  if (result.status !== 0) {
    throw new Error(
      `${npm} run admin:create could not prepare the ${role} account (${email}): exited ${result.status}. ` +
        `${(result.stderr || result.stdout || "").slice(-400)}`,
    );
  }

  await signIn(page, { email, password });
  // A kitchen member lands on the same staff shell, whose overview defers to the
  // display — proof the role really is KITCHEN and not a lucky redirect.
  await expectSignedInAs(page, "Kitchen staff");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toHaveCount(0);
  await expect(page.getByText("Your screen is the kitchen display", { exact: false })).toBeVisible();

  await page.context().storageState({ path: authStatePath("kitchen") });
});
