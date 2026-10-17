import defaultColors from 'tailwindcss/colors.js'
import plugin from 'tailwindcss/plugin.js'
import { BRAND } from './src/lib/brand.js'

// Dark theme support.
// Grays, light tints and status colors are exposed as CSS variables so that the
// existing utility classes (bg-gray-50, text-gray-900, bg-red-50, ...) switch
// palette when <html> has the `dark` class, without a `dark:` variant on every
// element. Strong shades used as button backgrounds (primary-600, red-600, ...)
// stay fixed; only their text usages are lightened in dark mode.

const SURFACE = [17, 26, 43] // card background in dark mode (#111a2b)
const STATUS_HUES = ['red', 'green', 'blue', 'amber', 'purple', 'orange']
const TINTS = [[50, 0.14], [100, 0.24], [200, 0.4]]

// Light value of each gray step, followed by its dark counterpart.
const GRAYS = {
  50: ['#f9fafb', [11, 18, 32]],
  100: ['#f3f4f6', [30, 41, 59]],
  200: ['#e5e7eb', [51, 65, 85]],
  300: ['#d1d5db', [71, 85, 105]],
  400: ['#9ca3af', [124, 138, 160]],
  500: ['#6b7280', [148, 163, 184]],
  600: ['#4b5563', [176, 188, 204]],
  700: ['#374151', [203, 213, 225]],
  800: ['#1f2937', [226, 232, 240]],
  900: ['#111827', [241, 245, 249]],
}

const PRIMARY_DARK = { 50: [22, 36, 64], 100: [28, 46, 80], 200: [45, 66, 105], 300: [82, 105, 136] }

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t))
const channels = (values) => values.join(' ')
const cssVar = (name) => `rgb(var(--${name}) / <alpha-value>)`

const lightVars = {}
const darkVars = {}
const colors = {
  primary: { ...BRAND.palette.primary },
  secondary: BRAND.palette.secondary,
  accent: BRAND.palette.accent,
  gray: {},
}

for (const [step, [light, dark]] of Object.entries(GRAYS)) {
  lightVars[`--gray-${step}`] = channels(rgb(light))
  darkVars[`--gray-${step}`] = channels(dark)
  colors.gray[step] = cssVar(`gray-${step}`)
}

for (const [step, dark] of Object.entries(PRIMARY_DARK)) {
  lightVars[`--primary-${step}`] = channels(rgb(BRAND.palette.primary[step]))
  darkVars[`--primary-${step}`] = channels(dark)
  colors.primary[step] = cssVar(`primary-${step}`)
}

for (const hue of STATUS_HUES) {
  colors[hue] = { ...defaultColors[hue] }
  for (const [step, strength] of TINTS) {
    lightVars[`--${hue}-${step}`] = channels(rgb(defaultColors[hue][step]))
    darkVars[`--${hue}-${step}`] = channels(mix(SURFACE, rgb(defaultColors[hue][500]), strength))
    colors[hue][step] = cssVar(`${hue}-${step}`)
  }
}

// Text colors that are too dark to read on a dark background.
const darkTextOverrides = {}
const lighten = (classes, color) => {
  for (const name of classes) {
    darkTextOverrides[`.dark .text-${name}, .dark .hover\\:text-${name}:hover, .dark .focus\\:text-${name}:focus`] = { color }
  }
}
for (const hue of STATUS_HUES) {
  lighten([500, 600].map((step) => `${hue}-${step}`), defaultColors[hue][400])
  lighten([700, 800, 900].map((step) => `${hue}-${step}`), defaultColors[hue][300])
}
lighten(['primary-500', 'primary-600', 'primary-700', 'primary-800'], '#a9bde0')

export const themeColors = colors

export const darkThemePlugin = plugin(({ addBase }) => {
  addBase({
    ':root': { ...lightVars, colorScheme: 'light' },
    '.dark': { ...darkVars, colorScheme: 'dark' },
    ...darkTextOverrides,
    '.dark .border-primary-500, .dark .border-primary-600': { borderColor: '#7f98c4' },
    '.dark .bg-white, .dark .focus\\:bg-white:focus': { backgroundColor: `rgb(${channels(SURFACE)})` },
  })
})
