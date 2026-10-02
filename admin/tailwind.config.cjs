/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ceylon Rent A Cars: white surfaces, black ink, red accents (matches the customer site)
        bg: '#EEEFF2',       // soft grey page background (cards stay white on top)
        surface: '#F7F7F8',  // sidebar / secondary panels
        // `navy` is kept as the class name used throughout the app, but it is now a
        // neutral ink scale: 50 = soft surface … 700 = brand black.
        navy: {
          50:  '#F4F4F5',
          100: '#E7E7EA',
          200: '#D4D4D8',
          300: '#A1A1AA',
          400: '#71717A',
          500: '#52525B',
          600: '#3F3F46',
          700: '#111114',
          800: '#0B0B0D',
          900: '#050506',
        },
        brand: {
          50:  '#FEF1F2',
          100: '#FDE0E2',
          200: '#FBC5C9',
          400: '#F04A55',
          500: '#E11D2A',
          600: '#C8141F',
          700: '#A3101A',
        },
        card: '#FFFFFF',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,17,20,0.04), 0 4px 16px rgba(17,17,20,0.05)',
        'card-hover': '0 2px 4px rgba(17,17,20,0.05), 0 12px 32px rgba(17,17,20,0.10)',
        brand: '0 8px 24px rgba(225,29,42,0.28)',
      },
      borderRadius: {
        xl2: '1.25rem',
        xl3: '1.5rem',
      },
    },
  },
  plugins: [],
}
