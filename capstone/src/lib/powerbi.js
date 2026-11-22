// Power BI connection assets, generated from one place so the website, the docs and the downloads never drift apart.
export const EXPORT_TABLES = {
  star: ['FACT_SALES', 'DIM_PRODUCT', 'DIM_DATE', 'DIM_STORE', 'DIM_PAYMENT', 'DIM_CUSTOMER_TYPE'],
  snowflake: ['DIM_CATEGORY', 'DIM_BRAND', 'DIM_YEAR', 'DIM_QUARTER', 'DIM_MONTH', 'DIM_CITY'],
};

export function mScript(baseUrl, key = 'PASTE_YOUR_EXPORT_KEY_HERE') {
  const q = (name) => `    ${name} = Load("star/${name}.csv")`;
  return `// SmartDMart → Power BI (Power Query M). Power BI Desktop: Home > Get data > Blank query > Advanced Editor > paste.
// Then choose "Anonymous" when asked for credentials (the key travels in the URL).
let
    BaseUrl = "${baseUrl}/api/export/",
    ApiKey  = "${key}",
    Load = (path as text) as table =>
        Table.PromoteHeaders(
            Csv.Document(
                Web.Contents(BaseUrl, [RelativePath = path, Query = [key = ApiKey]]),
                [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
            [PromoteAllScalars = true]),
    FactRaw = Load("star/FACT_SALES.csv"),
    FACT_SALES = Table.TransformColumnTypes(FactRaw, {
        {"Sales_ID", Int64.Type}, {"Product_Key", Int64.Type}, {"Date_Key", Int64.Type}, {"Store_Key", Int64.Type},
        {"Payment_Key", Int64.Type}, {"Customer_Type_Key", Int64.Type},
        {"Quantity", Int64.Type}, {"Sales", type number}, {"Cost", type number}, {"Profit", type number}}),
    // Use the same pattern for every dimension, e.g. in separate queries:
${['DIM_PRODUCT', 'DIM_DATE', 'DIM_STORE', 'DIM_PAYMENT', 'DIM_CUSTOMER_TYPE'].map(q).join(',\n')}
in
    FACT_SALES
// Tip: create one query per table (replace the last line with the table name you want), so Power BI shows six tables.`;
}

export const DAX = `-- SmartDMart measures (DAX). Create them in a Measures table or on FACT_SALES.
Total Sales      = SUM ( FACT_SALES[Sales] )
Total Profit     = SUM ( FACT_SALES[Profit] )
Total Quantity   = SUM ( FACT_SALES[Quantity] )
Orders           = DISTINCTCOUNT ( FACT_SALES[Sales_ID] )
Profit Margin %  = DIVIDE ( [Total Profit], [Total Sales] )
Avg Order Value  = DIVIDE ( [Total Sales], [Orders] )

-- Share of total sales (use with DIM_PRODUCT[Category] or DIM_STORE[Store] on an axis)
Sales % of Total = DIVIDE ( [Total Sales], CALCULATE ( [Total Sales], ALL ( DIM_PRODUCT ), ALL ( DIM_STORE ) ) )

-- Cumulative sales over time (needs DIM_DATE marked as a date table on Order_Date)
Running Sales    = CALCULATE ( [Total Sales], FILTER ( ALL ( DIM_DATE ), DIM_DATE[Order_Date] <= MAX ( DIM_DATE[Order_Date] ) ) )

-- Category rank by profit
Category Rank    = RANKX ( ALL ( DIM_PRODUCT[Category] ), [Total Profit], , DESC, DENSE )

-- Pareto: cumulative share of sales by product, sorted by sales (use as a line on a column chart)
Product Cum %    =
VAR CurrentSales = [Total Sales]
VAR Cum = CALCULATE ( [Total Sales], FILTER ( ALL ( DIM_PRODUCT[Product] ), [Total Sales] >= CurrentSales ) )
RETURN DIVIDE ( Cum, CALCULATE ( [Total Sales], ALL ( DIM_PRODUCT[Product] ) ) )

-- Month-over-month change
Sales MoM %      =
VAR Prev = CALCULATE ( [Total Sales], DATEADD ( DIM_DATE[Order_Date], -1, MONTH ) )
RETURN DIVIDE ( [Total Sales] - Prev, Prev )`;

export const PBI_RELATIONSHIPS = [
  'DIM_PRODUCT[Product_Key] → FACT_SALES[Product_Key]', 'DIM_DATE[Date_Key] → FACT_SALES[Date_Key]', 'DIM_STORE[Store_Key] → FACT_SALES[Store_Key]',
  'DIM_PAYMENT[Payment_Key] → FACT_SALES[Payment_Key]', 'DIM_CUSTOMER_TYPE[Customer_Type_Key] → FACT_SALES[Customer_Type_Key]',
];
