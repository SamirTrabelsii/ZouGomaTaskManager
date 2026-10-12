/** @type {import('tailwindcss').Config} */
// Night-study palette. Token names are kept from the original theme so components don't change:
//   cream-* = deep navy surfaces, ink-* = warm parchment text, moss-* = amber accent,
//   sky-500 = electric blue, clay-* = danger/overdue.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: { 50: '#141a36', 100: '#0e1328', 200: '#1e2750', 300: '#34427a' },
        ink: { 900: '#f6ead3', 700: '#dcd2bd', 500: '#a3add4', 400: '#7f8bb8' },
        moss: { 400: '#f2b96a', 500: '#eba14a', 600: '#b8651a', 700: '#9a5214' },
        wood: { 400: '#b98a5b', 500: '#a07048', 600: '#7d5333' },
        clay: { 400: '#ee7d6a', 500: '#d9553f', 600: '#ff8d78' },
        sky: { 500: '#62b4ff' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: { soft: '0 12px 40px -10px rgba(4,8,30,.75), 0 0 0 1px rgba(98,150,255,.08), 0 0 28px -8px rgba(255,160,70,.18)' },
    },
  },
  plugins: [],
};
