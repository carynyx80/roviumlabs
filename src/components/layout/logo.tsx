import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" className={cn("group flex items-center gap-2.5", className)} aria-label="RoviumPad home">
      <Image
        src="/brand/r-mark.png"
        alt=""
        width={36}
        height={36}
        priority
        className="size-9 rounded-[9px] ring-1 ring-white/5"
      />
      {!compact && (
        <span className="font-display text-[17px] font-semibold tracking-tight">
          <span className="text-metal">Rovium</span>
          <span className="text-muted">Pad</span>
        </span>
      )}
    </Link>
  );
}
