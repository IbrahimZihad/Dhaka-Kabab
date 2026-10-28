import { route, ok } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export const GET = route(async (request: Request) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return ok({ user: null });

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
  });
  if (!account || !account.isActive) return ok({ user: null });

  return ok({
    user: {
      id: account.id,
      email: account.email,
      name: account.name,
      phone: account.phone,
      role: account.role,
      roleLabel: ROLE_LABELS[account.role],
    },
    // Cosmetic only: every protected endpoint re-checks on the server.
    permissions: ROLE_PERMISSIONS[account.role],
  });
});
