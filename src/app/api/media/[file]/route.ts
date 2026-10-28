import { NextResponse } from "next/server";
import { isStoredMediaName, readMedia } from "@/server/services/media.service";

/**
 * Serves an uploaded picture. Only names matching `<32 hex>.<ext>` reach the
 * disk, so `../../etc/passwd` and any other traversal attempt is rejected before
 * a path is built.
 */
export const GET = async (_request: Request, ctx: { params: Promise<{ file: string }> }) => {
  const { file } = await ctx.params;
  if (!isStoredMediaName(file)) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  const media = await readMedia(file);
  if (!media) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  if (_request.headers.get("if-none-match") === media.etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: media.etag } });
  }
  return new NextResponse(Uint8Array.from(media.body), {
    status: 200,
    headers: {
      "Content-Type": media.mime,
      "Content-Length": String(media.body.length),
      ETag: media.etag,
      // Generated names are never reused, so a cached picture cannot go stale.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'",
    },
  });
};
