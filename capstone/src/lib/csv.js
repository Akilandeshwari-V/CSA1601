// Small RFC-4180 style CSV parser (quotes, escaped quotes, CRLF, BOM). No dependencies.
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const lines = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!lines.length) return { header: [], records: [] };
  const header = lines[0].map((h) => h.trim());
  const records = lines.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    Object.defineProperty(rec, '__cols', { value: r.length, enumerable: false });
    return rec;
  });
  return { header, records };
}
