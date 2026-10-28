import { route, ok, created, parseBody, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { tableInputSchema } from "@/server/validation/table";
import { createTable, listTables } from "@/server/services/table.service";

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "table:view");
  return ok({ tables: await listTables({ includeDisabled: true }) });
});

export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "table:manage");
  const input = await parseBody(request, tableInputSchema);
  return created(await createTable(input, user.id, clientIp(request)));
});
