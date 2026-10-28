/**
 * First-administrator bootstrap.
 *
 *   ADMIN_NAME="Owner Name" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD='…' \
 *   npm run admin:create
 *
 * The password comes from the environment only: a command-line argument is
 * visible in another user's `ps` output and lands in the shell history. Nothing
 * here ever prints a credential, and no default password exists anywhere in the
 * repository — an account cannot be created without one being supplied.
 */
import { PrismaClient, type UserRole } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const prisma = new PrismaClient();

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const name = envValue("ADMIN_NAME");
  const email = envValue("ADMIN_EMAIL")?.toLowerCase();
  const password = envValue("ADMIN_PASSWORD");
  const role = (envValue("ADMIN_ROLE") ?? "OWNER").toUpperCase() as UserRole;

  if (!name || name.length < 2) fail("ADMIN_NAME is required (the person's name, at least 2 characters).");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("ADMIN_EMAIL is required and must be a valid email address.");
  if (!password) {
    fail(
      "ADMIN_PASSWORD is required. There is no default administrator password in this project.\n" +
        "  Set a private one in your environment (not in a shell history file), for example:\n" +
        '    ADMIN_PASSWORD="$(openssl rand -base64 18)" npm run admin:create',
    );
  }
  const problem = passwordProblem(password);
  if (problem) fail(`ADMIN_PASSWORD was rejected: ${problem}`);
  if (!["OWNER", "MANAGER", "CASHIER", "KITCHEN"].includes(role)) {
    fail(`ADMIN_ROLE "${role}" is not a staff role.`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Idempotent re-run: rotate the credential, never silently create a duplicate.
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(password), isActive: true, name: existing.name || name },
    });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    await prisma.auditLog.create({
      data: {
        actorType: "SYSTEM",
        actorLabel: "scripts/create-admin",
        action: "auth.password.admin_reset",
        entityType: "User",
        entityId: existing.id,
        metaJson: { via: "cli" },
      },
    });
    console.log(`\n  Password rotated for the existing ${existing.role} account ${email}.`);
    console.log("  All of its sessions were revoked, so the old password no longer signs in anywhere.\n");
    return;
  }

  if (role === "OWNER") {
    const owners = await prisma.user.count({ where: { role: "OWNER" } });
    if (owners > 0 && !process.argv.includes("--allow-additional-owner")) {
      fail(
        `${owners} OWNER account(s) already exist. Adding another owner is a deliberate act:\n` +
          "  re-run with --allow-additional-owner, or set ADMIN_ROLE=MANAGER.",
      );
    }
  }

  const created = await prisma.user.create({
    data: { email, name, passwordHash: await hashPassword(password), role, isActive: true },
    select: { id: true, email: true, name: true, role: true },
  });
  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      actorLabel: "scripts/create-admin",
      action: "staff.create",
      entityType: "User",
      entityId: created.id,
      afterJson: { email: created.email, role: created.role },
      metaJson: { via: "cli" },
    },
  });

  console.log(`\n  ${created.role} account ready: ${created.email}`);
  console.log("  The password was not stored in the database, printed, or logged.");
  console.log("  Sign in at /login, then set the restaurant details in /admin/settings.\n");
}

main()
  .catch((error) => {
    console.error("\n  Could not create the administrator:", error instanceof Error ? error.message : error);
    console.error("  Check DATABASE_URL (npm run env:check) and that migrations are applied.\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
