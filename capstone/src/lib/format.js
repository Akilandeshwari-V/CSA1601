// Currency is a property of the loaded dataset (INR for the bundled DMart file). setCurrency() is called once per dataset load.
export const CURRENCIES = {
  INR: { symbol: '₹', locale: 'en-IN', label: 'Indian rupee (₹)' },
  USD: { symbol: '$', locale: 'en-US', label: 'US dollar ($)' },
  EUR: { symbol: '€', locale: 'en-IE', label: 'Euro (€)' },
  GBP: { symbol: '£', locale: 'en-GB', label: 'Pound sterling (£)' },
};
let cur = CURRENCIES.INR;
let nf = null;
const build = () => ({
  int: new Intl.NumberFormat(cur.locale, { maximumFractionDigits: 0 }),
  two: new Intl.NumberFormat(cur.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  compact: new Intl.NumberFormat(cur.locale, { notation: 'compact', maximumFractionDigits: 2 }),
});
nf = build();
export function setCurrency(code) { cur = CURRENCIES[code] || CURRENCIES.INR; nf = build(); }
export const currencySymbol = () => cur.symbol;
export const numLocale = () => cur.locale;

export const fmtMoney = (v) => cur.symbol + nf.int.format(Math.round(v || 0));
export const fmtMoney2 = (v) => cur.symbol + nf.two.format(v || 0);
export const fmtCompactMoney = (v) => cur.symbol + nf.compact.format(v || 0);
export const fmtInt = (v) => nf.int.format(Math.round(v || 0));
export const fmtPct = (v, d = 1) => ((v || 0) * 100).toFixed(d) + '%';

export const MEASURES = {
  sales: { id: 'sales', label: 'Total Sales', short: 'Sales' },
  profit: { id: 'profit', label: 'Total Profit', short: 'Profit' },
  qty: { id: 'qty', label: 'Total Quantity', short: 'Quantity' },
};
export const fmtMeasure = (m, v) => (m === 'qty' ? fmtInt(v) : fmtMoney(v));

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\uFEFF' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n');
}
