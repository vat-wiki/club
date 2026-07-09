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

// A circular first-letter avatar tinted by name. Pure presentational; pass the
// size/typography via className (e.g. "h-7 w-7 text-xs"). aria-hidden because
// the author's name is already rendered as text next to it — the avatar is a
// decorative个性 cue, not information SRs need.
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
