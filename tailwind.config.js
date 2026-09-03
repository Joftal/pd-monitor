/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#fb7299',
          light: '#fc8bab',
          dark: '#f0567f'
        },
        live: '#fb7299',
        // 语义化调色板: 由 styles.css 中的 CSS 变量驱动, .dark 下整体换值
        page: 'rgb(var(--c-page) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        ink1: 'rgb(var(--c-ink1) / <alpha-value>)',
        ink2: 'rgb(var(--c-ink2) / <alpha-value>)',
        ink3: 'rgb(var(--c-ink3) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        fill: 'rgb(var(--c-fill) / <alpha-value>)',
        fillh: 'rgb(var(--c-fillh) / <alpha-value>)'
      },
      boxShadow: {
        'glow-live': '0 0 0 1px rgba(251,114,153,.4), 0 10px 30px rgba(251,114,153,.18)',
        'glow-brand': '0 0 0 1px rgba(251,114,153,.35), 0 10px 26px rgba(251,114,153,.2)',
        card: '0 1px 2px var(--shadow-card)',
        'card-hover': '0 10px 28px var(--shadow-card-hover)'
      },
      keyframes: {
        breathe: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.45' }
        },
        pop: {
          '0%': { transform: 'scale(.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        }
      },
      animation: {
        breathe: 'breathe 1.6s ease-in-out infinite',
        pop: 'pop .18s ease-out both'
      }
    }
  },
  plugins: []
}
