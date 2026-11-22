export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const e = m.get(k) || { name: k, sales: 0, profit: 0, qty: 0, orders: 0 };
    e.sales += r.sales; e.profit += r.profit; e.qty += r.qty; e.orders++;
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ ...e, margin: e.sales ? e.profit / e.sales : 0 }));
}

export function kpis(rows) {
  const t = rows.reduce((a, r) => ({ sales: a.sales + r.sales, profit: a.profit + r.profit, qty: a.qty + r.qty }), { sales: 0, profit: 0, qty: 0 });
  return { ...t, orders: rows.length, margin: t.sales ? t.profit / t.sales : 0, aov: rows.length ? t.sales / rows.length : 0 };
}

export const bySalesDesc = (a, b) => b.sales - a.sales;
