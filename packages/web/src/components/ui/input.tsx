import { cn } from "@/lib/utils";
import * as React from "react";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // aria-invalid drives a destructive border + ring when a field is in an
        // error state (e.g. a blocked nickname or an unrecognized pasted key).
        // The data attribute variant lets consumers override per-context.
        aria-invalid={props["aria-invalid"]}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          "data-[invalid]:border-destructive data-[invalid]:focus-visible:ring-destructive",
          className,
        )}
        data-invalid={props["aria-invalid"] ? "" : undefined}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };