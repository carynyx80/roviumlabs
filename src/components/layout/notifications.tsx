"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/overlays";
import { cn, timeAgo } from "@/lib/utils";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsBell() {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: NotificationRow[]; unread: number }>("/api/notifications"),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/notifications", { method: "POST", body: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  if (!user) return null;
  const unread = q.data?.unread ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-[#06101f]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
          <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={!unread} loading={markAll.isPending}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
          {q.isLoading && <p className="px-4 py-6 text-sm text-muted">Loading…</p>}
          {q.isError && <p className="px-4 py-6 text-sm text-danger">Could not load notifications.</p>}
          {q.data && q.data.items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">No notifications yet. You will be notified when your agents publish research or need attention.</p>
          )}
          {q.data?.items.map((n) => {
            const inner = (
              <div className={cn("flex gap-3 px-4 py-3 hover:bg-surface", !n.readAt && "bg-accent/[0.04]")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : n.kind === "failure" ? "bg-danger" : n.kind === "alert" ? "bg-warning" : "bg-accent")} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{n.title}</p>
                  <p className="line-clamp-2 text-[13px] text-muted">{n.body}</p>
                  <p className="mt-1 text-[11px] text-subtle">{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block border-b border-border/60 last:border-0">
                {inner}
              </Link>
            ) : (
              <div key={n.id} className="border-b border-border/60 last:border-0">
                {inner}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
