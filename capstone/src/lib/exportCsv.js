import { toCSV } from './format.js';

export const CLEAN_COLS = ['Order_ID', 'Order_Date', 'Store', 'City', 'Product', 'Category', 'Brand', 'Quantity', 'Original_Price', 'Discount_%', 'Selling_Price', 'Sales', 'Cost', 'Profit', 'Payment_Method', 'Customer_Type'];

export function cleanedCSV(rows) {
  return toCSV(CLEAN_COLS, rows.map((r) => ({
    Order_ID: r.id, Order_Date: r.date, Store: r.store, City: r.city, Product: r.product, Category: r.category, Brand: r.brand, Quantity: r.qty,
    Original_Price: r.originalPrice ?? '', 'Discount_%': r.discount ?? '', Selling_Price: r.sellingPrice ?? '', Sales: r.sales, Cost: r.cost, Profit: r.profit,
    Payment_Method: r.payment, Customer_Type: r.customer,
  })));
}
