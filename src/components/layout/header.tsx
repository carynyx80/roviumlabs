"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu } from "lucide-react";
import { Logo } from "./logo";
import { NotificationsBell } from "./notifications";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { useState } from "react";

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore Agents" },
  { href: "/create", label: "Create Agent" },
  { href: "/activity", label: "Activity" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-[8px] px-3 py-2 text-sm transition-colors",
                isActive(item.href) ? "text-fg" : "text-muted hover:text-fg",
              )}
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NotificationsBell />
          <div className="hidden sm:block">
            <WalletButton />
          </div>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </Dialog.Trigger>
            <SheetContent title="Navigation">
              <Logo className="mb-8" />
              <nav className="flex flex-col gap-1" aria-label="Mobile">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-[10px] px-3 py-3 text-[15px]",
                      isActive(item.href) ? "bg-surface text-fg" : "text-muted hover:bg-surface hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto pt-6">
                <WalletButton full />
              </div>
            </SheetContent>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
