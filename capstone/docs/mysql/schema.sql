-- SmartDMart data warehouse (MySQL 8) - mirrors SmartDMart_Star_Schema.drawio
CREATE DATABASE IF NOT EXISTS smartdmart;
USE smartdmart;

CREATE TABLE DIM_PRODUCT (
  Product_Key INT PRIMARY KEY,
  Product     VARCHAR(100) NOT NULL,
  Category    VARCHAR(50)  NOT NULL,
  Brand       VARCHAR(50)  NOT NULL
);

CREATE TABLE DIM_DATE (
  Date_Key   INT PRIMARY KEY,          -- yyyymmdd
  Order_Date DATE NOT NULL,
  Day        TINYINT NOT NULL,
  Month      TINYINT NOT NULL,
  Quarter    TINYINT NOT NULL,
  Year       SMALLINT NOT NULL
);

CREATE TABLE DIM_STORE (
  Store_Key INT PRIMARY KEY,
  Store     VARCHAR(50) NOT NULL,
  City      VARCHAR(50) NOT NULL
);

CREATE TABLE DIM_PAYMENT (
  Payment_Key    INT PRIMARY KEY,
  Payment_Method VARCHAR(30) NOT NULL
);

CREATE TABLE DIM_CUSTOMER_TYPE (
  Customer_Type_Key INT PRIMARY KEY,
  Customer_Type     VARCHAR(30) NOT NULL
);

CREATE TABLE FACT_SALES (
  Sales_ID          INT PRIMARY KEY,
  Product_Key       INT NOT NULL,
  Date_Key          INT NOT NULL,
  Store_Key         INT NOT NULL,
  Payment_Key       INT NOT NULL,
  Customer_Type_Key INT NOT NULL,
  Quantity          INT NOT NULL,
  Sales             DECIMAL(12,2) NOT NULL,
  Cost              DECIMAL(12,2) NOT NULL,
  Profit            DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (Product_Key)       REFERENCES DIM_PRODUCT(Product_Key),
  FOREIGN KEY (Date_Key)          REFERENCES DIM_DATE(Date_Key),
  FOREIGN KEY (Store_Key)         REFERENCES DIM_STORE(Store_Key),
  FOREIGN KEY (Payment_Key)       REFERENCES DIM_PAYMENT(Payment_Key),
  FOREIGN KEY (Customer_Type_Key) REFERENCES DIM_CUSTOMER_TYPE(Customer_Type_Key)
);

-- Load order: the five DIM_* tables first, then FACT_SALES.
-- CSV files for every table can be exported from the "Star Schema" tab of the website.
-- Example (MySQL Workbench "Table Data Import Wizard", or):
-- LOAD DATA LOCAL INFILE 'DIM_PRODUCT.csv' INTO TABLE DIM_PRODUCT
--   FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\r\n' IGNORE 1 LINES;
