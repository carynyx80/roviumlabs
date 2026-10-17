"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Mail, Send, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { anyChainById } from "@/lib/chain/chains";
import { formatDateTime, timeAgo } from "@/lib/utils";

interface Me {
  user: { id: string; displayName: string | null; role: string; createdAt: string };
  wallets: { address: string; chainId: number; createdAt: string; lastSeenAt: string }[];
  sessions: { id: string; createdAt: string; expiresAt: string; userAgent: string | null; chainId: number; current: boolean }[];
}

export function SettingsForm() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });
  const [name, setName] = useState("");
  useEffect(() => {
    if (q.data) setName(q.data.user.displayName ?? "");
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", body: { displayName: name } }),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => api("/api/me", { method: "DELETE", body: { sessionId } }),
    onSuccess: () => {
      toast.success("Session revoked");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-80" />;
  if (q.isError || !q.data) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const me = q.data;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Display name" htmlFor="dn" hint="Shown as the creator on your agents. Leave empty to show your address.">
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          </Field>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
          <p className="text-[12px] text-subtle">
            Member since {formatDateTime(me.user.createdAt)} {me.user.role === "ADMIN" && <Badge tone="accent">Admin</Badge>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {me.wallets.map((w) => (
              <li key={w.address}>
                <p className="break-all font-mono text-[13px]">{w.address}</p>
                <p className="text-[12px] text-subtle">Last seen {timeAgo(w.lastSeenAt)} on {anyChainById(w.chainId)?.label ?? `chain ${w.chainId}`}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60 text-sm">
            {me.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-silver">{s.userAgent?.replace(/\(.*?\)/g, "").slice(0, 60) ?? "Unknown device"}</p>
                  <p className="text-[12px] text-subtle">
                    Signed in {timeAgo(s.createdAt)} · expires {timeAgo(s.expiresAt)}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="success">This device</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Bell className="size-4 text-accent" /> In-app notifications
            </span>
            <Badge tone="success">Enabled</Badge>
          </div>
          {[
            { icon: Mail, label: "Email" },
            { icon: Send, label: "Telegram" },
            { icon: Webhook, label: "Webhook" },
          ].map((c) => (
            <div key={c.label} className="flex items-center justify-between text-muted">
              <span className="flex items-center gap-2">
                <c.icon className="size-4" /> {c.label}
              </span>
              <Badge>Not yet available</Badge>
            </div>
          ))}
          <p className="text-[12px] text-subtle">
            External channels require a verified destination and an operator-configured delivery provider. They are never enabled automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
