# SmartDMart: full-stack retail analytics

*SmartDMart: A Data-Driven Retail Intelligence System Using OLAP and Data Mining* (college project).

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Three.js (3D OLAP cube), Recharts |
| Backend | Node.js 22 (built-in `http`, `crypto`, `node:sqlite`), no native add-ons |
| Database | SQLite file (`server/data/smartdmart.db`): users, activity log, uploaded datasets |
| Data source | `src/data/DMart_Dataset.csv` (bundled) **or any retail CSV you upload** (column mapping + cleaning on the server) |

## Pages
| Page | What it does |
|------|--------------|
| **Login** | Sign in or create an account. Passwords are hashed with scrypt; sessions use signed 8-hour tokens; 5 failed logins lock an account/IP for 15 minutes. |
| **Dashboard** | Total Sales/Profit/Quantity, sales by month, category, store, city; profit analysis; payment and customer split; filters for date, category, store, city, payment, customer type. |
| **3D OLAP Cube** | Three.js cube (Product × Time × Store/Location) with working Roll-up, Drill-down, Slice, Dice and Pivot, result log, drill-through, CSV export and the equivalent SQL. |
| **Power BI Analysis** | Power BI-style page (decomposition tree, category × store matrix, waterfall, bubble chart, cumulative line, key influencers) plus a connection kit: export key, Power Query M script, DAX measures. |
| **Data Mining** | ABC analysis, k-means segments, decision-tree classifier (with test accuracy and baseline), anomaly detection, correlation matrix, and an explanation of why association rules do not apply to this dataset. |
| **Forecasting** | Server-side forecasts for 3–12 months with five models, back-testing (MAE, MAPE, RMSE), best-model selection, 95% intervals, category outlook, what-if slider. |
| **Data Model** | Star schema (matches your draw.io file) and snowflake schema diagrams, built from your data with integrity checks, CSV export and MySQL DDL. |
| **Reports** (new) | Daily / 7-day / 30-day / monthly / whole-dataset / custom-range report with KPIs vs the previous period, auto-written findings, trend chart, category / store / city / product / payment tables. **Download PDF**, **Download CSV** or **Print**. |
| **Datasets** | Dataset library plus an upload wizard for **any retail CSV**: columns are auto-detected and can be corrected by hand, a live preview shows what will be analysed, then every page switches to the new data. Switch back or delete any time. |
| **Data Quality** | Every validation rule, every rejected/repaired row, and how the uploaded file's columns were interpreted. |
| **Administration** (admin) | User roles, deletion, activity log. |
| **Methodology** | KDD process, architecture, and which tools are built in vs external (replaces the old "Project Modules" slides). |

## Analysing a different retail dataset (new)
1. Sign in as **admin** → **Datasets** → *Choose CSV file* (or click *Try the sample US retail dataset*).
2. The wizard guesses which column is the date, sales, profit/cost, product, category, store, city, quantity, discount, payment and customer type. Fix any dropdown that is wrong, pick the currency and (if needed) the date format.
3. Check the preview (rows read / analysed / repaired / rejected and the plain-language notes), then press **Analyse this dataset**. Dashboard, 3D cube, Power BI page, mining, forecasting, data model and exports all switch to it.

What is required: a **date**, a **product** (or category), **sales** (or unit price × quantity) and **profit or cost**. Everything else is optional: missing columns get a neutral label ("Unknown", "All stores") or a sensible default (quantity 1).
What happens automatically: dates in dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd, "5 Jan 2025", "Mar 7, 2024" or Excel serials; `$ € £ ₹` and thousands separators in numbers; discounts as fraction (0.2) or percent (20); repeated order IDs (several lines per order) become separate lines; Cost = Sales − Profit (or Profit = Sales − Cost) when one is missing; a unit-price column that does not explain Sales (a list price) is ignored instead of rejecting every row.
The same validation rules (R1–R5, F1–F4) run on the new file; the DMart file itself still yields exactly 994 accepted / 6 rejected.

`sample_data/US_Retail_Sample.csv` is a **synthetic** demo file (3,200 rows, 2023–2024, US-style columns, dollars, 4 deliberately bad rows). It is generated data, not a real company's sales, and exists only to show the feature. Real-world files such as Kaggle's "Superstore" or "Supermarket sales" use the same kind of columns and should map automatically.
Limits: upload size 25 MB; very high-cardinality columns (hundreds of cities) are fine in the cube and tables, and the dashboard shows the top 12 plus "Other". The pipeline expects one row = one order line.

## Reports and “today’s sales” (new)
1. Sign in as admin → **Datasets** → load today’s sales CSV (DMart layout loads as-is; other layouts use the column wizard).
2. Press **Build the report (PDF / CSV)**. The report opens on **Latest day** (the newest date in the file, so a one-day file is analysed as “today”).
3. Change the period if you like (Last 7 / 30 days, Latest month, Entire dataset, Custom range) and press **Download PDF** or **Download CSV**.

What the report contains: totals and averages with % change against the equal-length period just before; 6–9 plain-English findings generated from the numbers (top category, best/weakest store, best product, loss-making products, discount effect, best day, strongest weekday, data-quality note); a daily or monthly trend chart; ranked tables by category, store, city, product, payment method and customer type.
The PDF is built on the server with a small built-in writer (no libraries needed). It uses the standard PDF fonts, so the rupee sign is printed as **Rs.** in the PDF (the screen and CSV keep ₹). The CSV is one flat table that opens in Excel.

Automation (e.g. a scheduled job that fetches the morning PDF), using an export key from **My account**:
`GET /api/export/report.pdf?scope=latest&key=<export key>` · `report.csv` · `report.json`
`scope` = `latest | 7d | 30d | month | all | custom` (custom also takes `from=YYYY-MM-DD&to=YYYY-MM-DD`).


## Themes and effects
Three themes, switched with the round swatches at the top right (the choice is remembered in the browser):
- **Midnight** (default): deep indigo-black with violet and cyan accents.
- **Pearl**: clean light theme with indigo and teal.
- **Graphite**: neutral charcoal with gold.

Colours are CSS variables at the top of `src/styles.css` (one block per theme) and `src/theme.js` (chart colours). To add a theme, copy a block, change the values, and add an entry to `THEMES` in `src/theme.js`.
Effects: soft animated background glow, glass-style cards with a spotlight that follows the pointer, a rotating light edge on the main KPI card, shine sweep on primary buttons, count-up numbers, staggered page entrance, growing bars, sliding menu marker, themed charts and tooltips, shimmer loading skeleton. All motion is switched off for “reduce motion” and for printing (print always uses a plain white theme).
Interface text was cut to labels and short status lines; the explanations live in the Methodology page and this README.

## Run on Windows
1. Install **Node.js LTS (version 22 or newer)** from https://nodejs.org (the backend needs Node 22.13+ for the built-in SQLite).
2. Unzip the project (for example to `C:\smartdmart`), open PowerShell in that folder (File Explorer → click the address bar → type `powershell` → Enter).
3. Install: `npm install`
4. Start frontend and backend together: `npm run dev`
5. Open **http://localhost:5173** and sign in.

Demo accounts (shown on the login page only while `ADMIN_PASSWORD` is not set): `admin` / `Admin@123` and `analyst` / `Analyst@123`.

Other commands: `npm test` (52 data, analytics, mapping and report tests + 23 API tests), `npm run build`, `npm start` (production server: API + built site on http://localhost:4000).

## Deploy online (a real server is required because of the backend)
Static hosts (GitHub Pages, plain Netlify drop) will **not** work. Use a Node host such as **Render**, **Railway** or **Fly.io**:
1. Push the project to GitHub.
2. Create a *Web Service*: build command `npm install && npm run build`, start command `npm start`.
3. Set environment variables: `ADMIN_PASSWORD` (your admin password), `JWT_SECRET` (a long random string), `NODE_ENV=production`.
4. SQLite lives in `server/data`. On hosts with ephemeral disks, attach a persistent disk there (or accept that accounts and uploads reset on redeploy).
5. Open the URL the host gives you. A `Dockerfile` is included for Docker-based hosts.

With `ADMIN_PASSWORD` set, the demo accounts are not created with known passwords and the login page does not show them.

## API
`POST /api/auth/login|register` · `GET /api/auth/me` · `POST /api/auth/change-password` · `POST /api/auth/api-key` · `GET /api/export/report.pdf|csv|json` · `GET /api/dataset` · `GET /api/datasets` · `POST /api/dataset` (admin, body: `name`, `csv`, optional `mapping`, `currency`, `dateOrder`) · `POST /api/datasets/<id>/activate` and `DELETE /api/datasets/<id>` (admin) · `GET /api/forecast?horizon=&category=&store=` · `GET /api/mining?target=highValue|highMargin` · `GET /api/export/cleaned.csv|star/<T>.csv|snowflake/<T>.csv` · `GET /api/admin/users|activity` (admin) · `GET /api/health`.

## Data handling (unchanged, enforced on the server)
1000 rows read → **994 accepted, 6 rejected, 5 repaired**. Rejected: orders 1 and 100 (invalid dates), 10 (quantity 0), 25 (negative sales), 40 (discount 120%), 150 (negative selling price). Repaired: 55 (spaces), 70 (brand typo), 85 (missing payment → Unknown), 125 (double space, wrong category and brand), 175 (missing category). KPIs: Sales ₹7,48,839.75, Profit ₹1,65,662.79, Quantity 4,579, all cross-checked with an independent pandas script (`docs/python/mining_validation.py`).

## Honest notes for your viva
* **Forecast:** this one-year dataset has no real trend (R² ≈ 0.01), and no model clearly beats "use the average month". The site says so on screen instead of showing false precision.
* **Discount drives margin:** in the data, margin is almost exactly 28% minus 1.8 points per 5% discount; the mining pages show this.
* **Association rules** are not run: each order has one product and there is no customer ID.
* **Power BI:** a `.pbix` can only be authored in Power BI Desktop. The site provides the live connection, M script and DAX instead (written from documented syntax, not run in Power BI).
* **KNIME, Mondrian, WEKA, MySQL, Metabase** are external tools: guides and files are in `docs/` and are labelled as such. The Mondrian XML is a draft that was not tested.
* Your OLAP diagram says "Flask"; this build uses Node.js for the backend.
* The star schema follows your file's `DIM_*` names (your message said `DM_*`).

## Verification status
Verified in the build environment: all 56 automated tests pass (including real HTTP tests of login, roles, throttling, dataset upload, forecasts, mining, exports and static hosting); results match pandas; every page renders without errors against real API data; the Three.js scene code runs against a stubbed three.js.
**Not verified there** (no internet): `npm install`, `vite build`, real Recharts charts and WebGL (the 3D cube with the new colours), Docker. For the dataset feature, the upload wizard and pages were driven in headless Chromium against the real server with the chart libraries stubbed, so layout, data flow and currency switching were checked but the chart drawings themselves were not. Run `npm install && npm run dev` and click through each page once before your demo, and tell me about anything that looks wrong.

## Folder structure
```
smartdmart/
├─ package.json, vite.config.js, index.html, Dockerfile
├─ scripts/dev.mjs                 starts API + Vite together
├─ server/  index.js app.js db.js auth.js analytics.js
├─ src/
│  ├─ App.jsx api.js auth.jsx main.jsx styles.css theme.js
│  ├─ data/DMart_Dataset.csv
│  ├─ lib/  pipeline mapping report pdf csv olap star mining stats filters format powerbi exportCsv
│  └─ components/  Login CubeScene CubeLab Datasets Reports CountUp Dashboard Analytics DataMining Forecast DataModel DataQuality Admin Account Methodology FilterBar
├─ sample_data/US_Retail_Sample.csv   synthetic second dataset for trying the upload
├─ tests/  run.mjs api.mjs
└─ docs/   knime, mondrian, mysql (star + snowflake), python, weka_guide.md, powerbi_metabase_guide.md
```
