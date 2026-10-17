import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^c[a-z0-9]{20,32}$/.test(id)) return new Response("Not found", { status: 404 });
  const media = await db.media.findUnique({ where: { id }, select: { bytes: true, mime: true, sha256: true } });
  if (!media) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.mime,
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${media.sha256}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
