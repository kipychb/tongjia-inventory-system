/**
 * A2 forecast module. Selects the latest available observations per product.
 * Missing dates are not inferred and special-event sales are not removed.
 */
export function getHistorySales(salesData, productId, days = 3) {
  if (!Array.isArray(salesData)) throw new TypeError("salesData must be an array");
  if (typeof productId !== "string" || !productId.trim()) {
    throw new TypeError("productId is required and must be a string");
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new RangeError("days must be a positive integer");
  }

  const records = salesData.filter((row) => row?.productId === productId);
  for (const row of records) {
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        Number.isNaN(Date.parse(row.date))) {
      throw new TypeError("Invalid sales date for product " + productId);
    }
    if (typeof row.salesQuantity !== "number" || !Number.isFinite(row.salesQuantity) ||
        row.salesQuantity < 0) {
      throw new TypeError("Invalid salesQuantity for product " + productId);
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  if (records.length === 0) {
    throw new RangeError("No sales records found for product " + productId);
  }
  return records.slice(-days).map((row) => row.salesQuantity);
}

/** days means number of available observations, not necessarily calendar days. */
export function calculateSMA(salesList, days = 3) {
  if (!Array.isArray(salesList) || salesList.length === 0) {
    throw new TypeError("historySales must be a non-empty array");
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new RangeError("days must be a positive integer");
  }
  for (const sale of salesList) {
    if (typeof sale !== "number" || !Number.isFinite(sale) || sale < 0) {
      throw new TypeError("historySales values must be finite nonnegative numbers");
    }
  }
  const recent = salesList.slice(-days);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

/** Holiday (1.2) and promotion (1.3) multipliers are provisional. */
export function predictDemand({
  productId, historySales, isHoliday = false, isPromotion = false,
  specialDemand = 0, days = 3,
} = {}) {
  if (typeof productId !== "string" || !productId.trim()) {
    throw new TypeError("productId is required and must be a string");
  }
  if (typeof isHoliday !== "boolean" || typeof isPromotion !== "boolean") {
    throw new TypeError("isHoliday and isPromotion must be booleans");
  }
  if (typeof specialDemand !== "number" || !Number.isFinite(specialDemand) ||
      specialDemand < 0) {
    throw new TypeError("specialDemand must be a finite nonnegative number");
  }

  const baseDemand = calculateSMA(historySales, days);
  const multiplier = (isHoliday ? 1.2 : 1) * (isPromotion ? 1.3 : 1);
  return {
    productId,
    forecastDemand: Math.round(baseDemand * multiplier) + specialDemand,
  };
}

/** Takes parsed sales_data.json records and returns A1's input contract. */
export function predictDemandFromSalesData({
  salesData, productId, isHoliday = false, isPromotion = false,
  specialDemand = 0, days = 3,
} = {}) {
  const historySales = getHistorySales(salesData, productId, days);
  return predictDemand({
    productId, historySales, isHoliday, isPromotion, specialDemand, days,
  });
}
