/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lumina: {
          dark: '#08090D',
          light: '#F8FAFC',
          card: '#10121A',
          cardLight: '#FFFFFF',
          elevated: '#171A26',
          elevatedLight: '#F1F5F9',
          input: '#1C2030',
          inputLight: '#E2E8F0',
          border: 'rgba(255, 255, 255, 0.08)',
          borderLight: 'rgba(0, 0, 0, 0.08)',
          cyan: '#00F2FE',
          violet: '#9D4EDD',
          magenta: '#F72585',
          emerald: '#00F5A0',
          amber: '#FFB703',
          sunset: '#FF6B6B',
          amethyst: '#845EC2',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-spin': 'glowSpin 6s linear infinite',
      },
      keyframes: {
        glowSpin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        }
      }
    },
  },
  plugins: [],
}
