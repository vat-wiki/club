import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx + tailwind-merge.
 *
 * Conditionally includes truthy classes, deduplicates, and resolves Tailwind
 * conflicts (e.g. `p-2` takes precedence over `p-4` when both appear, last
 * wins for simple classes). Replaces manual string concatenation throughout
 * the React components.
 *
 * @param inputs - CSS class strings, arrays, or boolean-gated values.
 * @returns The merged class string (empty when no truthy input).
 * @example
 * cn("px-4", isPrimary && "bg-blue-600", ["rounded", "shadow"]); // "px-4 bg-blue-600 rounded shadow"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}