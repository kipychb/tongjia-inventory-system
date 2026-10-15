/**
 * C 組示範資料：門市商品主檔與額外模擬銷售紀錄。
 * P001、P002 的銷售紀錄來自 A 組 sales_data.json；P003 以後為 C 組補充的模擬值，
 * 僅供介面示範與教學影片使用，不代表統家實際商品設定。
 */
export const STORE = Object.freeze({
  storeId: 'S0123',
  storeName: '統家便利店 信義松仁門市',
  managerId: 'STORE-0123',
  managerName: '店長',
});

/**
 * 商品主檔欄位：
 * - safetyStock：安全庫存（件）
 * - onHand / onOrder / backorders：現有庫存 / 在途量 / 欠貨
 * - minimumOrderQuantity / orderMultiple：最低訂購量 / 訂購倍數（整箱）
 * - maxCapacity：門市可用陳列＋倉儲容量（件）
 * - shelfLifeDays：到貨後可銷售天數；null 表示非效期商品，不做效期檢查
 */
export const PRODUCTS = Object.freeze([
  { productId: 'P001', name: '鮪魚御飯糰', category: '鮮食', unit: '個',
    safetyStock: 15, onHand: 18, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 0, orderMultiple: 1, maxCapacity: 120, shelfLifeDays: 2 },
  { productId: 'P002', name: '輕便雨衣', category: '日用品', unit: '件',
    safetyStock: 5, onHand: 12, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 0, orderMultiple: 1, maxCapacity: 80, shelfLifeDays: null },
  { productId: 'P003', name: '鮮乳 936ml', category: '乳品', unit: '瓶',
    safetyStock: 6, onHand: 9, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 0, orderMultiple: 1, maxCapacity: 60, shelfLifeDays: 5 },
  { productId: 'P004', name: '茶葉蛋', category: '鮮食', unit: '顆',
    safetyStock: 10, onHand: 22, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 0, orderMultiple: 10, maxCapacity: 150, shelfLifeDays: 2 },
  { productId: 'P005', name: '礦泉水 600ml', category: '飲料', unit: '瓶',
    safetyStock: 24, onHand: 30, onOrder: 24, backorders: 0,
    minimumOrderQuantity: 24, orderMultiple: 24, maxCapacity: 240, shelfLifeDays: 365 },
  { productId: 'P006', name: '經典牛肉杯麵', category: '食品', unit: '杯',
    safetyStock: 12, onHand: 40, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 12, orderMultiple: 12, maxCapacity: 96, shelfLifeDays: 180 },
  { productId: 'P007', name: '火腿蛋三明治', category: '鮮食', unit: '個',
    safetyStock: 8, onHand: 6, onOrder: 0, backorders: 2,
    minimumOrderQuantity: 0, orderMultiple: 1, maxCapacity: 60, shelfLifeDays: 2 },
  { productId: 'P008', name: '食用冰塊 2kg', category: '冷凍', unit: '包',
    safetyStock: 4, onHand: 5, onOrder: 0, backorders: 0,
    minimumOrderQuantity: 0, orderMultiple: 1, maxCapacity: 30, shelfLifeDays: null },
]);

const DATES = [
  ['2026-10-01', false], ['2026-10-02', false], ['2026-10-03', true],
  ['2026-10-04', true], ['2026-10-05', false], ['2026-10-06', false], ['2026-10-07', false],
];

const EXTRA_SALES = {
  P003: [18, 20, 24, 26, 19, 21, 20],
  P004: [35, 38, 46, 50, 36, 34, 37],
  P005: [52, 58, 75, 80, 55, 60, 62],
  P006: [14, 12, 16, 18, 13, 15, 14],
  P007: [28, 30, 22, 20, 31, 29, 32],
  P008: [8, 9, 14, 15, 10, 9, 11],
};

/** C 組補充的模擬銷售紀錄，格式與 A 組 sales_data.json 相同。 */
export const EXTRA_SALES_DATA = Object.freeze(
  Object.entries(EXTRA_SALES).flatMap(([productId, values]) => {
    const product = PRODUCTS.find(p => p.productId === productId);
    return values.map((salesQuantity, i) => ({
      date: DATES[i][0], productId, productName: product.name, salesQuantity,
      isHoliday: DATES[i][1], isPromotion: false, specialEvent: null,
    }));
  }),
);

export const EVENT_REASON_LABELS = Object.freeze({
  promotion: '促銷活動', event: '附近大型活動', group_order: '團購／預訂', other: '其他',
});

/** 店長確認異常時可選的原因（B1/B2 warning 層級）。 */
export const CONFIRM_REASONS = Object.freeze([
  '附近活動或人潮增加', '促銷檔期', '團購或客人預訂', '天氣因素（颱風、寒流、高溫）',
  '庫存盤點差異修正', '其他',
]);
