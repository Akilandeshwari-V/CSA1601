// Column mapping: lets SmartDMart analyse ANY retail transaction CSV, not only the DMart layout.
// Step 1 detectMapping() guesses which source column plays which role (by header name + content).
// Step 2 applyMapping() turns the raw records into the canonical DMart layout that cleanDataset() validates.
import { parseCSV } from './csv.js';

/** The roles a column can play. `need` = must be supplied (or derivable) for the analysis to run. */
export const FIELDS = [
  { id: 'date', canon: 'Order_Date', label: 'Order date', need: true, hint: 'Date of the sale (dd-mm-yyyy, mm/dd/yyyy, yyyy-mm-dd, "5 Jan 2025" …)' },
  { id: 'sales', canon: 'Sales', label: 'Sales (revenue)', need: 'sales', hint: 'Line total. If missing it is calculated as Quantity × Price.' },
  { id: 'profit', canon: 'Profit', label: 'Profit', need: 'profit', hint: 'If missing it is calculated as Sales − Cost.' },
  { id: 'cost', canon: 'Cost', label: 'Cost', need: 'profit', hint: 'Total cost of the line. If missing it is calculated as Sales − Profit.' },
  { id: 'product', canon: 'Product', label: 'Product', need: true, hint: 'Item name. Falls back to Sub-category or Category.' },
  { id: 'category', canon: 'Category', label: 'Category', hint: 'Top product group (e.g. Grocery, Furniture).' },
  { id: 'brand', canon: 'Brand', label: 'Brand / sub-category', hint: 'Second product level (brand, sub-category, department).' },
  { id: 'quantity', canon: 'Quantity', label: 'Quantity', hint: 'Units sold. Assumed 1 per row if missing.' },
  { id: 'price', canon: 'Selling_Price', label: 'Unit price', hint: 'Used to calculate Sales when Sales is missing.' },
  { id: 'original', canon: 'Original_Price', label: 'Original (list) price', hint: 'Optional. Price before discount.' },
  { id: 'discount', canon: 'Discount_%', label: 'Discount', hint: 'Percent (15) or fraction (0.15): detected automatically.' },
  { id: 'orderId', canon: 'Order_ID', label: 'Order / invoice ID', hint: 'Repeated IDs are treated as separate line items.' },
  { id: 'store', canon: 'Store', label: 'Store / outlet / region', hint: 'Top of the location hierarchy.' },
  { id: 'city', canon: 'City', label: 'City / state', hint: 'Second location level.' },
  { id: 'payment', canon: 'Payment_Method', label: 'Payment method', hint: 'Optional. Shown as "Unknown" if missing.' },
  { id: 'customer', canon: 'Customer_Type', label: 'Customer type / segment', hint: 'Optional. Shown as "Unknown" if missing.' },
];
export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

// Header aliases, compared after lower-casing and removing everything but letters and digits. Order = priority.
const ALIASES = {
  date: ['orderdate', 'date', 'invoicedate', 'transactiondate', 'saledate', 'purchasedate', 'billdate', 'orderdatetime', 'datetime', 'timestamp', 'day'],
  sales: ['sales', 'revenue', 'totalsales', 'totalamount', 'amount', 'netsales', 'linetotal', 'totalprice', 'total', 'salesamount', 'turnover', 'grossamount', 'saleamount'],
  profit: ['profit', 'netprofit', 'grossprofit', 'margin', 'earnings', 'profitamount'],
  cost: ['cost', 'totalcost', 'cogs', 'costofgoodssold', 'costprice', 'purchasecost'],
  product: ['product', 'productname', 'item', 'itemname', 'description', 'sku', 'itemdescription', 'article', 'productdescription', 'stockcode'],
  category: ['category', 'productcategory', 'department', 'productgroup', 'itemcategory', 'group', 'division', 'itemtype', 'producttype', 'type'],
  brand: ['brand', 'subcategory', 'sub category', 'manufacturer', 'productsubcategory', 'brandname', 'subdepartment', 'supplier', 'vendor'],
  quantity: ['quantity', 'qty', 'units', 'unitssold', 'quantitysold', 'orderquantity', 'count', 'pieces'],
  price: ['sellingprice', 'unitprice', 'price', 'saleprice', 'priceperunit', 'itemprice', 'unitsellingprice'],
  original: ['originalprice', 'listprice', 'mrp', 'msrp', 'baseprice', 'regularprice'],
  discount: ['discount', 'discountpct', 'discountpercent', 'discountrate', 'discountpercentage', 'disc'],
  orderId: ['orderid', 'invoiceno', 'invoiceid', 'invoicenumber', 'transactionid', 'billno', 'ordernumber', 'receiptno', 'orderno', 'id', 'txnid', 'billnumber'],
  store: ['store', 'storename', 'outlet', 'branch', 'shop', 'location', 'region', 'storeid', 'market', 'channel', 'warehouse', 'storelocation'],
  city: ['city', 'town', 'state', 'district', 'area', 'province', 'storecity', 'country', 'zone', 'territory'],
  payment: ['paymentmethod', 'payment', 'paymenttype', 'paymode', 'modeofpayment', 'tender', 'paymentmode'],
  customer: ['customertype', 'segment', 'customersegment', 'customercategory', 'membership', 'customerclass', 'loyalty', 'membertype'],
};
const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guess a mapping {fieldId: sourceColumn | null} from the header and a sample of records. */
export function detectMapping(header, records) {
  const sample = records.slice(0, 300);
  const nh = header.map(norm);
  const used = new Set();
  const mapping = {};
  const numericShare = (col) => { let n = 0, t = 0; for (const r of sample) { const v = String(r[col] ?? '').replace(/[₹$€£,\s]/g, ''); if (v === '') continue; t++; if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(v)) n++; } return t ? n / t : 0; };
  const dateShare = (col) => { let n = 0, t = 0; for (const r of sample) { const v = String(r[col] ?? '').trim(); if (v === '') continue; t++; if (parseFlexibleDate(v, 'dmy') || parseFlexibleDate(v, 'mdy')) n++; } return t ? n / t : 0; };
  const numericFields = new Set(['sales', 'profit', 'cost', 'quantity', 'price', 'original', 'discount']);

  for (const f of FIELDS) {
    mapping[f.id] = null;
    for (const alias of ALIASES[f.id]) {
      const i = nh.findIndex((h, ix) => h === alias && !used.has(header[ix]));
      if (i === -1) continue;
      const col = header[i];
      if (numericFields.has(f.id) && numericShare(col) < 0.8) continue;
      if (f.id === 'date' && dateShare(col) < 0.6) continue;
      mapping[f.id] = col; used.add(col); break;
    }
  }
  // Content fallback for date: any column whose values mostly parse as dates.
  if (!mapping.date) {
    const c = header.find((h) => !used.has(h) && dateShare(h) >= 0.8);
    if (c) { mapping.date = c; used.add(c); }
  }
  return mapping;
}

// ---------------------------------------------------------------- flexible dates
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthFromName = (s) => MONTHS[String(s).toLowerCase().slice(0, 4)] || MONTHS[String(s).toLowerCase().slice(0, 3)] || 0;

/** order: 'dmy' | 'mdy'. Returns {iso, year, month, day, quarter, weekday} or null. Accepts a trailing time part. */
export function parseFlexibleDate(s, order = 'dmy') {
  let t = String(s ?? '').trim();
  if (!t) return null;
  t = t.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm)?(\s*(z|[+-]\d{2}:?\d{2}))?$/i, '').trim();
  let d, m, y, mt;
  if ((mt = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { y = +mt[3]; if (order === 'mdy') { m = +mt[1]; d = +mt[2]; } else { d = +mt[1]; m = +mt[2]; } }
  else if ((mt = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/))) { y = 2000 + +mt[3]; if (order === 'mdy') { m = +mt[1]; d = +mt[2]; } else { d = +mt[1]; m = +mt[2]; } }
  else if ((mt = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/))) { d = +mt[1]; m = monthFromName(mt[2]); y = +mt[3]; }
  else if ((mt = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { m = monthFromName(mt[1]); d = +mt[2]; y = +mt[3]; }
  else if ((mt = t.match(/^(\d{5})$/)) && +mt[1] > 20000 && +mt[1] < 80000) { // Excel serial date
    const dt = new Date(Date.UTC(1899, 11, 30) + +mt[1] * 86400000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else return null;
  if (!m || y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { iso: `${y}-${pad(m)}-${pad(d)}`, year: y, month: m, day: d, quarter: Math.ceil(m / 3), weekday: dt.getUTCDay() };
}

/** Decide day-first or month-first by looking for impossible values (e.g. 25/03 can only be dd/mm). */
export function detectDateOrder(values) {
  let dmyOnly = 0, mdyOnly = 0;
  for (const v of values) {
    const mt = String(v ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!mt) continue;
    if (+mt[1] > 12) dmyOnly++;
    if (+mt[2] > 12) mdyOnly++;
  }
  if (mdyOnly > dmyOnly) return 'mdy';
  return 'dmy';
}

// ---------------------------------------------------------------- applying a mapping
const num = (s) => { const t = String(s ?? '').replace(/[₹$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN; };
const fmt = (x) => (Number.isFinite(x) ? String(Math.round(x * 1e6) / 1e6) : '');

/** Which source columns are still needed for the analysis to be possible? Returns a list of human-readable problems. */
export function mappingProblems(mapping) {
  const p = [];
  if (!mapping.date) p.push('Choose the column that holds the order date.');
  if (!mapping.product && !mapping.category && !mapping.brand) p.push('Choose a Product column (or at least a Category).');
  if (!mapping.sales && !(mapping.price && mapping.quantity) && !mapping.price) p.push('Choose Sales, or give a Unit price (and Quantity) so Sales can be calculated.');
  if (!mapping.profit && !mapping.cost) p.push('Choose Profit or Cost, because at least one of them is needed to calculate the other.');
  return p;
}

/**
 * Build canonical records from raw ones.
 * options: { dateOrder: 'auto'|'dmy'|'mdy' }
 * Returns { header, records, notes, dateOrder } where header/records follow the DMart layout.
 */
export function applyMapping(records, mapping, options = {}) {
  const srcWidth = options.srcWidth ?? Object.keys(records[0] ?? {}).length;
  const probs = mappingProblems(mapping);
  if (probs.length) throw new Error(probs.join(' '));
  const col = (r, id) => (mapping[id] ? String(r[mapping[id]] ?? '') : '');
  const notes = [];

  const order = options.dateOrder && options.dateOrder !== 'auto' ? options.dateOrder : detectDateOrder(records.map((r) => col(r, 'date')));
  notes.push(`Dates read as ${order === 'mdy' ? 'month/day/year' : 'day/month/year'} where the format is ambiguous.`);

  // Discounts given as fractions (0.15) are converted to percent.
  let discScale = 1;
  if (mapping.discount) {
    const vals = records.map((r) => num(col(r, 'discount'))).filter(Number.isFinite);
    const max = vals.length ? Math.max(...vals) : 0;
    if (vals.length && max <= 1 && !/%/.test(mapping.discount)) { discScale = 100; notes.push(`“${mapping.discount}” looks like a fraction (max ${max}), so it was converted to percent.`); }
  }

  // Repeated order IDs mean several line items per order, so every row gets its own ID (e.g. CA-1001-2).
  let lineItems = false;
  if (mapping.orderId) {
    const seen = new Set();
    for (const r of records) { const id = col(r, 'orderId').trim(); if (id && seen.has(id)) { lineItems = true; break; } seen.add(id); }
    if (lineItems) notes.push(`“${mapping.orderId}” repeats across rows, so each row is treated as one order line (IDs become ID-1, ID-2 …).`);
  } else notes.push('No order-ID column: rows are numbered 1, 2, 3 …');

  // A unit price is only trusted as a check on Sales when it really explains Sales (otherwise it is probably a list price).
  let usePrice = !!mapping.price;
  if (mapping.price && mapping.sales) {
    let ok = 0, tot = 0;
    for (const r of records) { const q = mapping.quantity ? num(col(r, 'quantity')) : 1, pr = num(col(r, 'price')), sa = num(col(r, 'sales')); if (![q, pr, sa].every(Number.isFinite)) continue; tot++; if (Math.abs(pr * q - sa) <= Math.max(0.05, 0.01 * Math.abs(sa))) ok++; }
    if (tot && ok / tot < 0.9) { usePrice = false; notes.push(`“${mapping.price}” × quantity does not match “${mapping.sales}” for most rows (probably a list price), so it is not used as a check.`); }
  }
  if (!mapping.sales) notes.push(`Sales calculated as ${mapping.quantity ? 'Quantity × ' : ''}“${mapping.price}”.`);
  if (!mapping.profit) notes.push(`Profit calculated as Sales − “${mapping.cost}”.`);
  else if (!mapping.cost) notes.push(`Cost calculated as Sales − “${mapping.profit}”.`);
  if (!mapping.quantity) notes.push('No quantity column: each row counts as 1 unit.');
  for (const [id, fallback] of [['category', 'Uncategorised'], ['brand', 'Unknown'], ['store', 'All stores'], ['city', 'Unknown'], ['payment', 'Unknown'], ['customer', 'Unknown']]) {
    if (!mapping[id]) notes.push(`No ${FIELD_BY_ID[id].label.split(' /')[0].toLowerCase()} column: every row is labelled “${fallback}”.`);
  }
  if (!mapping.product) notes.push(`No product column: “${mapping.category || mapping.brand}” is used as the product.`);

  const header = ['Order_ID', 'Order_Date', 'Store', 'City', 'Product', 'Category', 'Brand', 'Quantity', 'Original_Price', 'Discount_%', 'Selling_Price', 'Sales', 'Cost', 'Profit', 'Payment_Method', 'Customer_Type'];
  const counter = new Map();
  const out = records.map((r, i) => {
    const dateRaw = col(r, 'date').trim();
    const d = parseFlexibleDate(dateRaw, order);
    let qty = mapping.quantity ? num(col(r, 'quantity')) : 1;
    const price = mapping.price ? num(col(r, 'price')) : NaN;
    let sales = mapping.sales ? num(col(r, 'sales')) : (Number.isFinite(price) ? price * (Number.isFinite(qty) ? qty : 1) : NaN);
    let profit = mapping.profit ? num(col(r, 'profit')) : NaN;
    let cost = mapping.cost ? num(col(r, 'cost')) : NaN;
    if (!mapping.profit && Number.isFinite(sales) && Number.isFinite(cost)) profit = sales - cost;
    if (!mapping.cost && Number.isFinite(sales) && Number.isFinite(profit)) cost = sales - profit;
    const dsc = mapping.discount ? num(col(r, 'discount')) : NaN;

    let id = mapping.orderId ? col(r, 'orderId').trim() : String(i + 1);
    if (lineItems && id) { const n = (counter.get(id) || 0) + 1; counter.set(id, n); id = `${id}-${n}`; }

    const category = mapping.category ? col(r, 'category') : 'Uncategorised';
    const brand = mapping.brand ? col(r, 'brand') : 'Unknown';
    const product = mapping.product ? col(r, 'product') : (mapping.category ? category : brand);
    return {
      Order_ID: id,
      Order_Date: d ? d.iso : dateRaw, // keep the raw text if unreadable so the cleaning log shows it
      Store: mapping.store ? col(r, 'store') : 'All stores',
      City: mapping.city ? col(r, 'city') : 'Unknown',
      Product: product, Category: category, Brand: brand,
      Quantity: mapping.quantity ? col(r, 'quantity') : '1',
      Original_Price: mapping.original ? col(r, 'original') : '', 'Discount_%': Number.isFinite(dsc) ? fmt(dsc * discScale) : '',
      Selling_Price: usePrice && mapping.sales ? col(r, 'price') : '',
      Sales: mapping.sales ? col(r, 'sales') : fmt(sales),
      Cost: mapping.cost ? col(r, 'cost') : fmt(cost),
      Profit: mapping.profit ? col(r, 'profit') : fmt(profit),
      Payment_Method: mapping.payment ? col(r, 'payment') : 'Unknown', Customer_Type: mapping.customer ? col(r, 'customer') : 'Unknown',
    };
  });
  // Rows are rebuilt with the canonical column names. Ragged source rows (wrong number of cells) stay detectable by the cleaner.
  out.forEach((o, i) => {
    const ragged = records[i].__cols !== undefined && records[i].__cols !== srcWidth;
    Object.defineProperty(o, '__cols', { value: ragged ? records[i].__cols : header.length, enumerable: false });
    Object.defineProperty(o, '__expect', { value: ragged ? srcWidth : header.length, enumerable: false });
  });
  return { header, records: out, notes, dateOrder: order, lineItems };
}

/** Peek at a CSV: header, a few rows, detected mapping. Used by the upload wizard and the server. */
export function inspectCSV(text) {
  const { header, records } = parseCSV(text);
  return { header, records, mapping: header.length ? detectMapping(header, records) : {} };
}
