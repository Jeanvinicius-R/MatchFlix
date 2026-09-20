import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "border-border text-foreground focus:border-accent/60 bg-tint/5 rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none",
          error && "border-danger/70",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
});
