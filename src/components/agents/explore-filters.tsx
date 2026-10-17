"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Input, Select } from "@/components/ui/primitives";
import { SPECIALIZATIONS } from "@/lib/agents/constants";
import { cn } from "@/lib/utils";

export function ExploreFilters({
  initial,
}: {
  initial: { q: string; specialization: string; sort: string; token: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [spec, setSpec] = useState(initial.specialization);
  const [sort, setSort] = useState(initial.sort);
  const [token, setToken] = useState(initial.token);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const u = new URLSearchParams();
      if (q.trim()) u.set("q", q.trim());
      if (spec) u.set("specialization", spec);
      if (sort && sort !== "recent") u.set("sort", sort);
      if (token) u.set("token", "1");
      start(() => router.replace(`/explore${u.size ? `?${u}` : ""}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, spec, sort, token, router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, ticker or description"
            className="pl-9"
            aria-label="Search agents"
            maxLength={80}
          />
          {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" />}
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="md:w-48" aria-label="Sort agents">
          <option value="recent">Recently launched</option>
          <option value="trending">Trending</option>
          <option value="active">Most active (7d)</option>
          <option value="name">Name A–Z</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by specialization">
        {[{ id: "", short: "All" }, ...SPECIALIZATIONS].map((s) => (
          <button
            key={s.id || "all"}
            type="button"
            onClick={() => setSpec(s.id)}
            aria-pressed={spec === s.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] transition-colors cursor-pointer",
              spec === s.id ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {s.short}
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={token} onChange={(e) => setToken(e.target.checked)} className="size-4 accent-[#83b5ff]" />
          Has verified token
        </label>
      </div>
    </div>
  );
}
