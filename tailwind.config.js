/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lumina: {
          dark: '#08090D',
          card: '#10121A',
          elevated: '#171A26',
          input: '#1C2030',
          border: 'rgba(255, 255, 255, 0.08)',
          cyan: '#00F2FE',
          violet: '#9D4EDD',
          magenta: '#F72585',
          emerald: '#00F5A0',
          amber: '#FFB703',
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
