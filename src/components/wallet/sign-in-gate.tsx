"use client";

import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { useSession } from "@/components/providers";

export function SignInGate({ title = "Sign in to continue", description }: { title?: string; description?: string }) {
  const { openConnect } = useSession();
  return (
    <Card className="mx-auto max-w-xl p-10 text-center">
      <Wallet className="mx-auto size-8 text-accent" />
      <h2 className="mt-4 font-display text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">
        {description ?? "Connect your wallet and sign a gasless message. RoviumPad never asks for seed phrases or private keys."}
      </p>
      <Button variant="primary" className="mt-6" onClick={openConnect}>
        <Wallet /> Connect wallet
      </Button>
    </Card>
  );
}
