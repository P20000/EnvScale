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
        foreground: "#f4f4f5",

        card: {
          DEFAULT: "#141417",
          foreground: "#f4f4f5",
        },

        popover: {
          DEFAULT: "#141417",
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

        /* Design.md Design System Tokens */
        canvas: {
          bg: "#09090b",
          dot: "#27272a",
        },

        surface: {
          capsule: "rgba(23, 23, 23, 0.85)",
          card: "#141417",
          drawer: "#141417",
        },

        status: {
          running: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          inactive: "#6b7280",
        },
      },

      boxShadow: {
        "capsule": "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
        "drawer": "-10px 0 30px rgba(0, 0, 0, 0.5)",
      },

      borderRadius: {
        "xl": "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },

      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "'Plus Jakarta Sans Variable'", "system-ui", "-apple-system", "sans-serif"],
        heading: ["'Google Sans'", "'Plus Jakarta Sans'", "sans-serif"],
        mono: ["'Google Sans Code'", "'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },

  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        ".glass-capsule": {
          background: "rgba(23, 23, 23, 0.85)",
          backdropFilter: "blur(12px)",
          "-webkit-backdrop-filter": "blur(12px)",
          border: "1px solid rgba(39, 39, 42, 0.8)",
        },
        ".glass-card": {
          background: "#141417",
          border: "1px solid #27272a",
          boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.5)",
        },
      });
    },
  ],
};