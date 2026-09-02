/** @type {import('tailwindcss').Config} */
module.exports = {
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
        page: '#f1f2f3',
        ink1: '#18191c',
        ink2: '#61666d',
        ink3: '#9499a0',
        line: '#e3e5e7'
      },
      boxShadow: {
        'glow-live': '0 0 0 1px rgba(251,114,153,.4), 0 10px 30px rgba(251,114,153,.18)',
        'glow-brand': '0 0 0 1px rgba(251,114,153,.35), 0 10px 26px rgba(251,114,153,.2)',
        card: '0 1px 2px rgba(0,0,0,.05)',
        'card-hover': '0 10px 28px rgba(0,0,0,.1)'
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
