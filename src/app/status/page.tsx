import type { Metadata } from "next";
import { StatusBoard } from "@/components/status/status-board";

export const metadata: Metadata = { title: "Network status" };

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-8 max-w-2xl space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">Live status</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Network & platform status</h1>
        <p className="text-muted">
          Read-only checks against the live networks RoviumPad runs on, refreshed every 30 seconds. The token deployment check is a
          dry run — it executes the agent token constructor on-chain via gas estimation without sending a transaction.
        </p>
      </div>
      <StatusBoard />
    </div>
  );
}
