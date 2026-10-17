import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-[background,color,border-color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-[#f5f7fa] to-[#c7d0dc] text-[#080b10] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_1px_2px_rgb(0_0_0/0.4)] hover:from-white hover:to-[#d6dde7]",
        accent:
          "bg-accent text-[#06101f] hover:bg-[#9cc4ff] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
        secondary: "bg-surface text-fg border border-border hover:bg-surface-2 hover:border-border-strong",
        ghost: "text-muted hover:text-fg hover:bg-surface",
        outline: "border border-border-strong text-fg hover:bg-surface",
        danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
