import type { Config } from "tailwindcss";
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ["./src/**/*.{ts,tsx}"],
  // dark: follows the chosen theme (data-theme), or the system setting when "auto" is chosen
  darkMode: ["variant", ["&:is([data-theme=dark] *)", "@media (prefers-color-scheme: dark) { &:not([data-theme=light] *) }"]],
  theme: {
    extend: {
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"], serif: ["var(--font-sans)"] },
      colors: {
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        paper: v("paper"), card: v("card"), sunken: v("sunken"), line: v("line"), "line-2": v("line-2"), side: { DEFAULT: v("side"), 2: v("side-2") },
        accent: { DEFAULT: v("accent"), 600: v("accent-600"), soft: v("accent-soft"), ring: v("accent"), 2: v("accent-2"), 3: v("accent-3") },
        good: { DEFAULT: v("good"), soft: v("good-soft") }, warn: { DEFAULT: v("warn"), soft: v("warn-soft") },
        bad: { DEFAULT: v("bad"), soft: v("bad-soft") }, em: { DEFAULT: v("em"), soft: v("em-soft") },
      },
      boxShadow: { card: "var(--shadow-card)", pop: "0 10px 25px -5px rgb(0 0 0 / .12), 0 8px 10px -6px rgb(0 0 0 / .08)", glow: "0 10px 26px -8px rgb(var(--accent) / .7)" },
      borderRadius: { xl: "14px", "2xl": "16px", "3xl": "20px", lg: "12px", md: "8px" },
    },
  },
  plugins: [],
} satisfies Config;
