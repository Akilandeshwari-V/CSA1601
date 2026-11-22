// Theme registry. CSS variables live in styles.css ([data-theme="..."]); this file holds the values that charts
// (Recharts, Three.js) need as raw hex, and applies a theme to the page.
export const THEMES = {
  midnight: {
    label: 'Midnight', swatch: ['#7c6cff', '#22d3ee'], scheme: 'dark',
    colors: { primary: '#8b7dff', primaryDark: '#5b4bdb', amber: '#fbbf24', teal: '#22d3ee', red: '#ff6b6b', ink: '#e8ecff', muted: '#93a0cf', grid: '#27315f',
      series: ['#8b7dff', '#22d3ee', '#fbbf24', '#ff6b6b', '#a78bfa', '#38bdf8', '#f59e0b', '#94a3b8', '#818cf8', '#f472b6'] },
  },
  pearl: {
    label: 'Pearl', swatch: ['#5b4bdb', '#0891b2'], scheme: 'light',
    colors: { primary: '#5b4bdb', primaryDark: '#3f32a8', amber: '#f59e0b', teal: '#0891b2', red: '#dc4b4b', ink: '#161a33', muted: '#5d6486', grid: '#e2e5f2',
      series: ['#5b4bdb', '#0891b2', '#f59e0b', '#dc4b4b', '#8b5cf6', '#0ea5e9', '#d97706', '#64748b', '#6366f1', '#db2777'] },
  },
  graphite: {
    label: 'Graphite', swatch: ['#d6a84a', '#e8e2d0'], scheme: 'dark',
    colors: { primary: '#d6a84a', primaryDark: '#b88a2e', amber: '#f2c35b', teal: '#7aa2f7', red: '#ef6f6f', ink: '#f1efe8', muted: '#a09d92', grid: '#2b2e38',
      series: ['#d6a84a', '#7aa2f7', '#e8e2d0', '#ef6f6f', '#b794f4', '#4fd1c5', '#f6ad55', '#8f96a3', '#9ae6b4', '#f687b3'] },
  },
};
export const DEFAULT_THEME = 'midnight';

// Live object: charts read these on every render, applyTheme() overwrites them.
export const COLORS = { ...THEMES[DEFAULT_THEME].colors };
export const AXIS_COLORS = ['#ff9f43', '#2ee6c5', '#b78cff']; // X, Y, Z axes inside the 3D cube (the cube viewport is dark in every theme)

export function applyTheme(name) {
  const t = THEMES[name] ? name : DEFAULT_THEME;
  Object.assign(COLORS, THEMES[t].colors);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sdm-theme', t); } catch { /* storage may be blocked; the theme still applies for this visit */ }
  return t;
}
export function initialTheme() {
  let t = DEFAULT_THEME;
  try { t = localStorage.getItem('sdm-theme') || DEFAULT_THEME; } catch { /* ignore */ }
  return applyTheme(t);
}
