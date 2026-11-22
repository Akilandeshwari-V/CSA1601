"""
Independent pandas re-implementation of the SmartDMart cleaning + mining steps.
Purpose: cross-check the numbers shown by the website (React/JS) against Python.

Usage (Windows PowerShell):
    pip install pandas numpy scikit-learn
    python docs/python/mining_validation.py src/data/DMart_Dataset.csv
"""
import sys
import numpy as np
import pandas as pd

path = sys.argv[1] if len(sys.argv) > 1 else "src/data/DMart_Dataset.csv"
raw = pd.read_csv(path, dtype=str, keep_default_na=False)

# ---------- cleaning (same rules as src/lib/pipeline.js) ----------
for c in ["Store", "City", "Product", "Category", "Brand", "Payment_Method", "Customer_Type"]:
    raw[c] = raw[c].str.replace(r"\s+", " ", regex=True).str.strip()
num = lambda c: pd.to_numeric(raw[c], errors="coerce")
raw["date"] = pd.to_datetime(raw["Order_Date"], format="%d-%m-%Y", errors="coerce")
q, sales, cost, profit = num("Quantity"), num("Sales"), num("Cost"), num("Profit")
sp, disc = num("Selling_Price"), num("Discount_%")
bad = (
    raw["date"].isna() | q.isna() | (q <= 0) | sales.isna() | (sales <= 0) | cost.isna() | (cost < 0)
    | profit.isna() | (sp <= 0) | (disc < 0) | (disc > 100)
    | ((sp * q - sales).abs() > 0.05) | ((sales - cost - profit).abs() > 0.05)
    | raw["Order_ID"].duplicated()
)
print("rows read     :", len(raw))
print("rows rejected :", int(bad.sum()), "-> Order_IDs", raw.loc[bad, "Order_ID"].tolist())
df = raw.loc[~bad].copy()
for c in ["Quantity", "Sales", "Cost", "Profit"]:
    df[c] = pd.to_numeric(df[c])
# product -> category/brand majority repair
for c in ["Category", "Brand"]:
    maj = df[df[c] != ""].groupby("Product")[c].agg(lambda s: s.value_counts().index[0])
    df[c] = df["Product"].map(maj).fillna(df[c])
df["Payment_Method"] = df["Payment_Method"].replace("", "Unknown")
df["Customer_Type"] = df["Customer_Type"].replace("", "Unknown")

print("accepted      :", len(df))
print("Total Sales   : %.2f" % df.Sales.sum())
print("Total Profit  : %.2f" % df.Profit.sum())
print("Total Quantity:", int(df.Quantity.sum()))

# ---------- monthly series + linear trend forecast ----------
m = df.groupby(df.date.dt.month).Sales.sum()
t = np.arange(len(m))
slope, intercept = np.polyfit(t, m.values, 1)
pred = intercept + slope * t
r2 = 1 - ((m.values - pred) ** 2).sum() / ((m.values - m.values.mean()) ** 2).sum()
print("\nMonthly sales:", [round(v, 2) for v in m.values])
print("Trend slope per month: %.4f  intercept: %.4f  R2: %.4f" % (slope, intercept, r2))
print("Forecast next 3 months:", [round(intercept + slope * (len(m) + i), 2) for i in range(3)])

# ---------- ABC analysis ----------
p = df.groupby("Product").Sales.sum().sort_values(ascending=False)
share = p / p.sum()
before = share.cumsum() - share
abc = np.where(before < 0.80, "A", np.where(before < 0.95, "B", "C"))
print("\nABC classes:", dict(zip(*np.unique(abc, return_counts=True))))

# ---------- weekday pattern ----------
w = df.groupby(df.date.dt.weekday).Sales.sum()  # Monday=0
print("\nSales by weekday (Mon..Sun):", [round(v, 2) for v in w.reindex(range(7)).fillna(0).values])

# ---------- optional k-means on product features (sklearn) ----------
try:
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler
    g = df.groupby("Product").agg(sales=("Sales", "sum"), profit=("Profit", "sum"), qty=("Quantity", "sum"))
    g["margin"] = g.profit / g.sales
    g["unit_price"] = g.sales / g.qty
    X = StandardScaler().fit_transform(g[["sales", "margin", "unit_price"]])
    km = KMeans(n_clusters=3, n_init=10, random_state=42).fit(X)
    g["cluster"] = km.labels_
    print("\nK-means (k=3) cluster sizes:", g.cluster.value_counts().to_dict())
except ImportError:
    print("\n(scikit-learn not installed - skipping k-means)")
