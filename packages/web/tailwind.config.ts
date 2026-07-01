import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chrome: {
          DEFAULT: "hsl(var(--chrome))",
          foreground: "hsl(var(--chrome-foreground))",
        },
        // brief-specific: who is broadcasting
        human: {
          DEFAULT: "hsl(var(--human))",
          foreground: "hsl(var(--human-foreground))",
          soft: "hsl(var(--human-soft))",
        },
        agent: {
          DEFAULT: "hsl(var(--agent))",
          foreground: "hsl(var(--agent-foreground))",
          soft: "hsl(var(--agent-soft))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Tuned motion curves/durations — replaces Tailwind's Material-default
      // (0.15s cubic-bezier(0.4,0,0.2,1)) with a softer out-quint. Every
      // `transition-*` utility now reads these, so the whole app gets a
      // gentler "吸附" feel without touching individual components.
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)", // out-quint
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)", // micro hover/press
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)", // gentle overshoot
      },
      transitionDuration: {
        DEFAULT: "200ms",
        fast: "120ms",
        slow: "320ms",
      },
      keyframes: {
        "agent-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(0.85)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        // Brand "heartbeat" for the wordmark dot — very slow, very light.
        "brand-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        // Image-thumbnail loading shimmer: a slow horizontal sheen sweeping
        // across the muted placeholder while the thumbnail decodes. Same
        // out-quint easing as the rest of the motion language. The infinite
        // iteration is collapsed to a single frame under prefers-reduced-motion
        // by the global `animation-iteration-count: 1 !important` in index.css.
        "shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "agent-pulse": "agent-pulse 2s cubic-bezier(0.16,1,0.3,1) infinite",
        "slide-in": "slide-in 0.32s cubic-bezier(0.16,1,0.3,1)",
        "brand-pulse": "brand-pulse 4s ease-in-out infinite",
        "shimmer": "shimmer 1.4s cubic-bezier(0.16,1,0.3,1) infinite",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;