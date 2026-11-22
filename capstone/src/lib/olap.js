// OLAP engine: dimensions with hierarchies, aggregation into cube cells, and the five OLAP operations.
// Every operation is a pure function (state -> new state) so the UI can show before/after results.

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const ALL = (name) => ({ name, parts: () => [], label: () => name, sort: () => [] });

export const DIMS = {
  product: {
    id: 'product', name: 'Product', table: 'DIM_PRODUCT',
    levels: [
      ALL('All Products'),
      { name: 'Category', parts: (r) => [r.category], label: (r) => r.category, sort: (r) => [r.category] },
      { name: 'Brand', parts: (r) => [r.category, r.brand], label: (r) => r.brand, sort: (r) => [r.category, r.brand] },
      { name: 'Product', parts: (r) => [r.category, r.brand, r.product], label: (r) => r.product, sort: (r) => [r.category, r.brand, r.product] },
    ],
  },
  time: {
    id: 'time', name: 'Time', table: 'DIM_DATE',
    levels: [
      ALL('All Time'),
      { name: 'Year', parts: (r) => [String(r.year)], label: (r) => String(r.year), sort: (r) => [String(r.year)] },
      { name: 'Quarter', parts: (r) => [String(r.year), 'Q' + r.quarter], label: (r) => `Q${r.quarter} ${r.year}`, sort: (r) => [String(r.year), 'Q' + r.quarter] },
      { name: 'Month', parts: (r) => [String(r.year), pad2(r.month)], label: (r) => `${MONTH_NAMES[r.month - 1]} ${r.year}`, sort: (r) => [String(r.year), pad2(r.month)] },
    ],
  },
  location: {
    id: 'location', name: 'Store / Location', table: 'DIM_STORE',
    levels: [
      ALL('All Stores'),
      { name: 'Store', parts: (r) => [r.store], label: (r) => r.store, sort: (r) => [r.store] },
      { name: 'City', parts: (r) => [r.store, r.city], label: (r) => r.city, sort: (r) => [r.store, r.city] },
    ],
  },
  payment: {
    id: 'payment', name: 'Payment Method', table: 'DIM_PAYMENT',
    levels: [
      ALL('All Payments'),
      { name: 'Payment Method', parts: (r) => [r.payment], label: (r) => r.payment, sort: (r) => [r.payment] },
    ],
  },
  customer: {
    id: 'customer', name: 'Customer Type', table: 'DIM_CUSTOMER_TYPE',
    levels: [
      ALL('All Customers'),
      { name: 'Customer Type', parts: (r) => [r.customer], label: (r) => r.customer, sort: (r) => [r.customer] },
    ],
  },
};
export const DIM_ORDER = ['product', 'time', 'location', 'payment', 'customer'];
export const SEP = ' › ';
export const keyOf = (lvl, row) => lvl.parts(row).join(SEP);

const cmpArr = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = String(a[i] ?? '').localeCompare(String(b[i] ?? ''), 'en', { numeric: true });
    if (c) return c;
  }
  return 0;
};

export function initialState() {
  return {
    axes: ['product', 'time', 'location'],
    levels: { product: 1, time: 2, location: 1, payment: 1, customer: 1 },
    filters: {}, // dim -> { level, keys: [] }
  };
}

function buildMembers(rows, lvl) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(lvl, r);
    if (!map.has(k)) map.set(k, { key: k, parts: lvl.parts(r), label: lvl.label(r), sort: lvl.sort(r) });
  }
  const members = [...map.values()].sort((a, b) => cmpArr(a.sort, b.sort));
  const count = new Map();
  members.forEach((m) => count.set(m.label, (count.get(m.label) || 0) + 1));
  members.forEach((m, i) => {
    if (count.get(m.label) > 1) m.label = m.parts.slice(-2).join(SEP); // disambiguate e.g. Tata under two categories
    m.index = i;
  });
  return members;
}

export function listMembers(rows, dim, level) {
  return buildMembers(rows, DIMS[dim].levels[level]);
}

export function applyFilters(rows, filters) {
  let out = rows;
  for (const [dim, f] of Object.entries(filters)) {
    if (!f || !f.keys.length) continue;
    const lvl = DIMS[dim].levels[f.level];
    const set = new Set(f.keys);
    out = out.filter((r) => set.has(keyOf(lvl, r)));
  }
  return out;
}

export function aggregate(rows, state) {
  const filtered = applyFilters(rows, state.filters);
  const lvls = state.axes.map((d) => DIMS[d].levels[state.levels[d]]);
  const axes = state.axes.map((dim, a) => {
    const members = buildMembers(filtered, lvls[a]);
    return {
      dim, level: state.levels[dim], levelName: lvls[a].name, dimName: DIMS[dim].name,
      members, index: new Map(members.map((m) => [m.key, m.index])),
    };
  });
  const [nx, ny, nz] = axes.map((a) => a.members.length);
  const cellMap = new Map();
  const totals = { sales: 0, profit: 0, qty: 0, count: 0 };
  for (const r of filtered) {
    const i = axes[0].index.get(keyOf(lvls[0], r));
    const j = axes[1].index.get(keyOf(lvls[1], r));
    const k = axes[2].index.get(keyOf(lvls[2], r));
    const id = (i * ny + j) * nz + k;
    let c = cellMap.get(id);
    if (!c) { c = { id, i, j, k, sales: 0, profit: 0, qty: 0, count: 0, rows: [] }; cellMap.set(id, c); }
    c.sales += r.sales; c.profit += r.profit; c.qty += r.qty; c.count++; c.rows.push(r);
    totals.sales += r.sales; totals.profit += r.profit; totals.qty += r.qty; totals.count++;
  }
  const cells = [...cellMap.values()].sort((a, b) => a.id - b.id);
  const max = { sales: 0, profit: 0, qty: 0 };
  for (const c of cells) for (const m of ['sales', 'profit', 'qty']) max[m] = Math.max(max[m], c[m]);
  return { state, axes, cells, totals, max, grid: [nx, ny, nz], gridSize: nx * ny * nz, orders: filtered.length };
}

// ---------------------------------------------------------------- OLAP operations
export const canRollUp = (s, dim) => s.levels[dim] > 0;
export const canDrillDown = (s, dim) => s.levels[dim] < DIMS[dim].levels.length - 1;
export const setLevel = (s, dim, level) => ({ ...s, levels: { ...s.levels, [dim]: level } });
export const rollUp = (s, dim) => (canRollUp(s, dim) ? setLevel(s, dim, s.levels[dim] - 1) : null);
export const drillDown = (s, dim) => (canDrillDown(s, dim) ? setLevel(s, dim, s.levels[dim] + 1) : null);

/** Slice: fix ONE dimension to ONE member. */
export const slice = (s, dim, level, key) => ({ ...s, filters: { ...s.filters, [dim]: { level, keys: [key] } } });

/** Dice: restrict several dimensions to a set of members. selections = { dim: { level, keys: [] } } */
export function dice(s, selections) {
  const filters = { ...s.filters };
  for (const [dim, sel] of Object.entries(selections)) {
    if (sel.keys.length) filters[dim] = { level: sel.level, keys: [...sel.keys] };
    else delete filters[dim];
  }
  return { ...s, filters };
}
export const clearFilter = (s, dim) => {
  const filters = { ...s.filters }; delete filters[dim];
  return { ...s, filters };
};

/** Pivot: re-assign which dimension sits on which cube axis. */
export const swapAxes = (s, a, b) => {
  const axes = [...s.axes]; [axes[a], axes[b]] = [axes[b], axes[a]];
  return { ...s, axes };
};
export const rotateAxes = (s) => ({ ...s, axes: [s.axes[2], s.axes[0], s.axes[1]] });
export function setAxisDim(s, axisIdx, dim) {
  if (s.axes[axisIdx] === dim) return s;
  const axes = [...s.axes];
  const other = axes.indexOf(dim);
  if (other >= 0) axes[other] = axes[axisIdx];
  axes[axisIdx] = dim;
  return { ...s, axes };
}

// ---------------------------------------------------------------- SQL equivalent against the star schema
const SQL = {
  product: { alias: 'p', join: 'JOIN DIM_PRODUCT p ON f.Product_Key = p.Product_Key', cols: [[], ['p.Category'], ['p.Category', 'p.Brand'], ['p.Category', 'p.Brand', 'p.Product']] },
  time: { alias: 'd', join: 'JOIN DIM_DATE d ON f.Date_Key = d.Date_Key', cols: [[], ['d.Year'], ['d.Year', 'd.Quarter'], ['d.Year', 'd.Month']] },
  location: { alias: 's', join: 'JOIN DIM_STORE s ON f.Store_Key = s.Store_Key', cols: [[], ['s.Store'], ['s.Store', 's.City']] },
  payment: { alias: 'pm', join: 'JOIN DIM_PAYMENT pm ON f.Payment_Key = pm.Payment_Key', cols: [[], ['pm.Payment_Method']] },
  customer: { alias: 'ct', join: 'JOIN DIM_CUSTOMER_TYPE ct ON f.Customer_Type_Key = ct.Customer_Type_Key', cols: [[], ['ct.Customer_Type']] },
};
const sqlValue = (dim, level, part, idx) => {
  if (dim === 'time' && level >= 2 && idx === 1) return String(Number(String(part).replace('Q', '')));
  if (dim === 'time' && idx === 0) return String(Number(part));
  return "'" + String(part).replace(/'/g, "''") + "'";
};

export function toSQL(state) {
  const used = new Set(state.axes);
  Object.keys(state.filters).forEach((d) => used.add(d));
  const select = [];
  state.axes.forEach((d) => select.push(...SQL[d].cols[state.levels[d]]));
  const where = [];
  for (const [dim, f] of Object.entries(state.filters)) {
    const cols = SQL[dim].cols[f.level];
    const conds = f.keys.map((k) => {
      const parts = k.split(SEP);
      return '(' + cols.map((c, i) => `${c} = ${sqlValue(dim, f.level, parts[i], i)}`).join(' AND ') + ')';
    });
    where.push(conds.length > 1 ? '(' + conds.join('\n       OR ') + ')' : conds[0]);
  }
  const lines = [
    'SELECT ' + [...select, 'SUM(f.Sales)    AS Total_Sales', 'SUM(f.Profit)   AS Total_Profit', 'SUM(f.Quantity) AS Total_Quantity'].join(',\n       '),
    'FROM   FACT_SALES f',
    ...[...used].map((d) => '       ' + SQL[d].join),
  ];
  if (where.length) lines.push('WHERE  ' + where.join('\n  AND  '));
  if (select.length) { lines.push('GROUP BY ' + select.join(', ')); lines.push('ORDER BY ' + select.join(', ') + ';'); } else lines[lines.length - 1] += ';';
  return lines.join('\n');
}

export function describeAxes(state) {
  return state.axes.map((d, i) => `${'XYZ'[i]}: ${DIMS[d].name} › ${DIMS[d].levels[state.levels[d]].name}`).join('   |   ');
}
