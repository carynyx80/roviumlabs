"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Field, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

export function AdminAction({
  body,
  label,
  variant = "secondary",
  askReason = false,
}: {
  body: Record<string, string>;
  label: string;
  variant?: ButtonProps["variant"];
  askReason?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (extra: Record<string, string> = {}) => {
    setBusy(true);
    try {
      await api("/api/admin", { method: "POST", body: { ...body, ...extra } });
      toast.success(`${label}: done`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant={variant} loading={busy && !open} onClick={() => (askReason ? setOpen(true) : run())}>
        {label}
      </Button>
      {askReason && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title={label} description="The reason is shown to the creator and recorded in the audit log.">
            <Field label="Reason" htmlFor="adm-reason">
              <Textarea id="adm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
            <div className="mt-4 flex justify-end">
              <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => run({ reason })}>
                Confirm
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
