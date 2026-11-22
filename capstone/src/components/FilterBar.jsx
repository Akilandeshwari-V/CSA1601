import { numLocale } from '../lib/format.js';
import { useMemo } from 'react';
import { FILTER_FIELDS, countActive, distinct, emptyFilters } from '../lib/filters.js';

export default function FilterBar({ allRows, filters, setFilters, shown, total }) {
  const options = useMemo(() => Object.fromEntries(FILTER_FIELDS.map((f) => [f.id, distinct(allRows, f.key)])), [allRows]);
  const bounds = useMemo(() => {
    const d = allRows.map((r) => r.date).sort();
    return { min: d[0] || '', max: d[d.length - 1] || '' };
  }, [allRows]);
  const active = countActive(filters);
  const toggle = (id, v) => setFilters((f) => ({ ...f, [id]: f[id].includes(v) ? f[id].filter((x) => x !== v) : [...f[id], v] }));

  return (
    <details className="filterbar" open={active > 0 ? true : undefined}>
      <summary>
        <span className="fb-title">Filters</span>
        <span className="fb-count">{active ? `${active} active · ` : ''}{shown.toLocaleString(numLocale())} of {total.toLocaleString(numLocale())} orders</span>
        {active > 0 && (
          <button type="button" className="btn small ghost" onClick={(e) => { e.preventDefault(); setFilters(emptyFilters()); }}>Clear all</button>
        )}
      </summary>
      <div className="fb-body">
        <fieldset className="fb-group">
          <legend>Order date</legend>
          <label>From <input type="date" value={filters.from} min={bounds.min} max={bounds.max} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></label>
          <label>To <input type="date" value={filters.to} min={bounds.min} max={bounds.max} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></label>
        </fieldset>
        {FILTER_FIELDS.map((f) => (
          <fieldset className="fb-group" key={f.id}>
            <legend>{f.label}{filters[f.id].length ? ` (${filters[f.id].length})` : ''}</legend>
            <div className="chips">
              {options[f.id].map((v) => (
                <button type="button" key={v} className={'chip' + (filters[f.id].includes(v) ? ' on' : '')} aria-pressed={filters[f.id].includes(v)} onClick={() => toggle(f.id, v)}>{v}</button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </details>
  );
}
