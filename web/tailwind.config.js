/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      colors: {
        acid: { DEFAULT: '#dc2626', light: '#fecaca', dark: '#7f1d1d' },
        weakacid: { DEFAULT: '#ea580c', light: '#fed7aa', dark: '#7c2d12' },
        nonacid: { DEFAULT: '#0284c7', light: '#bae6fd', dark: '#0c4a6e' },
        severity: {
          mild: '#16a34a',
          moderate: '#ea580c',
          severe: '#dc2626',
        },
      },
    },
  },
  plugins: [],
}
