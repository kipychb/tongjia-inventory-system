import test from "node:test";
import assert from "node:assert/strict";
import { calculateReorderQuantity } from "./replenishment.mjs";

test("calculates normal replenishment from demand, safety stock, and inventory position", () => {
  const result = calculateReorderQuantity({
    productId: "A1",
    forecastDemand: 20,
    safetyStock: 5,
    onHand: 8,
  });

  assert.equal(result.inventoryPosition, 8);
  assert.equal(result.targetStock, 25);
  assert.equal(result.suggestedQuantity, 17);
  assert.equal(result.needsReplenishment, true);
});

test("does not replenish when inventory position meets target stock", () => {
  const result = calculateReorderQuantity({
    productId: "A2",
    forecastDemand: 20,
    safetyStock: 5,
    onHand: 15,
    onOrder: 10,
  });

  assert.equal(result.inventoryPosition, 25);
  assert.equal(result.suggestedQuantity, 0);
  assert.equal(result.needsReplenishment, false);
});

test("subtracts backorders and includes outstanding orders in inventory position", () => {
  const result = calculateReorderQuantity({
    productId: "A3",
    forecastDemand: 20,
    safetyStock: 5,
    onHand: 10,
    onOrder: 8,
    backorders: 3,
  });

  assert.equal(result.inventoryPosition, 15);
  assert.equal(result.suggestedQuantity, 10);
});

test("increased forecast demand increases the suggested quantity", () => {
  const base = calculateReorderQuantity({
    productId: "A4",
    forecastDemand: 20,
    safetyStock: 5,
    onHand: 10,
  });
  const increased = calculateReorderQuantity({
    productId: "A4",
    forecastDemand: 30,
    safetyStock: 5,
    onHand: 10,
  });

  assert.equal(base.suggestedQuantity, 15);
  assert.equal(increased.suggestedQuantity, 25);
});

test("applies an explicitly supplied minimum quantity and order multiple", () => {
  const result = calculateReorderQuantity({
    productId: "A5",
    forecastDemand: 10,
    safetyStock: 0,
    onHand: 8,
    minimumOrderQuantity: 6,
    orderMultiple: 4,
  });

  assert.equal(result.unconstrainedQuantity, 2);
  assert.equal(result.suggestedQuantity, 8);
});

test("validates required fields and rejects invalid or negative numeric inputs", () => {
  assert.throws(() => calculateReorderQuantity(), /productId is required/);
  assert.throws(() => calculateReorderQuantity({ productId: "A" }), /forecastDemand must be a finite number/);
  assert.throws(
    () => calculateReorderQuantity({ productId: "A", forecastDemand: -1, safetyStock: 0, onHand: 0 }),
    /forecastDemand must be greater than or equal to 0/,
  );
  assert.throws(
    () => calculateReorderQuantity({ productId: "A", forecastDemand: 1, safetyStock: 0, onHand: 0, onOrder: Infinity }),
    /onOrder must be a finite number/,
  );
  assert.throws(
    () => calculateReorderQuantity({ productId: "A", forecastDemand: 1, safetyStock: 0, onHand: 0, orderMultiple: 0 }),
    /orderMultiple must be greater than 0/,
  );
});

test("an unusual large demand remains a suggestion for review, not a rejected order", () => {
  const result = calculateReorderQuantity({
    productId: "RAINCOAT",
    forecastDemand: 999,
    safetyStock: 0,
    onHand: 0,
  });

  assert.equal(result.suggestedQuantity, 999);
  assert.equal(result.needsReplenishment, true);
});
