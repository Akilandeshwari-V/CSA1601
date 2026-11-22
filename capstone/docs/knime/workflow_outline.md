# KNIME ETL workflow outline (external tool, documented only)

This workflow is **not executed by the website**. The website re-implements the same cleaning rules in `src/lib/pipeline.js` so you can compare results (expected: 1000 rows read, 994 kept, 6 rejected).

| # | KNIME node | Setting |
|---|-----------|---------|
| 1 | CSV Reader | `DMart_Dataset.csv`, first row = header, read all columns as String |
| 2 | String Manipulation | `trim(replaceAll($col$, "\\s+", " "))` on Store, City, Product, Category, Brand, Payment_Method, Customer_Type |
| 3 | String to Date&Time | Order_Date, format `dd-MM-yyyy`; fail on error → rows with `+` or `2025/99/99` become missing |
| 4 | String to Number | Quantity, Original_Price, Discount_%, Selling_Price, Sales, Cost, Profit |
| 5 | Rule-based Row Filter | keep rows where Order_Date, Quantity, Sales, Cost, Profit are not missing AND Quantity > 0 AND Sales > 0 AND Cost >= 0 AND Selling_Price > 0 AND Discount_% between 0 and 100 AND abs(Selling_Price*Quantity - Sales) <= 0.05 AND abs(Sales-Cost-Profit) <= 0.05 |
| 6 | Duplicate Row Filter | on Order_ID |
| 7 | Missing Value | Payment_Method, Customer_Type → fixed value `Unknown` |
| 8 | GroupBy (Product) → Joiner | build Product → majority Category / Brand, join back and replace conflicting/empty Category and Brand |
| 9 | Date&Time to String + Extract Date&Time Fields | Date_Key (yyyyMMdd), Day, Month, Quarter, Year |
| 10 | GroupBy / Duplicate Row Filter + Counter (or RowID) | build DIM_PRODUCT, DIM_DATE, DIM_STORE, DIM_PAYMENT, DIM_CUSTOMER_TYPE with surrogate keys |
| 11 | Joiner ×5 | attach the five keys to the fact rows → FACT_SALES (Sales_ID = Order_ID) |
| 12 | DB Connector (MySQL) + DB Writer | write the six tables created by `docs/mysql/schema.sql` |

Tip: the website's **Star Schema** tab exports all six tables as CSV, so you can compare KNIME's output with the website's output.
