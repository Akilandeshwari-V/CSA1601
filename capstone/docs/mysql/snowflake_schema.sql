-- SmartDMart snowflake schema (MySQL 8): the star schema's dimensions normalised into hierarchy tables.
CREATE DATABASE IF NOT EXISTS smartdmart_snowflake;
USE smartdmart_snowflake;

CREATE TABLE DIM_CATEGORY (Category_Key INT PRIMARY KEY, Category VARCHAR(50) NOT NULL);
CREATE TABLE DIM_BRAND (
  Brand_Key INT PRIMARY KEY, Brand VARCHAR(50) NOT NULL, Category_Key INT NOT NULL,
  FOREIGN KEY (Category_Key) REFERENCES DIM_CATEGORY(Category_Key));
CREATE TABLE DIM_PRODUCT (
  Product_Key INT PRIMARY KEY, Product VARCHAR(100) NOT NULL, Brand_Key INT NOT NULL,
  FOREIGN KEY (Brand_Key) REFERENCES DIM_BRAND(Brand_Key));

CREATE TABLE DIM_YEAR (Year_Key SMALLINT PRIMARY KEY, Year SMALLINT NOT NULL);
CREATE TABLE DIM_QUARTER (
  Quarter_Key INT PRIMARY KEY, Quarter TINYINT NOT NULL, Year_Key SMALLINT NOT NULL,
  FOREIGN KEY (Year_Key) REFERENCES DIM_YEAR(Year_Key));
CREATE TABLE DIM_MONTH (
  Month_Key INT PRIMARY KEY, Month TINYINT NOT NULL, Quarter_Key INT NOT NULL,   -- Month_Key = yyyymm, Quarter_Key = yyyyq
  FOREIGN KEY (Quarter_Key) REFERENCES DIM_QUARTER(Quarter_Key));
CREATE TABLE DIM_DATE (
  Date_Key INT PRIMARY KEY, Order_Date DATE NOT NULL, Day TINYINT NOT NULL, Month_Key INT NOT NULL,  -- Date_Key = yyyymmdd
  FOREIGN KEY (Month_Key) REFERENCES DIM_MONTH(Month_Key));

CREATE TABLE DIM_CITY (City_Key INT PRIMARY KEY, City VARCHAR(50) NOT NULL);
CREATE TABLE DIM_STORE (
  Store_Key INT PRIMARY KEY, Store VARCHAR(50) NOT NULL, City_Key INT NOT NULL,
  FOREIGN KEY (City_Key) REFERENCES DIM_CITY(City_Key));

CREATE TABLE DIM_PAYMENT (Payment_Key INT PRIMARY KEY, Payment_Method VARCHAR(30) NOT NULL);
CREATE TABLE DIM_CUSTOMER_TYPE (Customer_Type_Key INT PRIMARY KEY, Customer_Type VARCHAR(30) NOT NULL);

CREATE TABLE FACT_SALES (
  Sales_ID INT PRIMARY KEY,
  Product_Key INT NOT NULL, Date_Key INT NOT NULL, Store_Key INT NOT NULL, Payment_Key INT NOT NULL, Customer_Type_Key INT NOT NULL,
  Quantity INT NOT NULL, Sales DECIMAL(12,2) NOT NULL, Cost DECIMAL(12,2) NOT NULL, Profit DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (Product_Key) REFERENCES DIM_PRODUCT(Product_Key),
  FOREIGN KEY (Date_Key) REFERENCES DIM_DATE(Date_Key),
  FOREIGN KEY (Store_Key) REFERENCES DIM_STORE(Store_Key),
  FOREIGN KEY (Payment_Key) REFERENCES DIM_PAYMENT(Payment_Key),
  FOREIGN KEY (Customer_Type_Key) REFERENCES DIM_CUSTOMER_TYPE(Customer_Type_Key));

-- Load order: DIM_CATEGORY, DIM_BRAND, DIM_PRODUCT, DIM_YEAR, DIM_QUARTER, DIM_MONTH, DIM_DATE, DIM_CITY, DIM_STORE,
-- DIM_PAYMENT, DIM_CUSTOMER_TYPE, then FACT_SALES. CSVs: Data Model page of the website, or GET /api/export/snowflake/<TABLE>.csv

-- Example: sales by category now needs three extra joins that the star schema does not:
-- SELECT c.Category, SUM(f.Sales) FROM FACT_SALES f
--   JOIN DIM_PRODUCT p ON f.Product_Key = p.Product_Key
--   JOIN DIM_BRAND b ON p.Brand_Key = b.Brand_Key
--   JOIN DIM_CATEGORY c ON b.Category_Key = c.Category_Key GROUP BY c.Category;
