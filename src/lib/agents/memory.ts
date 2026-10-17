import type { MemoryKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { embed } from "@/lib/llm/client";

/**
 * Per-agent memory. Every query is scoped by agentId; there is no API that reads
 * memory across agents. Retrieval is hybrid: keyword overlap + recency + importance,
 * plus cosine similarity when an embedding model is configured.
 */

export async function remember(
  agentId: string,
  items: { kind: MemoryKind; content: string; data?: Prisma.InputJsonValue; importance?: number }[],
) {
  if (!items.length) return;
  let vectors: number[][] | null = null;
  try {
    vectors = await embed(items.map((i) => i.content.slice(0, 2000)));
  } catch {
    vectors = null; // embeddings are optional
  }
  await db.agentMemory.createMany({
    data: items.map((i, idx) => ({
      agentId,
      kind: i.kind,
      content: i.content.slice(0, 4000),
      data: i.data,
      importance: i.importance ?? 1,
      embedding: vectors?.[idx] ?? [],
    })),
  });
}

const tokenize = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

function cosine(a: number[], b: number[]) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function recall(agentId: string, query: string, opts: { limit?: number; kinds?: MemoryKind[] } = {}) {
  const rows = await db.agentMemory.findMany({
    where: { agentId, ...(opts.kinds ? { kind: { in: opts.kinds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (!rows.length) return [];
  const q = tokenize(query);
  let qVec: number[] | null = null;
  if (rows.some((r) => r.embedding.length)) {
    try {
      qVec = (await embed([query]))?.[0] ?? null;
    } catch {
      qVec = null;
    }
  }
  const now = Date.now();
  return rows
    .map((r) => {
      const words = tokenize(r.content);
      let overlap = 0;
      for (const w of q) if (words.has(w)) overlap++;
      const kw = q.size ? overlap / q.size : 0;
      const ageDays = (now - r.createdAt.getTime()) / 86400_000;
      const recency = Math.exp(-ageDays / 14);
      const vec = qVec && r.embedding.length ? cosine(qVec, r.embedding) : 0;
      return { row: r, score: kw * 2 + vec * 2 + recency + r.importance * 0.2 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8)
    .map((x) => x.row);
}
