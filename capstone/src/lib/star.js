// Star schema – reproduced from SmartDMart_Star_Schema.drawio (table and column names kept exactly).
import { toCSV } from './format.js';

export const SCHEMA = {
  FACT_SALES: {
    kind: 'fact',
    columns: [
      { name: 'Sales_ID', pk: true }, { name: 'Product_Key', fk: 'DIM_PRODUCT' }, { name: 'Date_Key', fk: 'DIM_DATE' },
      { name: 'Store_Key', fk: 'DIM_STORE' }, { name: 'Payment_Key', fk: 'DIM_PAYMENT' }, { name: 'Customer_Type_Key', fk: 'DIM_CUSTOMER_TYPE' },
      { name: 'Quantity' }, { name: 'Sales' }, { name: 'Cost' }, { name: 'Profit' },
    ],
  },
  DIM_PRODUCT: { kind: 'dim', columns: [{ name: 'Product_Key', pk: true }, { name: 'Product' }, { name: 'Category' }, { name: 'Brand' }] },
  DIM_DATE: { kind: 'dim', columns: [{ name: 'Date_Key', pk: true }, { name: 'Order_Date' }, { name: 'Day' }, { name: 'Month' }, { name: 'Quarter' }, { name: 'Year' }] },
  DIM_STORE: { kind: 'dim', columns: [{ name: 'Store_Key', pk: true }, { name: 'Store' }, { name: 'City' }] },
  DIM_PAYMENT: { kind: 'dim', columns: [{ name: 'Payment_Key', pk: true }, { name: 'Payment_Method' }] },
  DIM_CUSTOMER_TYPE: { kind: 'dim', columns: [{ name: 'Customer_Type_Key', pk: true }, { name: 'Customer_Type' }] },
};

export const RELATIONSHIPS = [
  { from: 'DIM_PRODUCT', to: 'FACT_SALES', key: 'Product_Key' },
  { from: 'DIM_DATE', to: 'FACT_SALES', key: 'Date_Key' },
  { from: 'DIM_STORE', to: 'FACT_SALES', key: 'Store_Key' },
  { from: 'DIM_PAYMENT', to: 'FACT_SALES', key: 'Payment_Key' },
  { from: 'DIM_CUSTOMER_TYPE', to: 'FACT_SALES', key: 'Customer_Type_Key' },
];

/** Build the star schema tables (with surrogate keys) from the cleaned rows – the "load" step of ETL. */
export function buildStar(rows) {
  const assign = (keyFn, build, sortFn) => {
    const uniq = new Map();
    rows.forEach((r) => { const k = keyFn(r); if (!uniq.has(k)) uniq.set(k, build(r)); });
    const list = [...uniq.entries()].sort(sortFn);
    const map = new Map();
    const table = list.map(([k, v], i) => { map.set(k, i + 1); return { key: i + 1, ...v }; });
    return { table, map };
  };
  const str = (a, b) => a[0].localeCompare(b[0], 'en', { numeric: true });
  const prod = assign((r) => [r.category, r.brand, r.product].join('|'), (r) => ({ Product: r.product, Category: r.category, Brand: r.brand }), str);
  const store = assign((r) => [r.store, r.city].join('|'), (r) => ({ Store: r.store, City: r.city }), str);
  const pay = assign((r) => r.payment, (r) => ({ Payment_Method: r.payment }), str);
  const cust = assign((r) => r.customer, (r) => ({ Customer_Type: r.customer }), str);
  const dateMap = new Map();
  rows.forEach((r) => {
    const k = Number(r.date.replaceAll('-', ''));
    if (!dateMap.has(k)) dateMap.set(k, { Date_Key: k, Order_Date: r.date, Day: r.day, Month: r.month, Quarter: r.quarter, Year: r.year });
  });
  const FACT_SALES = rows.map((r) => ({
    Sales_ID: r.id,
    Product_Key: prod.map.get([r.category, r.brand, r.product].join('|')),
    Date_Key: Number(r.date.replaceAll('-', '')),
    Store_Key: store.map.get([r.store, r.city].join('|')),
    Payment_Key: pay.map.get(r.payment),
    Customer_Type_Key: cust.map.get(r.customer),
    Quantity: r.qty, Sales: r.sales, Cost: r.cost, Profit: r.profit,
  }));
  return {
    FACT_SALES,
    DIM_PRODUCT: prod.table.map(({ key, ...v }) => ({ Product_Key: key, ...v })),
    DIM_DATE: [...dateMap.values()].sort((a, b) => a.Date_Key - b.Date_Key),
    DIM_STORE: store.table.map(({ key, ...v }) => ({ Store_Key: key, ...v })),
    DIM_PAYMENT: pay.table.map(({ key, ...v }) => ({ Payment_Key: key, ...v })),
    DIM_CUSTOMER_TYPE: cust.table.map(({ key, ...v }) => ({ Customer_Type_Key: key, ...v })),
  };
}

export const tableCSV = (name, data) => toCSV(SCHEMA[name].columns.map((c) => c.name), data[name]);

/** Referential-integrity check used by the UI and the tests. */
export function checkIntegrity(star) {
  const out = [];
  for (const rel of RELATIONSHIPS) {
    const keys = new Set(star[rel.from].map((r) => r[rel.key]));
    const orphans = star.FACT_SALES.filter((f) => !keys.has(f[rel.key])).length;
    out.push({ ...rel, orphans, ok: orphans === 0 });
  }
  return out;
}

// ======================================================================== SNOWFLAKE SCHEMA
// The star schema's dimension tables are normalised: Product → Brand → Category, Date → Month → Quarter → Year, Store → City.
const col = (name, o = {}) => ({ name, ...o });
export const SNOWFLAKE_SCHEMA = {
  FACT_SALES: SCHEMA.FACT_SALES,
  DIM_PRODUCT: { kind: 'dim', level: 1, columns: [col('Product_Key', { pk: true }), col('Product'), col('Brand_Key', { fk: 'DIM_BRAND' })] },
  DIM_BRAND: { kind: 'dim', level: 2, columns: [col('Brand_Key', { pk: true }), col('Brand'), col('Category_Key', { fk: 'DIM_CATEGORY' })] },
  DIM_CATEGORY: { kind: 'dim', level: 3, columns: [col('Category_Key', { pk: true }), col('Category')] },
  DIM_DATE: { kind: 'dim', level: 1, columns: [col('Date_Key', { pk: true }), col('Order_Date'), col('Day'), col('Month_Key', { fk: 'DIM_MONTH' })] },
  DIM_MONTH: { kind: 'dim', level: 2, columns: [col('Month_Key', { pk: true }), col('Month'), col('Quarter_Key', { fk: 'DIM_QUARTER' })] },
  DIM_QUARTER: { kind: 'dim', level: 3, columns: [col('Quarter_Key', { pk: true }), col('Quarter'), col('Year_Key', { fk: 'DIM_YEAR' })] },
  DIM_YEAR: { kind: 'dim', level: 4, columns: [col('Year_Key', { pk: true }), col('Year')] },
  DIM_STORE: { kind: 'dim', level: 1, columns: [col('Store_Key', { pk: true }), col('Store'), col('City_Key', { fk: 'DIM_CITY' })] },
  DIM_CITY: { kind: 'dim', level: 2, columns: [col('City_Key', { pk: true }), col('City')] },
  DIM_PAYMENT: SCHEMA.DIM_PAYMENT,
  DIM_CUSTOMER_TYPE: SCHEMA.DIM_CUSTOMER_TYPE,
};
export const SNOWFLAKE_RELATIONSHIPS = [
  ...RELATIONSHIPS,
  { from: 'DIM_BRAND', to: 'DIM_PRODUCT', key: 'Brand_Key' },
  { from: 'DIM_CATEGORY', to: 'DIM_BRAND', key: 'Category_Key' },
  { from: 'DIM_MONTH', to: 'DIM_DATE', key: 'Month_Key' },
  { from: 'DIM_QUARTER', to: 'DIM_MONTH', key: 'Quarter_Key' },
  { from: 'DIM_YEAR', to: 'DIM_QUARTER', key: 'Year_Key' },
  { from: 'DIM_CITY', to: 'DIM_STORE', key: 'City_Key' },
];

export function buildSnowflake(rows) {
  const star = buildStar(rows);
  const seq = (list, keyFn) => { const m = new Map(); list.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, m.size + 1); }); return m; };
  const cats = [...new Set(star.DIM_PRODUCT.map((p) => p.Category))].sort();
  const catKey = new Map(cats.map((c, i) => [c, i + 1]));
  const brandPairs = [...new Map(star.DIM_PRODUCT.map((p) => [p.Category + '|' + p.Brand, p])).values()].sort((a, b) => (a.Category + a.Brand).localeCompare(b.Category + b.Brand));
  const brandKey = new Map(brandPairs.map((p, i) => [p.Category + '|' + p.Brand, i + 1]));
  const cities = [...new Set(star.DIM_STORE.map((s) => s.City))].sort();
  const cityKey = new Map(cities.map((c, i) => [c, i + 1]));
  const months = [...new Map(star.DIM_DATE.map((d) => [d.Year * 100 + d.Month, d])).values()].sort((a, b) => a.Year * 100 + a.Month - (b.Year * 100 + b.Month));
  const quarters = [...new Map(star.DIM_DATE.map((d) => [d.Year * 10 + d.Quarter, d])).values()].sort((a, b) => a.Year * 10 + a.Quarter - (b.Year * 10 + b.Quarter));
  const years = [...new Set(star.DIM_DATE.map((d) => d.Year))].sort();
  void seq;
  return {
    FACT_SALES: star.FACT_SALES,
    DIM_PRODUCT: star.DIM_PRODUCT.map((p) => ({ Product_Key: p.Product_Key, Product: p.Product, Brand_Key: brandKey.get(p.Category + '|' + p.Brand) })),
    DIM_BRAND: brandPairs.map((p) => ({ Brand_Key: brandKey.get(p.Category + '|' + p.Brand), Brand: p.Brand, Category_Key: catKey.get(p.Category) })),
    DIM_CATEGORY: cats.map((c) => ({ Category_Key: catKey.get(c), Category: c })),
    DIM_DATE: star.DIM_DATE.map((d) => ({ Date_Key: d.Date_Key, Order_Date: d.Order_Date, Day: d.Day, Month_Key: d.Year * 100 + d.Month })),
    DIM_MONTH: months.map((d) => ({ Month_Key: d.Year * 100 + d.Month, Month: d.Month, Quarter_Key: d.Year * 10 + d.Quarter })),
    DIM_QUARTER: quarters.map((d) => ({ Quarter_Key: d.Year * 10 + d.Quarter, Quarter: d.Quarter, Year_Key: d.Year })),
    DIM_YEAR: years.map((y) => ({ Year_Key: y, Year: y })),
    DIM_STORE: star.DIM_STORE.map((s) => ({ Store_Key: s.Store_Key, Store: s.Store, City_Key: cityKey.get(s.City) })),
    DIM_CITY: cities.map((c) => ({ City_Key: cityKey.get(c), City: c })),
    DIM_PAYMENT: star.DIM_PAYMENT,
    DIM_CUSTOMER_TYPE: star.DIM_CUSTOMER_TYPE,
  };
}

export const snowflakeCSV = (name, data) => toCSV(SNOWFLAKE_SCHEMA[name].columns.map((c) => c.name), data[name]);

/** Generic integrity check: every child row must reference an existing parent row. */
export function checkModelIntegrity(data, rels) {
  return rels.map((rel) => {
    const keys = new Set(data[rel.from].map((r) => r[rel.key]));
    const orphans = data[rel.to].filter((r) => !keys.has(r[rel.key])).length;
    return { ...rel, orphans, ok: orphans === 0 };
  });
}
