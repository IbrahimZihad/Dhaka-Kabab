import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { deleteMedia, listUploadedMedia, mediaNameFromUrl } from "@/server/services/media.service";

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "menu:manage");
  const files = await listUploadedMedia();
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  return ok({
    files,
    totals: {
      count: files.length,
      bytes,
      orphans: files.filter((file) => !file.referenced).length,
    },
  });
});

const querySchema = z.object({ file: z.string().trim().min(36).max(120) });

/**
 * Removes an uploaded picture. Anything still referenced by a dish or category is
 * refused, because deleting it would leave a broken image on the public menu.
 */
export const DELETE = route(async (request: Request) => {
  await mutationUser(request, "menu:manage");
  const { file } = parseQuery(new URL(request.url).searchParams, querySchema);
  const files = await listUploadedMedia();
  const match = files.find((entry) => entry.filename === mediaNameFromUrl(file));
  if (!match) return ok({ deleted: false, reason: "not-found" });
  if (match.referenced) return ok({ deleted: false, reason: "referenced" });
  await deleteMedia(match.filename);
  return ok({ deleted: true, filename: match.filename });
});
