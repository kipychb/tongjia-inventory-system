/**
 * Calculate a store's replenishment suggestion for one product.
 *
 * forecastDemand must cover the same review + delivery period that the
 * caller intends to replenish. This module does not create or submit orders.
 */
export function calculateReorderQuantity({
  productId,
  forecastDemand,
  safetyStock,
  onHand,
  onOrder = 0,
  backorders = 0,
  minimumOrderQuantity = 0,
  orderMultiple = 1,
} = {}) {
  if (productId === undefined || productId === null || productId === "") {
    throw new TypeError("productId is required");
  }

  const inputs = {
    forecastDemand,
    safetyStock,
    onHand,
    onOrder,
    backorders,
    minimumOrderQuantity,
    orderMultiple,
  };
  for (const [name, value] of Object.entries(inputs)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number`);
    }
    if (value < 0) {
      throw new RangeError(`${name} must be greater than or equal to 0`);
    }
  }
  if (orderMultiple <= 0) {
    throw new RangeError("orderMultiple must be greater than 0");
  }

  const inventoryPosition = onHand + onOrder - backorders;
  const targetStock = forecastDemand + safetyStock;
  const unconstrainedQuantity = Math.max(0, targetStock - inventoryPosition);
  let suggestedQuantity = 0;

  if (unconstrainedQuantity > 0) {
    const quantityAtLeastMinimum = Math.max(
      unconstrainedQuantity,
      minimumOrderQuantity,
    );
    suggestedQuantity = Math.ceil(quantityAtLeastMinimum / orderMultiple) * orderMultiple;
  }

  return {
    productId,
    inventoryPosition,
    forecastDemand,
    safetyStock,
    targetStock,
    unconstrainedQuantity,
    suggestedQuantity,
    needsReplenishment: suggestedQuantity > 0,
  };
}
