import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Menu imagery lives on the local disk, not in the database or a public CDN.
 *
 * Two rules make that safe to expose over HTTP:
 *   1. a stored name is always `<32 hex>.<ext>` we generated ourselves — the
 *      client never chooses it, and lookups reject anything else, so `..`,
 *      encoded separators and absolute paths cannot escape the upload folder;
 *   2. the type is decided by the file's own magic bytes, never by the
 *      `Content-Type` or filename the browser claimed.
 */

const MAX_BYTES = 6 * 1024 * 1024;

type Format = { ext: string; mime: string; signature: number[] };

const FORMATS: Format[] = [
  { ext: "jpg", mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  { ext: "png", mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: "webp", mime: "image/webp", signature: [0x52, 0x49, 0x46, 0x46] },
];

const NAME_PATTERN = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

export function uploadRoot(): string {
  return path.resolve(process.cwd(), env.uploadDir);
}

function startsWith(bytes: Buffer, signature: number[], offset: number): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** WebP is RIFF....WEBP, so the second half of the tag decides. */
function detectFormat(bytes: Buffer): Format | null {
  for (const format of FORMATS) {
    if (!startsWith(bytes, format.signature, 0)) continue;
    if (format.ext === "webp" && !startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) continue;
    return format;
  }
  return null;
}

export function isStoredMediaName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** Turns `/api/media/abc….png` or a bare name back into the stored filename. */
export function mediaNameFromUrl(url: string): string | null {
  const base = path.posix.basename(url.split("?")[0] ?? "");
  return isStoredMediaName(base) ? base : null;
}

export type UploadedMedia = { filename: string; url: string; bytes: number; mime: string };

export async function saveUpload(input: File | null | undefined): Promise<UploadedMedia> {
  if (!input || typeof input.arrayBuffer !== "function") {
    throw new AppError("VALIDATION", "Choose an image file to upload.");
  }
  if (input.size > MAX_BYTES) {
    throw new AppError("VALIDATION", "Keep menu images under 6 MB.");
  }
  const bytes = Buffer.from(await input.arrayBuffer());
  if (bytes.length === 0) throw new AppError("VALIDATION", "That file is empty.");
  if (bytes.length > MAX_BYTES) throw new AppError("VALIDATION", "Keep menu images under 6 MB.");

  const format = detectFormat(bytes);
  if (!format) {
    throw new AppError("VALIDATION", "Menu images must be JPEG, PNG or WebP.");
  }

  const filename = `${randomBytes(16).toString("hex")}.${format.ext}`;
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, filename), bytes, { mode: 0o644 });
  return { filename, url: mediaUrl(filename), bytes: bytes.length, mime: format.mime };
}

export function mediaUrl(filename: string): string {
  return `/api/media/${filename}`;
}

export async function readMedia(filename: string): Promise<{ body: Buffer; mime: string; etag: string } | null> {
  if (!isStoredMediaName(filename)) return null;
  try {
    const body = await readFile(path.join(uploadRoot(), filename));
    const format = FORMATS.find((entry) => entry.ext === filename.slice(33));
    return {
      body,
      mime: format?.mime ?? "application/octet-stream",
      // The name is content-addressable enough in practice: it is never reused.
      etag: `"${filename}"`,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort cleanup when a dish changes picture or is removed. Losing the
 * unlink is not a correctness problem — a stale file is unreachable and merely
 * occupies disk until an operator prunes it.
 */
export async function deleteMedia(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  const filename = mediaNameFromUrl(url);
  if (!filename) return false;
  try {
    await unlink(path.join(uploadRoot(), filename));
    return true;
  } catch {
    return false;
  }
}

/** Names referenced by any image column, so the orphan listing is trustworthy. */
export async function listUploadedMedia(): Promise<{ filename: string; bytes: number; referenced: boolean }[]> {
  const root = uploadRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const { prisma } = await import("@/lib/db");
  const [items, categories, settings] = await Promise.all([
    prisma.menuItem.findMany({ select: { imageUrl: true } }),
    prisma.menuCategory.findMany({ select: { imageUrl: true } }),
    prisma.restaurantSettings.findFirst({ select: { logoUrl: true } }),
  ]);
  const urls = [
    ...items.map((item) => item.imageUrl),
    ...categories.map((category) => category.imageUrl),
    settings?.logoUrl ?? null,
  ];
  const used = new Set(
    urls
      .filter((url): url is string => Boolean(url))
      .map((url) => mediaNameFromUrl(url))
      .filter((name): name is string => Boolean(name)),
  );

  const listed = await Promise.all(
    names.filter(isStoredMediaName).map(async (filename) => {
      const info = await stat(path.join(root, filename)).catch(() => null);
      return { filename, bytes: info?.size ?? 0, referenced: used.has(filename) };
    }),
  );
  return listed.sort((a, b) => b.bytes - a.bytes);
}
