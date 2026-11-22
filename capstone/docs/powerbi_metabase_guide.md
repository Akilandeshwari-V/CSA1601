# Power BI / Metabase (external tools)

The website's **Power BI Analysis** page has the same visuals plus a ready-made connection kit:

1. Sign in → Power BI Analysis → *Generate export key* (valid 30 days, usable only for CSV downloads).
2. Power BI Desktop → Get data → Blank query → Advanced editor → paste the M script from the page (or `GET /api/export/...` URLs below).
3. Create the five relationships in Model view (dimension `*_Key` → `FACT_SALES` `*_Key`, one-to-many, single direction) and mark `DIM_DATE[Order_Date]` as the date table.
4. Paste the DAX measures from the page (Total Sales, Total Profit, Total Quantity, Profit Margin %, Running Sales, Pareto, MoM).
5. Build: cards, Category × Store matrix, decomposition tree, waterfall, scatter, cumulative line, Key influencers (target = Profit Margin %).

Export endpoints (`?key=<export key>` or `Authorization: Bearer <token>`):
`/api/export/cleaned.csv`, `/api/export/star/<TABLE>.csv`, `/api/export/snowflake/<TABLE>.csv`.
Star tables: FACT_SALES, DIM_PRODUCT, DIM_DATE, DIM_STORE, DIM_PAYMENT, DIM_CUSTOMER_TYPE.
Snowflake adds: DIM_BRAND, DIM_CATEGORY, DIM_MONTH, DIM_QUARTER, DIM_YEAR, DIM_CITY.

Limits: a `.pbix` file can only be authored in Power BI Desktop, and the M/DAX text was not executed in the build environment, so test it once. Power BI Desktop must be able to reach the server address (use `localhost` on the same PC, or your deployed URL).

## Metabase
Load `docs/mysql/schema.sql` (or `snowflake_schema.sql`) into MySQL, import the CSV exports, add the database to Metabase, and rebuild the questions with the SQL shown in the "Equivalent SQL" panel of the 3D OLAP Cube page.
