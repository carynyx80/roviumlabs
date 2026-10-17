"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/agents", label: "My agents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border scrollbar-thin" aria-label="Dashboard">
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm", active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
