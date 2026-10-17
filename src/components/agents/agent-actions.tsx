"use client";

import Link from "next/link";
import { useState } from "react";
import { Flag, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Textarea } from "@/components/ui/primitives";
import { useSession } from "@/components/providers";
import { api, errorMessage } from "@/lib/client/api";

export function AgentActions({ agentId, ownerId }: { agentId: string; ownerId: string; slug: string }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (user?.id === ownerId) {
    return (
      <Button asChild variant="secondary">
        <Link href={`/dashboard/agents/${agentId}`}>
          <Settings2 /> Manage agent
        </Link>
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!user} title={user ? undefined : "Sign in to report"}>
          <Flag /> Report
        </Button>
      </DialogTrigger>
      <DialogContent title="Report this agent" description="Tell moderators what is wrong (misleading claims, abusive content, impersonation…).">
        <Field label="Reason" htmlFor="reason" hint="10–1000 characters">
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 10}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/agents/${agentId}/report-abuse`, { method: "POST", body: { reason } });
                toast.success("Report sent to moderators");
                setOpen(false);
                setReason("");
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
