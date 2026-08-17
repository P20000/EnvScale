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
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },

        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },

        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },

        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },

        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "#ffffff",
        },

        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",

        /* EnvScale palette */
        env: {
          navy: "#080f1f",
          panel: "#0d1729",
          card: "#101c30",
          surface: "#16243a",
          border: "#203552",
        },

        neon: {
          cyan: "#00e5ff",
          blue: "#008cff",
          purple: "#8b5cf6",
          green: "#39ff14",
          pink: "#ff00ff",
        },
      },

      boxShadow: {
        "neon-cyan":
          "0 0 12px rgba(0, 229, 255, 0.35)",

        "neon-blue":
          "0 0 12px rgba(0, 140, 255, 0.35)",

        "neon-purple":
          "0 0 12px rgba(139, 92, 246, 0.35)",

        "glass":
          "0 10px 30px rgba(0, 0, 0, 0.35)",
      },

      borderRadius: {
        xl: "0.75rem",
      },
    },
  },

  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        ".glass-card": {
          background: "rgba(15, 27, 48, 0.72)",
          backdropFilter: "blur(14px)",
          "-webkit-backdrop-filter": "blur(14px)",
          border: "1px solid rgba(56, 189, 248, 0.18)",
          borderRadius: "0.75rem",
        },
      });
    },
  ],
};