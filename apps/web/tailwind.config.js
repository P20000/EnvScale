/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],

  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],

  theme: {
    extend: {
      colors: {
        background: "#09090b",
        surface: "#141417",
        panel: "#1f1f23",
        foreground: "#f4f4f5",

        card: {
          DEFAULT: "#141417",
          foreground: "#f4f4f5",
        },

        popover: {
          DEFAULT: "#1f1f23",
          foreground: "#f4f4f5",
        },

        primary: {
          DEFAULT: "#3b82f6",
          foreground: "#ffffff",
        },

        secondary: {
          DEFAULT: "#27272a",
          foreground: "#f4f4f5",
        },

        muted: {
          DEFAULT: "#18181b",
          foreground: "#a1a1aa",
        },

        accent: {
          DEFAULT: "#27272a",
          foreground: "#f4f4f5",
        },

        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },

        border: "#27272a",
        input: "#27272a",
        ring: "#3b82f6",

        /* K8s Status Tokens */
        canvas: {
          bg: "#09090b",
          dot: "#27272a",
        },

        status: {
          running: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          inactive: "#6b7280",
        },
      },

      borderRadius: {
        "sm": "0.25rem",  /* 4px - Inputs, form fields */
        "md": "0.5rem",   /* 8px - Buttons, filter chips */
        "xl": "0.75rem",  /* 12px - Snackbars, popovers */
        "2xl": "1rem",    /* 16px - Dashboard cards */
        "3xl": "1.75rem", /* 28px - Heavy modals */
      },

      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "'Plus Jakarta Sans Variable'", "system-ui", "-apple-system", "sans-serif"],
        heading: ["'Google Sans'", "'Plus Jakarta Sans'", "sans-serif"],
        mono: ["'Google Sans Code'", "'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },

  plugins: [],
};