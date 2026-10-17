import { createHash } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { badRequest, ok, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const MAX_UPLOAD = 4 * 1024 * 1024;

/** Detects image type from magic bytes; the client-provided MIME type is never trusted. */
function sniff(buf: Buffer): "png" | "jpeg" | "webp" | "gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  return null;
}

/**
 * Safe image upload: size limit, magic-byte sniffing, full re-encode to WebP 512×512
 * (strips metadata, scripts and polyglot payloads), stored in PostgreSQL.
 */
export const POST = route(async (req) => {
  const session = await requireSession();
  await rateLimit(`upload:${session.userId}`, 20, 3600);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Attach an image in the 'file' field");
  if (file.size > MAX_UPLOAD) throw badRequest("Image must be 4 MB or smaller");
  const input = Buffer.from(await file.arrayBuffer());
  if (!sniff(input)) throw badRequest("Only PNG, JPEG, WebP or GIF images are accepted");

  let output: Buffer;
  let width = 512;
  let height = 512;
  try {
    const img = sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate();
    const out = await img
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    output = out.data;
    width = out.info.width;
    height = out.info.height;
  } catch {
    throw badRequest("The image could not be processed");
  }

  const media = await db.media.create({
    data: {
      ownerId: session.userId,
      mime: "image/webp",
      bytes: new Uint8Array(output),
      width,
      height,
      sha256: createHash("sha256").update(output).digest("hex"),
    },
    select: { id: true, width: true, height: true },
  });
  return ok({ id: media.id, url: `/api/media/${media.id}` }, { status: 201 });
});
