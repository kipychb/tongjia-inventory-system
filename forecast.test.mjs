import test from "node:test";
import assert from "node:assert/strict";
import { predictDemand } from "./forecast.mjs";
import { calculateReorderQuantity } from "./replenishment.mjs";

test("A2 驗證：御飯糰平日常態銷售預測", () => {
  const result = predictDemand({
    productId: "P001",
    historySales: [45, 48],
    isHoliday: false,
    isPromotion: false,
  });

  // 移動平均 (45 + 48) / 2 = 46.5，四捨五入為 47
  assert.equal(result.productId, "P001");
  assert.equal(result.forecastDemand, 47);
});

test("A2 驗證：週末促銷活動加權銷量增長", () => {
  const result = predictDemand({
    productId: "P001",
    historySales: [50, 50, 50],
    isHoliday: true,     // 50 * 1.2 = 60
    isPromotion: true,   // 60 * 1.3 = 78
  });

  assert.equal(result.productId, "P001");
  assert.equal(result.forecastDemand, 78);
});

test("A2 驗證：統家個案活動大宗預約需求 (例如演唱會/活動需求 150 件)", () => {
  const result = predictDemand({
    productId: "P002",
    historySales: [2, 3],
    specialDemand: 150,
  });

  // 基礎平均 2.5 四捨五入為 3，加上特殊需求 150 = 153
  assert.equal(result.productId, "P002");
  assert.equal(result.forecastDemand, 153);
});

test("A1 + A2 整合驗證：將預測結果直接代入 A1 補貨公式", () => {
  // 1. 由 A2 模組產出預測需求物件
  const forecast = predictDemand({
    productId: "P001",
    historySales: [45, 48],
    isHoliday: true, // 假日加權 46.5 * 1.2 = 55.8 -> 56
  });

  assert.equal(forecast.productId, "P001");
  assert.equal(forecast.forecastDemand, 56);

  // 2. 直接解構並丟入 A1 的 calculateReorderQuantity 計算
  const replenishmentResult = calculateReorderQuantity({
    ...forecast,
    safetyStock: 10,
    onHand: 20,
    orderMultiple: 1,
  });

  // 目標庫存 = 56 + 10 = 66
  // 建議訂購量 = 66 - 20 = 46
  assert.equal(replenishmentResult.suggestedQuantity, 46);
  assert.equal(replenishmentResult.needsReplenishment, true);
});