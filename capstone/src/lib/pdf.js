// Minimal PDF 1.4 writer (no dependencies) + the layout of the SmartDMart sales report.
// Uses the built-in Helvetica fonts (no embedding), so text is limited to WinAnsi: the rupee sign is printed as "Rs.".
import { fmtMoney, fmtInt, fmtPct } from './format.js';

const PAGE_W = 595.28, PAGE_H = 841.89, M = 40;

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from the Adobe AFM files.
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BW = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const EXTRA_W = { 128: 556, 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 163: 556 };

// Unicode → WinAnsi (cp1252) for the few non-Latin-1 characters the report uses.
const WIN = { 8364: '\x80', 8226: '\x95', 8211: '\x96', 8212: '\x97', 8216: '\x91', 8217: '\x92', 8220: '\x93', 8221: '\x94', 8722: '-', 8377: 'Rs.', 8594: '->', 8805: '>=', 8804: '<=', 160: ' ', 8239: ' ', 8201: ' ' };
export function enc(s) {
  let o = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (c < 256) o += ch; else o += WIN[c] ?? '?';
  }
  return o.replace(/[\r\n\t]+/g, ' ');
}
export function textWidth(s, size, bold = false) {
  const t = bold ? BW : HW; let w = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += c >= 32 && c <= 126 ? t[c - 32] : EXTRA_W[c] ?? 556; }
  return (w * size) / 1000;
}
const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' '); };

export class PDFDoc {
  constructor(info = {}) { this.info = info; this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); return this.ops; }
  get pageCount() { return this.pages.length; }
  goto(i) { this.ops = this.pages[i]; }
  // All drawing methods use a top-left origin (y grows downwards), converted to PDF space here.
  rect(x, y, w, h, { fill, stroke, lw = 0.6 } = {}) {
    const o = [];
    if (fill) o.push(`${rgb(fill)} rg`);
    if (stroke) o.push(`${rgb(stroke)} RG ${num(lw)} w`);
    o.push(`${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.ops.push(o.join(' '));
  }
  line(x1, y1, x2, y2, { color = '#000000', lw = 0.6, dash } = {}) {
    this.ops.push(`${rgb(color)} RG ${num(lw)} w ${dash ? `[${dash}] 0 d` : '[] 0 d'} ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`);
  }
  polyline(pts, { color = '#000000', lw = 1.2 } = {}) {
    if (pts.length < 2) return;
    this.ops.push(`${rgb(color)} RG ${num(lw)} w 1 J 1 j ` + pts.map(([x, y], i) => `${num(x)} ${num(PAGE_H - y)} ${i ? 'l' : 'm'}`).join(' ') + ' S');
  }
  /** Draws one line of text; y is the baseline. align: left | right | center. Returns the width. */
  text(str, x, y, { size = 10, bold = false, color = '#111111', align = 'left' } = {}) {
    const s = enc(str); const w = textWidth(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(px)} ${num(PAGE_H - y)} Td (${esc(s)}) Tj ET`);
    return w;
  }
  /** Greedy word wrap using real glyph widths. */
  wrap(str, width, size, bold = false) {
    const words = enc(str).split(' '); const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (textWidth(t, size, bold) <= width || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /** Shorten with "..." until it fits. */
  fit(str, width, size, bold = false) {
    let s = enc(str); if (textWidth(s, size, bold) <= width) return s;
    while (s.length > 1 && textWidth(s + '...', size, bold) > width) s = s.slice(0, -1);
    return s.trimEnd() + '...';
  }
  toBytes() {
    const objs = []; // index = object number - 1
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(''), pagesObj = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const p = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
      kids.push(`${p} 0 R`);
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    const pdfDate = (this.info.date || new Date()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const info = add(`<< /Title (${esc(enc(this.info.title || 'Report'))}) /Author (SmartDMart) /Creator (SmartDMart report engine) /CreationDate (D:${pdfDate}Z) >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offsets = [];
    objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255; // every char is < 256 by construction
    return bytes;
  }
}

// ------------------------------------------------------------------ report layout
const C = { navy: '#0f1b3d', brand: '#2748b8', brandL: '#e8eefb', ink: '#0f1b2d', muted: '#55657d', line: '#d9e0ec', zebra: '#f6f8fc', amber: '#f2b134', teal: '#0e9aa7', red: '#c83a3a', green: '#1a7f4b', bar: '#2748b8', bar2: '#7b93e0' };

export function reportToPDF(r) {
  const doc = new PDFDoc({ title: `${r.title}: ${r.period.label}`, date: new Date(r.generatedAt) });
  const W = PAGE_W - 2 * M;
  let y = 0;
  const chrome = () => { doc.rect(0, 0, PAGE_W, 5, { fill: C.brand }); };
  const room = (h) => { if (y + h > PAGE_H - 54) { doc.newPage(); chrome(); y = M + 6; return true; } return false; };
  const heading = (t, sub) => { room(40); doc.text(t, M, y + 12, { size: 13, bold: true, color: C.navy }); doc.rect(M, y + 18, 28, 2.4, { fill: C.amber }); if (sub) doc.text(sub, M + W, y + 12, { size: 8.5, color: C.muted, align: 'right' }); y += 32; };

  // ---- cover band
  chrome();
  doc.rect(0, 5, PAGE_W, 112, { fill: C.navy });
  doc.rect(M, 34, 26, 26, { stroke: C.amber, lw: 2 }); doc.rect(M + 15, 47, 7, 7, { fill: C.red });
  doc.text('SmartDMart', M + 36, 52, { size: 13, bold: true, color: '#ffffff' });
  doc.text(r.title, M, 90, { size: 24, bold: true, color: '#ffffff' });
  doc.text(r.period.label + (r.period.days > 1 ? `  (${r.period.days} days)` : ''), M, 108, { size: 11.5, color: '#c5d3f5' });
  doc.text(`Dataset: ${r.dataset.name}`, PAGE_W - M, 52, { size: 8.5, color: '#c5d3f5', align: 'right' });
  doc.text(`Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, PAGE_W - M, 64, { size: 8.5, color: '#c5d3f5', align: 'right' });
  y = 140;

  if (r.empty) {
    doc.text('No orders fall inside this period.', M, y + 10, { size: 12, bold: true, color: C.red });
    doc.text('Choose another date range and generate the report again.', M, y + 28, { size: 10, color: C.muted });
    return finish(doc);
  }

  // ---- KPI cards
  const k = r.kpis, d = r.deltas, gap = 10, cw = (W - 3 * gap) / 4;
  const cards = [
    ['TOTAL SALES', fmtMoney(k.sales), d?.sales, `${fmtInt(k.orders)} order lines`],
    ['TOTAL PROFIT', fmtMoney(k.profit), d?.profit, `${fmtPct(k.margin)} margin`],
    ['UNITS SOLD', fmtInt(k.qty), d?.qty, `${fmtInt(r.period.days)} day${r.period.days > 1 ? 's' : ''} in period`],
    ['AVG ORDER VALUE', fmtMoney(k.aov), d?.aov, 'sales per order line'],
  ];
  cards.forEach(([label, val, delta, sub], i) => {
    const x = M + i * (cw + gap);
    doc.rect(x, y, cw, 74, { fill: '#ffffff', stroke: C.line });
    doc.rect(x, y, cw, 3, { fill: i === 0 ? C.brand : C.amber });
    doc.text(label, x + 10, y + 19, { size: 7.5, bold: true, color: C.muted });
    doc.text(val, x + 10, y + 42, { size: val.length > 11 ? 14 : 17, bold: true, color: C.ink });
    if (delta != null) doc.text(`${delta >= 0 ? '+' : '-'}${Math.abs(delta * 100).toFixed(1)}% vs previous`, x + 10, y + 57, { size: 8, bold: true, color: delta >= 0 ? C.green : C.red });
    else doc.text(sub, x + 10, y + 57, { size: 8, color: C.muted });
    doc.text(delta != null ? sub : '', x + 10, y + 68, { size: 7, color: C.muted });
  });
  y += 74 + 22;
  if (r.previous) { doc.text(`Comparison period: ${r.previous.label} (sales ${fmtMoney(r.previous.kpis.sales)}, profit ${fmtMoney(r.previous.kpis.profit)}).`, M, y - 8, { size: 8, color: C.muted }); y += 8; }

  // ---- insights
  heading('Key findings');
  for (const t of r.insights) {
    const lines = doc.wrap(t, W - 22, 10);
    room(lines.length * 13 + 8);
    doc.rect(M + 2, y - 1, 5, 5, { fill: C.brand });
    lines.forEach((l, i) => doc.text(l, M + 16, y + 8 + i * 13, { size: 10, color: C.ink }));
    y += lines.length * 13 + 5;
  }
  y += 10;

  // ---- trend chart
  heading(r.trend.grain === 'day' ? 'Daily sales and profit' : 'Monthly sales and profit', 'bars = sales, line = profit');
  trendChart(doc, M, y, W, 150, r.trend.points); y += 150 + 30;

  // ---- breakdowns
  const barTable = (title, list, nameLabel) => {
    if (!list.length) return;
    room(32 + 19 + list.length * 19); heading(title);
    const cols = [{ x: M, w: 150 }, { x: M + 158, w: 118 }, { x: M + 280, w: 78, right: true }, { x: M + 366, w: 66, right: true }, { x: M + 440, w: 40, right: true }, { x: M + 488, w: 27, right: true }];
    room(22 + list.length * 19); header([nameLabel, 'Share of sales', 'Sales', 'Profit', 'Margin', '%'], cols);
    const max = Math.max(...list.map((e) => e.sales), 1);
    list.forEach((e, i) => {
      if (room(19)) header([nameLabel, 'Share of sales', 'Sales', 'Profit', 'Margin', '%'], cols);
      if (i % 2) doc.rect(M, y - 12, W, 19, { fill: C.zebra });
      doc.text(doc.fit(e.name, cols[0].w - 4, 9), cols[0].x + 4, y, { size: 9 });
      doc.rect(cols[1].x, y - 7, cols[1].w, 8, { fill: '#eef2f8' });
      doc.rect(cols[1].x, y - 7, Math.max(1, (cols[1].w * e.sales) / max), 8, { fill: C.bar });
      doc.text(fmtMoney(e.sales), cols[2].x + cols[2].w, y, { size: 9, align: 'right' });
      doc.text(fmtMoney(e.profit), cols[3].x + cols[3].w, y, { size: 9, align: 'right', color: e.profit < 0 ? C.red : C.ink });
      doc.text(fmtPct(e.margin, 1), cols[4].x + cols[4].w, y, { size: 9, align: 'right', color: e.margin < 0 ? C.red : C.ink });
      doc.text(fmtPct(e.share, 0), cols[5].x + cols[5].w, y, { size: 8, align: 'right', color: C.muted });
      y += 19;
    });
    y += 14;
  };
  function header(labels, cols) {
    doc.rect(M, y - 12, W, 19, { fill: C.brandL });
    labels.forEach((l, i) => doc.text(l, cols[i].right ? cols[i].x + cols[i].w : cols[i].x + 4, y, { size: 8, bold: true, color: C.navy, align: cols[i].right ? 'right' : 'left' }));
    y += 19;
  }
  barTable('Sales by category', r.categories, 'Category');
  barTable('Sales by store / location', r.stores, 'Store');
  if (r.cities.length > 1) barTable('Sales by city', r.cities, 'City');

  // ---- product tables
  const prodTable = (title, list, sub) => {
    if (!list.length) return;
    room(32 + 19 + list.length * 19); heading(title, sub);
    const cols = [{ x: M, w: 230 }, { x: M + 240, w: 60, right: true }, { x: M + 310, w: 70, right: true }, { x: M + 390, w: 70, right: true }, { x: M + 468, w: 47, right: true }];
    room(22 + list.length * 19); header(['Product', 'Units', 'Sales', 'Profit', 'Margin'], cols);
    list.forEach((e, i) => {
      if (room(19)) header(['Product', 'Units', 'Sales', 'Profit', 'Margin'], cols);
      if (i % 2) doc.rect(M, y - 12, W, 19, { fill: C.zebra });
      doc.text(doc.fit(e.name, cols[0].w - 4, 9), cols[0].x + 4, y, { size: 9 });
      doc.text(fmtInt(e.qty), cols[1].x + cols[1].w, y, { size: 9, align: 'right' });
      doc.text(fmtMoney(e.sales), cols[2].x + cols[2].w, y, { size: 9, align: 'right' });
      doc.text(fmtMoney(e.profit), cols[3].x + cols[3].w, y, { size: 9, align: 'right', color: e.profit < 0 ? C.red : C.green, bold: true });
      doc.text(fmtPct(e.margin, 1), cols[4].x + cols[4].w, y, { size: 9, align: 'right', color: e.margin < 0 ? C.red : C.ink });
      y += 19;
    });
    y += 14;
  };
  prodTable('Top 5 products by profit', r.topProducts);
  prodTable('Products sold at a loss', r.bottomProducts, `${r.lossMakers.count} product${r.lossMakers.count === 1 ? '' : 's'} in total`);

  // ---- payment + customer (side by side), weekday
  const mini = (title, list, x, w) => {
    doc.text(title, x, y + 10, { size: 10.5, bold: true, color: C.navy });
    let yy = y + 28;
    for (const e of list) {
      doc.text(doc.fit(e.name, w - 90, 9), x, yy, { size: 9 });
      doc.rect(x + w - 86, yy - 7, 54, 7, { fill: '#eef2f8' }); doc.rect(x + w - 86, yy - 7, Math.max(1, 54 * e.share), 7, { fill: C.bar2 });
      doc.text(fmtPct(e.share, 0), x + w, yy, { size: 8.5, align: 'right', color: C.muted });
      yy += 15;
    }
    return yy;
  };
  room(40 + Math.max(r.payments.length, r.customers.length) * 15);
  const half = (W - 24) / 2;
  const y1 = mini('Payment methods (share of sales)', r.payments, M, half), y2 = mini('Customer types (share of sales)', r.customers, M + half + 24, half);
  y = Math.max(y1, y2) + 12;
  if (r.weekdays.length) {
    heading('Sales by weekday', 'total sales in the period');
    const max = Math.max(...r.weekdays.map((w) => w.sales), 1); room(8 * 17);
    r.weekdays.forEach((w) => { doc.text(w.name, M + 4, y, { size: 9 }); doc.rect(M + 90, y - 8, 330, 9, { fill: '#eef2f8' }); doc.rect(M + 90, y - 8, Math.max(1, (330 * w.sales) / max), 9, { fill: C.bar }); doc.text(fmtMoney(w.sales), M + W, y, { size: 9, align: 'right' }); y += 17; });
    y += 10;
  }

  // ---- notes
  room(70);
  doc.rect(M, y, W, 1, { fill: C.line }); y += 16;
  const notes = ['How to read this report: figures come from the validated rows of the active dataset only; rejected rows are excluded. Margin = profit ÷ sales.',
    r.previous ? `Changes compare with the equal-length period directly before (${r.previous.label}).` : 'No earlier period of equal length exists in the data, so no comparison is shown.',
    r.quality ? `Data quality: ${fmtInt(r.quality.accepted)} rows accepted, ${fmtInt(r.quality.repaired)} repaired, ${fmtInt(r.quality.rejected)} rejected of ${fmtInt(r.quality.totalRead)} read.` : '',
    'In this PDF the rupee sign is printed as "Rs." because the built-in PDF fonts have no rupee glyph.'].filter(Boolean);
  for (const n of notes) for (const l of doc.wrap(n, W, 8)) { room(12); doc.text(l, M, y, { size: 8, color: C.muted }); y += 11.5; }

  return finish(doc);
}

function finish(doc) {
  const n = doc.pageCount;
  for (let i = 0; i < n; i++) {
    doc.goto(i);
    doc.line(M, PAGE_H - 36, PAGE_W - M, PAGE_H - 36, { color: C.line });
    doc.text('SmartDMart  |  Retail intelligence report', M, PAGE_H - 22, { size: 8, color: C.muted });
    doc.text(`Page ${i + 1} of ${n}`, PAGE_W - M, PAGE_H - 22, { size: 8, color: C.muted, align: 'right' });
  }
  return doc.toBytes();
}

function trendChart(doc, x, y, w, h, pts) {
  const padL = 52, padB = 22, cx = x + padL, cw = w - padL - 4, ch = h - padB;
  const hi = Math.max(...pts.map((p) => Math.max(p.sales, p.profit)), 1), lo = Math.min(0, ...pts.map((p) => p.profit));
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const top = nice(hi), bottom = lo < 0 ? -nice(-lo) : 0, span = top - bottom;
  const Y = (v) => y + ch - ((v - bottom) / span) * ch;
  for (let i = 0; i <= 4; i++) {
    const v = bottom + (span * i) / 4, yy = Y(v);
    doc.line(cx, yy, cx + cw, yy, { color: i === 0 && bottom === 0 ? '#8493ab' : C.line, lw: 0.5 });
    doc.text(fmtCompact(v), cx - 6, yy + 3, { size: 7, color: C.muted, align: 'right' });
  }
  if (bottom < 0) doc.line(cx, Y(0), cx + cw, Y(0), { color: '#8493ab', lw: 0.7 });
  const step = cw / pts.length, bw = Math.min(26, step * 0.66);
  pts.forEach((p, i) => {
    const bx = cx + i * step + (step - bw) / 2, y0 = Y(0), y1 = Y(p.sales);
    doc.rect(bx, Math.min(y0, y1), bw, Math.max(0.8, Math.abs(y0 - y1)), { fill: C.bar });
  });
  doc.polyline(pts.map((p, i) => [cx + i * step + step / 2, Y(p.profit)]), { color: C.amber, lw: 1.8 });
  const every = Math.ceil(pts.length / Math.max(2, Math.floor(cw / 46)));
  pts.forEach((p, i) => { if (i % every === 0) doc.text(p.label, cx + i * step + step / 2, y + ch + 13, { size: 7, color: C.muted, align: 'center' }); });
}
function fmtCompact(v) { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(a % 1e3 ? 1 : 0) + 'k' : s + Math.round(a); }
