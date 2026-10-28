import { route, created, clientIp } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { mutationUser } from "@/server/http/guards";
import { saveUpload } from "@/server/services/media.service";
import { writeAudit } from "@/lib/audit";

/**
 * Menu image upload. The stored name is generated here from random bytes and the
 * format is read from the file's magic bytes — the client's filename and declared
 * MIME type are ignored, so a renamed script cannot be served back as an image.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "menu:manage");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION", "Send the image in a multipart field named \"file\".");
  }
  const upload = await saveUpload(file);
  await writeAudit({
    actorUserId: user.id,
    action: "media.upload",
    entityType: "Media",
    entityId: upload.filename,
    meta: { bytes: upload.bytes, mime: upload.mime },
    ip: clientIp(request),
  });
  return created(upload);
});
