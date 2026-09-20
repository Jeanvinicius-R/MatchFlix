import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-strong focus-visible:outline-accent",
  secondary:
    "bg-tint/10 text-foreground backdrop-blur-md hover:bg-tint/15 focus-visible:outline-tint/40",
  ghost: "bg-transparent text-foreground hover:bg-tint/10 focus-visible:outline-tint/40",
};

/** Button look for elements that aren't <button> (e.g. a <Link> that should look like one). */
export function buttonStyles(variant: ButtonVariant = "primary", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASSES[variant],
    className,
  );
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={buttonStyles(variant, className)} {...props} />;
}
