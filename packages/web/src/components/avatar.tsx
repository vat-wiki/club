import { cn } from "@/lib/utils";

// Deterministic tint per participant so everyone gets a stable, distinct
// avatar color without storing or uploading anything — hash the name to a hue.
// Picked HSL with fixed S/L so the palette reads as one system (no clashing
// neon); the initial is the only personalized bit.
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

function avatarInitial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

/**
 * Deterministic tint per participant — hash the name to an HSL hue so everyone
 * gets a stable, distinct avatar color without storing or uploading anything.
 * S/L are fixed (55% / 45%) so the palette reads as one system rather than
 * clashing neon shades; the initial is the only personalized bit.
 *
 * @param name - Participant name used to derive the color and initial.
 * @param className - Optional size/typography classes (e.g. "h-7 w-7 text-xs").
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex flex-none items-center justify-center rounded-full font-mono font-medium text-white select-none",
        className,
      )}
      style={{ backgroundColor: avatarColor(name) }}
    >
      {avatarInitial(name)}
    </span>
  );
}
