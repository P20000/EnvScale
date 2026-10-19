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
        background: "#111318",
        surface: "#191B20",
        panel: "#23262D",
        foreground: "#E6E1E5",

        card: {
          DEFAULT: "#191B20",
          foreground: "#E6E1E5",
        },

        popover: {
          DEFAULT: "#23262D",
          foreground: "#E6E1E5",
        },

        primary: {
          DEFAULT: "#A8C7FA",
          foreground: "#102F50",
          container: "#284568",
          onContainer: "#D3E3FD",
        },

        secondary: {
          DEFAULT: "#C4C7C5",
          foreground: "#111318",
        },

        muted: {
          DEFAULT: "#1E2127",
          foreground: "#92959D",
        },

        accent: {
          DEFAULT: "#284568",
          foreground: "#D3E3FD",
        },

        destructive: {
          DEFAULT: "#F2B8B5",
          foreground: "#410E0B",
          container: "#410E0B",
        },

        border: "#30343B",
        input: "#30343B",
        ring: "#D3E3FD",

        /* K8s Status & M3 Tokens */
        canvas: {
          bg: "#111318",
          dot: "#2B2F36",
        },

        status: {
          running: "#6DD6A8",
          warning: "#F4C26B",
          error: "#F2B8B5",
          inactive: "#9AA0AA",
          idle: "#777D87",
        },

        k8s: {
          ingress: "#D0BCFF",
          service: "#8ACBFA",
          storageBound: "#80DEEA",
          storagePending: "#F4C26B",
          cronjob: "#F4C26B",
          edge: "#515660",
        },

        md: {
          primary: "#A8C7FA",
          onPrimary: "#102F50",
          primaryContainer: "#284568",
          onPrimaryContainer: "#D3E3FD",
          secondary: "#C4C7C5",
          surfaceVariant: "#30343B",
          outline: "#8E939D",
          outlineVariant: "#424750",
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
        courgette: ["'Courgette'", "cursive", "sans-serif"],
        mono: ["'Google Sans Code'", "'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },

  plugins: [],
};