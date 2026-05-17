import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#F5EFE4",
          secondary: "#EFE7D9",
          sidebar: "#F2EBDC",
          shelf: "#E3D9C5",
          editor: "#F8F2E6",
        },
        text: {
          primary: "#1C1917",
          secondary: "#57534E",
          tertiary: "#A8A29E",
        },
        accent: {
          DEFAULT: "#C2410C",
          hover: "#9A3412",
          green: "#4D7C0F",
          amber: "#B45309",
        },
        border: {
          DEFAULT: "#E0D8C8",
          light: "#ECE5D4",
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
