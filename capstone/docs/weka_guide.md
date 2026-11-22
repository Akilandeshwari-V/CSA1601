# Data mining with WEKA and Python (external tools, documented only)

WEKA is a Java desktop application and is not embedded in the website. The website runs lightweight equivalents (Module 3 → Mining Lab) and exports data for the external tools.

## Files to use
* **Product features CSV** – Project Modules → Module 3 → *Product analysis* → "Export product features". One row per product: Total_Sales, Total_Profit, Total_Quantity, Margin, Unit_Price, ABC_Class, Cluster.
* **Cleaned dataset CSV** – Data Quality tab → "Download cleaned dataset".

## WEKA steps
1. Explorer → *Open file…* → choose the CSV (WEKA reads CSV directly).
2. **Clustering** (product segments): Preprocess → remove `Product`, `Category`, `ABC_Class`, `Cluster` (Remove filter) → Standardize filter → Cluster tab → `SimpleKMeans`, numClusters = 3, seed 10. Compare cluster sizes with the website (website result is deterministic, sizes may differ slightly because WEKA's initialisation differs).
3. **Classification** (e.g. predict ABC class): Classify tab → `J48`, 10-fold cross-validation. Use only on the product file (20 rows is very small: report this limitation).
4. **Regression** (sales trend): build a monthly table (Month 1–12, Sales) from the Dashboard/Python output → Classify → `LinearRegression`. Compare slope and R² with the Prediction tab.

## Python
```
pip install pandas numpy scikit-learn
python docs/python/mining_validation.py src/data/DMart_Dataset.csv
```
Independent pandas implementation of the cleaning rules, KPIs, monthly series, linear regression, ABC classes, weekday pattern and k-means. Expected output includes: 994 accepted rows, Total Sales 748839.75, Total Profit 165662.79, Total Quantity 4579, trend slope -261.64 per month, R² 0.0126, ABC classes A=9, B=7, C=4.
