import type { Config } from 'tailwindcss';

/**
 * Checkpoint editorial palette — a warm cream backdrop with near-black
 * typography, a refined rust accent, and quiet borders. Inspired by
 * scientific journals and the usecheckpoint.dev landing page.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './ui/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1280px' }
    },
    extend: {
      colors: {
        cream: {
          50: '#FBF9F2',
          100: '#F7F5EE',
          200: '#F1EEE3',
          300: '#E5E2D6',
          400: '#D8D4C5'
        },
        ink: {
          50: '#605C56',
          100: '#4D4A45',
          200: '#3A3833',
          300: '#272522',
          400: '#1A1916',
          500: '#0F0E0C'
        },
        accent: {
          50: '#F7E5E5',
          100: '#EBC1C1',
          400: '#B33B3B',
          500: '#9F2B2B',
          600: '#7C2222'
        },
        success: {
          400: '#3A8967',
          500: '#2A6B4D',
          600: '#1F5239'
        },
        warning: {
          50: '#FAF1DA',
          400: '#C58F2A',
          500: '#A07112',
          600: '#7A5707'
        }
      },
      fontFamily: {
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      },
      letterSpacing: {
        tightest: '-0.04em'
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 14, 12, 0.04), 0 4px 12px rgba(15, 14, 12, 0.04)',
        ring: '0 0 0 1px rgba(15, 14, 12, 0.08)'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
};

export default config;
