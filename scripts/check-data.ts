import { DEMO_DEAL, ERP_PRODUCTS, PRODUCT_SKU_MAP } from "../lib/demo-data";

const total = DEMO_DEAL.line_items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
const skusOk = DEMO_DEAL.line_items.every((l) => {
  const sku = PRODUCT_SKU_MAP[l.product_name];
  return sku && ERP_PRODUCTS.some((p) => p.sku === sku);
});

console.log("Line total:", total, "| Deal amount:", DEMO_DEAL.deal_amount);
console.log("All products map to ERP SKUs:", skusOk);
if (total !== DEMO_DEAL.deal_amount || !skusOk) {
  console.error("Demo data is inconsistent");
  process.exit(1);
}
console.log("OK");
