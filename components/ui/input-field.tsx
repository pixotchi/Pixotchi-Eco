import * as React from "react";

import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export interface InputFieldProps extends InputProps {
  description?: React.ReactNode;
  error?: React.ReactNode;
  label?: React.ReactNode;
}

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  ({ className, description, error, id, label, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="space-y-1.5">
        {label ? (
          <label htmlFor={inputId} className="text-sm font-semibold leading-none text-foreground">
            {label}
          </label>
        ) : null}
        <Input
          ref={ref}
          id={inputId}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : props["aria-invalid"]}
          className={cn(error && "border-destructive focus-visible:ring-destructive", className)}
          {...props}
        />
        {description ? (
          <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
InputField.displayName = "InputField";

export { InputField };
