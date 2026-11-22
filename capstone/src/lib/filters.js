export const FILTER_FIELDS = [
  { id: 'category', label: 'Category', key: 'category' },
  { id: 'store', label: 'Store', key: 'store' },
  { id: 'city', label: 'City', key: 'city' },
  { id: 'payment', label: 'Payment method', key: 'payment' },
  { id: 'customer', label: 'Customer type', key: 'customer' },
];

export const emptyFilters = () => ({ from: '', to: '', category: [], store: [], city: [], payment: [], customer: [] });

export function applyGlobal(rows, f) {
  const sets = FILTER_FIELDS.map((x) => [x.key, new Set(f[x.id])]).filter(([, s]) => s.size);
  return rows.filter((r) => {
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    for (const [key, set] of sets) if (!set.has(r[key])) return false;
    return true;
  });
}

export const countActive = (f) => (f.from ? 1 : 0) + (f.to ? 1 : 0) + FILTER_FIELDS.reduce((a, x) => a + (f[x.id].length ? 1 : 0), 0);

export const distinct = (rows, key) => [...new Set(rows.map((r) => r[key]))].sort((a, b) => a.localeCompare(b, 'en'));
