export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b10",
        panel: "#12121a",
        panel2: "#181827",
        accent: "#8b3f7f",
        accent2: "#b26aa8",
        text: "#e9e9f2",
        muted: "#a7a7b6",
      },
      borderRadius: { xl2: "1.25rem" },
      boxShadow: { glow: "0 0 0 1px rgba(178,106,168,.35), 0 0 30px rgba(178,106,168,.12)" },
    },
  },
  plugins: [],
};
