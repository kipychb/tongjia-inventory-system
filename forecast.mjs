/**
 * A2: 需求預測與調整演算法模組
 */

/**
 * 1. 計算過去銷售紀錄的簡單移動平均 (Simple Moving Average, SMA)
 * @param {number[]} salesList - 歷史銷量陣列
 * @param {number} days - 計算天數（預設 3 天）
 * @returns {number} 平均銷量
 */
export function calculateSMA(salesList, days = 3) {
  if (!salesList || salesList.length === 0) return 0;
  const recent = salesList.slice(-days);
  const sum = recent.reduce((acc, cur) => acc + cur, 0);
  return sum / recent.length;
}

/**
 * 2. 產出明日預測需求物件
 * @param {Object} params
 * @param {string} params.productId - 商品編號 (必要欄位)
 * @param {number[]} params.historySales - 歷史銷售數字
 * @param {boolean} params.isHoliday - 是否為假日
 * @param {boolean} params.isPromotion - 是否為促銷檔期
 * @param {number} params.specialDemand - 店長手動預約/特殊大宗活動需求
 * @param {number} params.days - 移動平均天數
 * @returns {{ productId: string, forecastDemand: number }} 符合 A1 規格的預測物件
 */
export function predictDemand({
  productId,
  historySales = [],
  isHoliday = false,
  isPromotion = false,
  specialDemand = 0,
  days = 3,
} = {}) {
  if (!productId || typeof productId !== 'string') {
    throw new TypeError('productId is required and must be a string');
  }

  // 基礎需求量由移動平均計算
  const baseDemand = calculateSMA(historySales, days);
  let multiplier = 1.0;

  // 假日效應加權 (客流量增加 20%)
  if (isHoliday) {
    multiplier *= 1.2;
  }

  // 促銷活動加權 (銷量增加 30%)
  if (isPromotion) {
    multiplier *= 1.3;
  }

  // 計算最終預測值：(基礎需求 * 權重) + 店長特殊預約數量，四捨五入取整數
  const calculatedDemand = Math.round(baseDemand * multiplier) + Number(specialDemand);
  const forecastDemand = Math.max(0, calculatedDemand);

  // 回傳包含 productId 與 forecastDemand 的物件對齊 A1 規格
  return {
    productId,
    forecastDemand,
  };
}