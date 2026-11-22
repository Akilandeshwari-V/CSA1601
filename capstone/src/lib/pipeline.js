// ETL step of the website: validate + clean the raw DMart CSV (the in-browser equivalent of the KNIME cleaning stage).
import { parseCSV } from './csv.js';
import { applyMapping } from './mapping.js';

export const REQUIRED = ['Order_ID', 'Order_Date', 'Store', 'City', 'Product', 'Category', 'Brand',
  'Quantity', 'Sales', 'Cost', 'Profit', 'Payment_Method', 'Customer_Type'];
const TEXT = ['Store', 'City', 'Product', 'Category', 'Brand', 'Payment_Method', 'Customer_Type'];
const TOL = 0.05; // rupee tolerance for arithmetic consistency checks

export const RULES = [
  { id: 'R1', kind: 'Reject', rule: 'Order_Date must be a real calendar date (dd-mm-yyyy, dd/mm/yyyy or yyyy-mm-dd).', why: 'A row without a valid date cannot be placed in the Time dimension.' },
  { id: 'R2', kind: 'Reject', rule: 'Quantity, Sales, Cost and Profit must be numbers; Quantity > 0, Sales > 0, Cost ≥ 0.', why: 'Zero quantity or negative sales would distort every KPI.' },
  { id: 'R3', kind: 'Reject', rule: 'Selling_Price must be > 0 and Discount_% must be between 0 and 100 (when those columns exist).', why: 'A negative price or a discount above 100% is impossible.' },
  { id: 'R4', kind: 'Reject', rule: 'Sales must equal Selling_Price × Quantity and Profit must equal Sales − Cost (±0.05; ±1% of sales for mapped files).', why: 'Inconsistent arithmetic means one of the numbers is wrong and we cannot tell which.' },
  { id: 'R5', kind: 'Reject', rule: 'Order_ID, Store, City and Product must not be empty; Order_ID must be unique (first occurrence kept).', why: 'These identify the fact row and its dimension members.' },
  { id: 'F1', kind: 'Repair', rule: 'Trim leading/trailing spaces and collapse repeated spaces in all text fields.', why: '" Nagpur " and "Nagpur" would otherwise become two cities.' },
  { id: 'F2', kind: 'Repair', rule: 'Unify spelling/case variants of the same value (most frequent spelling wins).', why: 'Keeps dimension members unique.' },
  { id: 'F3', kind: 'Repair', rule: 'If a Product has one Category/Brand in ≥ 90% of its rows, an empty or conflicting value on a row is replaced by it.', why: 'Product → Category/Brand is a functional dependency in DIM_PRODUCT.' },
  { id: 'F4', kind: 'Default', rule: 'Empty Payment_Method or Customer_Type becomes "Unknown" (the row is kept).', why: 'Sales and profit are still valid, only a descriptive attribute is missing.' },
];

export function parseDate(s) {
  const t = String(s ?? '').trim();
  let d, m, y;
  let mt = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else if ((mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { iso: `${y}-${pad(m)}-${pad(d)}`, year: y, month: m, day: d, quarter: Math.ceil(m / 3), weekday: dt.getUTCDay() };
}

export function parseNumber(s) {
  if (s == null) return NaN;
  const t = String(s).replace(/[₹$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * cleanDataset(text)                      → the DMart layout (exact column names), strict rules.
 * cleanDataset(text, { mapping, ... })    → any retail CSV: columns are mapped/derived first, then the same rules run.
 * options: { mapping, dateOrder: 'auto'|'dmy'|'mdy', currency }
 */
export function cleanDataset(text, options = {}) {
  const parsed = parseCSV(text);
  let { header, records } = parsed;
  let notes = [];
  const mapped = !!options.mapping;
  if (mapped) {
    const m = applyMapping(records, options.mapping, { dateOrder: options.dateOrder, srcWidth: header.length });
    notes = m.notes; header = m.header; records = m.records;
  }
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error('Missing required column(s): ' + missing.join(', '));
  const hasSell = header.includes('Selling_Price');
  const hasDisc = header.includes('Discount_%');
  const hasOrig = header.includes('Original_Price');

  const issues = [];
  const log = (rec, line, field, problem, action, before = '', after = '') =>
    issues.push({ orderId: rec.Order_ID || '(blank)', line, field, problem, action, before, after });

  const work = records.map((raw, idx) => ({ raw: { ...raw }, src: raw, line: idx + 2, repaired: false }));

  // F1 – whitespace
  for (const w of work) {
    for (const f of TEXT) {
      const before = w.raw[f] ?? '';
      const after = clean(before);
      if (after !== before) { w.raw[f] = after; w.repaired = true; log(w.raw, w.line, f, 'Extra spaces', 'Repaired (F1)', before, after); }
    }
  }
  // F2 – spelling / case variants
  for (const f of TEXT) {
    const freq = new Map();
    for (const w of work) {
      const v = w.raw[f]; if (!v) continue;
      const k = v.toLowerCase();
      if (!freq.has(k)) freq.set(k, new Map());
      freq.get(k).set(v, (freq.get(k).get(v) || 0) + 1);
    }
    const canon = new Map();
    for (const [k, variants] of freq) canon.set(k, [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    for (const w of work) {
      const v = w.raw[f]; if (!v) continue;
      const c = canon.get(v.toLowerCase());
      if (c !== v) { log(w.raw, w.line, f, 'Spelling/case variant', 'Repaired (F2)', v, c); w.raw[f] = c; w.repaired = true; }
    }
  }

  // Validation (R1–R5)
  const seen = new Set();
  const accepted = [];
  let rejected = 0;
  for (const w of work) {
    const r = w.raw;
    const reasons = [];
    const date = parseDate(r.Order_Date);
    if (!date) reasons.push(['Order_Date', 'Invalid date', r.Order_Date, 'R1']);
    const n = {};
    for (const f of ['Quantity', 'Sales', 'Cost', 'Profit']) {
      n[f] = parseNumber(r[f]);
      if (Number.isNaN(n[f])) reasons.push([f, 'Not a number', r[f], 'R2']);
    }
    if (!Number.isNaN(n.Quantity) && n.Quantity <= 0) reasons.push(['Quantity', 'Quantity must be > 0', r.Quantity, 'R2']);
    if (!Number.isNaN(n.Sales) && n.Sales <= 0) reasons.push(['Sales', 'Sales must be > 0', r.Sales, 'R2']);
    if (!Number.isNaN(n.Cost) && n.Cost < 0) reasons.push(['Cost', 'Cost must be ≥ 0', r.Cost, 'R2']);
    const sp = hasSell ? parseNumber(r.Selling_Price) : NaN;
    const dc = hasDisc ? parseNumber(r['Discount_%']) : NaN;
    const op = hasOrig ? parseNumber(r.Original_Price) : NaN;
    if (hasSell && r.Selling_Price !== '' && (Number.isNaN(sp) || sp <= 0)) reasons.push(['Selling_Price', 'Selling price must be > 0', r.Selling_Price, 'R3']);
    if (hasDisc && r['Discount_%'] !== '' && (Number.isNaN(dc) || dc < 0 || dc > 100)) reasons.push(['Discount_%', 'Discount must be 0–100', r['Discount_%'], 'R3']);
    if (!reasons.length) {
      if (hasSell && !Number.isNaN(sp) && Math.abs(sp * n.Quantity - n.Sales) > (mapped ? Math.max(TOL, 0.01 * n.Sales) : TOL)) reasons.push(['Sales', 'Sales ≠ Selling_Price × Quantity', r.Sales, 'R4']);
      if (Math.abs(n.Sales - n.Cost - n.Profit) > (mapped ? Math.max(TOL, 0.01 * n.Sales) : TOL)) reasons.push(['Profit', 'Profit ≠ Sales − Cost', r.Profit, 'R4']);
    }
    for (const f of ['Order_ID', 'Store', 'City', 'Product']) if (!r[f]) reasons.push([f, 'Required value is empty', '', 'R5']);
    if (r.Order_ID && seen.has(r.Order_ID)) reasons.push(['Order_ID', 'Duplicate Order_ID', r.Order_ID, 'R5']);
    if (r.Order_ID) seen.add(r.Order_ID);
    const expectCols = w.src.__expect ?? header.length;
    if (w.src.__cols !== undefined && w.src.__cols !== expectCols) reasons.push(['(row)', `Row has ${w.src.__cols} columns, expected ${expectCols}`, '', 'R5']);

    if (reasons.length) {
      rejected++;
      for (const [f, p, b, id] of reasons) log(r, w.line, f, p, `Rejected (${id})`, b, '');
      continue;
    }
    accepted.push({ w, date, n, sp, dc, op });
  }

  // F3 – Product → Category / Brand dependency
  const refs = { Category: new Map(), Brand: new Map() };
  for (const { w } of accepted) {
    for (const f of ['Category', 'Brand']) {
      const v = w.raw[f]; if (!v) continue;
      const m = refs[f].get(w.raw.Product) || new Map();
      m.set(v, (m.get(v) || 0) + 1);
      refs[f].set(w.raw.Product, m);
    }
  }
  const majority = (f, product) => {
    const m = refs[f].get(product); if (!m) return null;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [val, cnt] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return total >= 5 && cnt / total >= 0.9 ? val : null;
  };

  const rows = [];
  let defaulted = 0;
  for (const { w, date, n, sp, dc, op } of accepted) {
    const r = w.raw;
    for (const f of ['Category', 'Brand']) {
      const maj = majority(f, r.Product);
      if (maj && r[f] !== maj) {
        log(r, w.line, f, r[f] ? `Conflicts with product "${r.Product}"` : 'Value missing', 'Repaired (F3)', r[f], maj);
        r[f] = maj; w.repaired = true;
      }
    }
    if (!r.Category) { r.Category = 'Uncategorised'; log(r, w.line, 'Category', 'Value missing', 'Defaulted (F4)', '', r.Category); w.repaired = true; }
    if (!r.Brand) { r.Brand = 'Unknown'; log(r, w.line, 'Brand', 'Value missing', 'Defaulted (F4)', '', r.Brand); w.repaired = true; }
    for (const f of ['Payment_Method', 'Customer_Type']) {
      if (!r[f]) { r[f] = 'Unknown'; defaulted++; w.repaired = true; log(r, w.line, f, 'Value missing', 'Defaulted (F4)', '', 'Unknown'); }
    }
    rows.push({
      id: r.Order_ID, date: date.iso, year: date.year, month: date.month, quarter: date.quarter, day: date.day, weekday: date.weekday,
      store: r.Store, city: r.City, product: r.Product, category: r.Category, brand: r.Brand,
      qty: n.Quantity, sales: n.Sales, cost: n.Cost, profit: n.Profit,
      payment: r.Payment_Method, customer: r.Customer_Type,
      discount: Number.isNaN(dc) ? null : dc, sellingPrice: Number.isNaN(sp) ? null : sp, originalPrice: Number.isNaN(op) ? null : op,
    });
  }
  const repairedRows = accepted.filter(({ w }) => w.repaired).length;
  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    report: {
      columns: mapped ? parsed.header : header,
      mapped,
      notes,
      currency: options.currency || null,
      totalRead: records.length,
      accepted: rows.length,
      rejected,
      repairedRows,
      defaulted,
      dateRange: dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null,
      issues: issues.sort((a, b) => a.line - b.line),
    },
  };
}
