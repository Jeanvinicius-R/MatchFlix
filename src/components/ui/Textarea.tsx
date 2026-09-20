import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, className, rows = 4, ...props },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={textareaId} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "border-border text-foreground placeholder:text-muted-foreground focus:border-accent/60 bg-tint/5 rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none",
          error && "border-danger/70",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
});
