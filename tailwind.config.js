/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tông chủ đạo: slate tối, đỏ thẫm, tím than
        ink: {
          950: '#07080d',
          900: '#0b0d14',
          850: '#0f121b',
          800: '#141824',
          700: '#1c2130',
          600: '#272d3f',
          500: '#363d53'
        },
        blood: {
          300: '#f07a8a',
          400: '#e04a5f',
          500: '#b3122e',
          600: '#8f0e25',
          700: '#6d0a1c'
        },
        night: {
          400: '#8b74c9',
          500: '#5b4691',
          600: '#3d2f63',
          700: '#2a1f45'
        }
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Inter', 'Arial', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
