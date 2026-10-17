"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AgentTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/agents/${slug}`, label: "Overview" },
    { href: `/agents/${slug}/research`, label: "Research" },
    { href: `/agents/${slug}/activity`, label: "Activity" },
    { href: `/agents/${slug}/token`, label: "Token" },
    { href: `/agents/${slug}/chat`, label: "Ask the agent" },
  ];
  return (
    <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-border scrollbar-thin" aria-label="Agent sections">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
              active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
