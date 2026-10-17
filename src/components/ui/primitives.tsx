import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[14px] border border-border surface-sheen", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-[15px] font-semibold tracking-tight text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "silver";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent/10 text-accent border-accent/25",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  silver: "bg-silver/10 text-silver border-silver/20",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-[10px] border border-border bg-bg-2 px-3 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 aria-[invalid=true]:border-danger/60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[96px] w-full rounded-[10px] border border-border bg-bg-2 px-3 py-2.5 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 aria-[invalid=true]:border-danger/60",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-[10px] border border-border bg-bg-2 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2399a5b5%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_12px_center] bg-no-repeat pl-3 pr-9 text-sm text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-silver", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse-soft rounded-[8px] bg-surface-2", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {icon && <div className="text-subtle [&_svg]:size-7">{icon}</div>}
      <div className="space-y-1">
        <p className="font-display font-semibold text-fg">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="space-y-2">
        {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>}
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h2>
        {description && <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] uppercase tracking-wider text-subtle">{label}</span>
      <span className="font-display text-xl font-semibold tabular-nums text-fg">{value}</span>
      {hint && <span className="text-[12px] text-subtle">{hint}</span>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = {
    info: "border-accent/25 bg-accent/5 text-silver",
    warning: "border-warning/30 bg-warning/5 text-silver",
    danger: "border-danger/30 bg-danger/5 text-silver",
    success: "border-success/30 bg-success/5 text-silver",
  }[tone];
  const titleColor = { info: "text-accent", warning: "text-warning", danger: "text-danger", success: "text-success" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[12px] border px-4 py-3 text-sm", t, className)}>
      {title && <p className={cn("mb-0.5 font-medium", titleColor)}>{title}</p>}
      {children}
    </div>
  );
}
