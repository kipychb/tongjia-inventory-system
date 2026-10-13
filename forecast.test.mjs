import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getHistorySales,
  predictDemand,
  predictDemandFromSalesData,
} from "./forecast.mjs";
import { calculateReorderQuantity } from "./replenishment.mjs";

const salesData = JSON.parse(
  readFileSync(new URL("./sales_data.json", import.meta.url), "utf8"),
);

test("A2 forecasts normal demand from supplied history", () => {
  assert.deepEqual(
    predictDemand({ productId: "P001", historySales: [45, 48] }),
    { productId: "P001", forecastDemand: 47 },
  );
});

test("A2 applies holiday and promotion multipliers", () => {
  const result = predictDemand({
    productId: "P001",
    historySales: [50, 50, 50],
    isHoliday: true,
    isPromotion: true,
  });
  assert.equal(result.forecastDemand, 78);
});

test("A2 adds explicit special demand", () => {
  const result = predictDemand({
    productId: "P002",
    historySales: [2, 3],
    specialDemand: 150,
  });
  assert.equal(result.forecastDemand, 153);
});

test("selects and forecasts latest available P001 records from sales_data.json", () => {
  assert.deepEqual(getHistorySales(salesData, "P001"), [48, 65, 70]);
  assert.deepEqual(
    predictDemandFromSalesData({ salesData, productId: "P001" }),
    { productId: "P001", forecastDemand: 61 },
  );
});

test("keeps special-event history unless policy says otherwise", () => {
  assert.deepEqual(getHistorySales(salesData, "P002"), [3, 4, 150]);
});

test("rejects missing product history and invalid inputs", () => {
  assert.throws(() => getHistorySales(salesData, "UNKNOWN"), /No sales records found/);
  assert.throws(
    () => predictDemand({ productId: "P001", historySales: [] }),
    /historySales must be a non-empty array/,
  );
  assert.throws(
    () => predictDemand({ productId: "P001", historySales: [10], days: 0 }),
    /days must be a positive integer/,
  );
});

test("A1 + A2: file-backed forecast feeds replenishment", () => {
  const forecast = predictDemandFromSalesData({
    salesData, productId: "P001", isHoliday: true,
  });
  const result = calculateReorderQuantity({
    ...forecast, safetyStock: 10, onHand: 20,
  });
  assert.equal(forecast.forecastDemand, 73);
  assert.equal(result.suggestedQuantity, 63);
});
