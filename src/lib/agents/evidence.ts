import type { MacroReference, NormalizedAsset, SourceRef } from "@/lib/providers/types";

/**
 * Everything an execution learned from approved tools. Verified facts can only enter a report
 * through this store, which is what makes citations and numbers checkable afterwards.
 */
export class Evidence {
  assets = new Map<string, NormalizedAsset>();
  macro: MacroReference[] = [];
  webDocs: { url: string; text: string; sourceId: string }[] = [];
  warnings: string[] = [];
  private sources: SourceRef[] = [];

  /** Registers a source and returns its stable id (S1, S2, …). Deduplicated by URL. */
  cite(ref: SourceRef): string {
    const i = this.sources.findIndex((s) => s.url === ref.url);
    if (i >= 0) return `S${i + 1}`;
    this.sources.push(ref);
    return `S${this.sources.length}`;
  }

  sourceIdFor(url: string): string | undefined {
    const i = this.sources.findIndex((s) => s.url === url);
    return i >= 0 ? `S${i + 1}` : undefined;
  }

  addAsset(a: NormalizedAsset) {
    this.assets.set(a.key, a);
    for (const s of a.sources) this.cite(s);
  }

  addMacro(refs: MacroReference[], sources: SourceRef[]) {
    for (const s of sources) this.cite(s);
    for (const r of refs) if (!this.macro.some((m) => m.key === r.key)) this.macro.push(r);
  }

  get assetList() {
    return [...this.assets.values()];
  }

  get allSources() {
    return [...this.sources];
  }

  get sourceIndex(): Record<string, { title: string; url: string }> {
    return Object.fromEntries(this.sources.map((s, i) => [`S${i + 1}`, { title: s.title, url: s.url }]));
  }
}
