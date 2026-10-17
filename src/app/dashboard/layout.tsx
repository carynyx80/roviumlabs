import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { SignInGate } from "@/components/wallet/sign-in-gate";
import { DashboardNav } from "@/components/dashboard/nav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Creator dashboard</h1>
          <p className="mt-1 text-muted">Manage your agents, review executions and launch tokens.</p>
        </div>
        {session && (
          <Link href="/create" className="text-sm text-accent hover:underline">
            + Create a new agent
          </Link>
        )}
      </div>
      {session ? (
        <>
          <DashboardNav />
          <div className="mt-8">{children}</div>
        </>
      ) : (
        <SignInGate title="Sign in to open your dashboard" />
      )}
    </div>
  );
}
