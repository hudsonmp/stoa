import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#FAFAF7",
          secondary: "#F3F1EC",
          sidebar: "#F7F6F3",
          shelf: "#E8E4DC",
        },
        text: {
          primary: "#1C1917",
          secondary: "#78716C",
          tertiary: "#A8A29E",
        },
        accent: {
          DEFAULT: "#C2410C",
          hover: "#9A3412",
          green: "#4D7C0F",
          amber: "#B45309",
        },
        border: {
          DEFAULT: "#E7E5E4",
          light: "#F5F5F4",
        },
      },
      fontFamily: {
        serif: ['"Newsreader"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      boxShadow: {
        warm: "0 1px 3px rgba(28, 25, 23, 0.04), 0 1px 2px rgba(28, 25, 23, 0.06)",
        "warm-md":
          "0 4px 6px rgba(28, 25, 23, 0.04), 0 2px 4px rgba(28, 25, 23, 0.06)",
        "warm-lg":
          "0 10px 15px rgba(28, 25, 23, 0.04), 0 4px 6px rgba(28, 25, 23, 0.06)",
        shelf:
          "0 4px 12px rgba(28, 25, 23, 0.08), 0 2px 4px rgba(28, 25, 23, 0.04)",
      },
      borderRadius: {
        card: "2px",
        modal: "3px",
        tag: "1px",
      },
      spacing: {
        "section": "3rem",
      },
    },
  },
  plugins: [],
};

export default config;
