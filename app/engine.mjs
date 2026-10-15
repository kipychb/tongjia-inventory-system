/**
 * C 組整合層：把 A2 預測 → A1 補貨 → B1 異常偵測 → B2 風險審核串成一條流程。
 * 純函式，不碰 DOM，可在瀏覽器與 Node 測試中共用。不會實際送單。
 */
import { getHistorySales, predictDemandFromSalesData } from '../forecast.mjs';
import { calculateReorderQuantity } from '../replenishment.mjs';
import { checkReplenishmentResult } from '../b1-anomaly.mjs';
import {
  assessB2, decideB2, prepareEventDemandAdjustment, createB2AuditRecord,
} from '../b2-risk-review.mjs';

export const HOLIDAY_MULTIPLIER = 1.2;
export const PROMOTION_MULTIPLIER = 1.3;
export const HISTORY_DAYS = 3;

// 固定日期的國定假日（月-日）；農曆節日與補假請店長手動勾選
const FIXED_HOLIDAYS = new Set(['01-01', '02-28', '04-04', '05-01', '09-28', '10-10', '10-25', '12-25']);

/** 依日期預設是否為假日：週六、週日或固定日期國定假日。店長仍可手動修改。 */
export function isHolidayDate(date) {
  const d = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6 || FIXED_HOLIDAYS.has(date.slice(5));
}

/** 同一門市、同一到貨日已送出的補貨單（避免重複訂貨）。 */
export function submittedOrderFor(orders, storeId, deliveryDate) {
  return orders.find(o => o.storeId === storeId && o.deliveryDate === deliveryDate) ?? null;
}

/**
 * 店長輸入框的字串轉成數字；無法辨識時保留原字串，交給 B1 防呆阻擋。
 */
export function parseQuantityInput(raw) {
  if (typeof raw === 'number') return raw;
  const text = String(raw ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** 回傳該商品最近的歷史紀錄（給畫面顯示），並標出 A2 實際採用的筆數。 */
export function historyFor(salesData, productId, show = 7) {
  const rows = salesData
    .filter(r => r.productId === productId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const usedFrom = Math.max(0, rows.length - HISTORY_DAYS);
  return rows.slice(-show).map((row) => ({
    ...row, usedInForecast: rows.indexOf(row) >= usedFrom,
  }));
}

/**
 * 計算單一商品的完整建議與風險結果。
 * @param {object} p
 * @param {object} p.product - 商品主檔（store-data.mjs）
 * @param {object[]} p.salesData - 銷售紀錄
 * @param {{forecastDate:string,isHoliday:boolean,isPromotion:boolean}} p.settings
 * @param {object|null} p.specialEvent - B2 格式的特殊事件
 * @param {unknown} [p.orderQuantity] - 店長輸入；未提供時採用系統建議量
 */
export function evaluateLine({ product, salesData, settings, specialEvent = null, orderQuantity }) {
  const { productId } = product;
  const historySales = getHistorySales(salesData, productId, HISTORY_DAYS);
  const baseAverage = historySales.reduce((s, v) => s + v, 0) / historySales.length;
  const multiplier = (settings.isHoliday ? HOLIDAY_MULTIPLIER : 1) *
    (settings.isPromotion ? PROMOTION_MULTIPLIER : 1);

  const forecast = predictDemandFromSalesData({
    salesData, productId, days: HISTORY_DAYS,
    isHoliday: settings.isHoliday, isPromotion: settings.isPromotion,
  });

  // B2 登錄的特殊事件：日期落在預測區間才加到 A 組預測需求，再由 A1 重新計算
  let eventAdjustment = null;
  let forecastDemand = forecast.forecastDemand;
  if (specialEvent) {
    eventAdjustment = prepareEventDemandAdjustment({
      productId, specialEvent,
      forecastStartDate: settings.forecastDate, forecastEndDate: settings.forecastDate,
      baseForecastDemand: forecast.forecastDemand,
    });
    forecastDemand = eventAdjustment.adjustedForecastDemand;
  }
  const appliedEvent = eventAdjustment?.eventApplied ? specialEvent : null;

  const aResult = calculateReorderQuantity({
    productId, forecastDemand,
    safetyStock: product.safetyStock, onHand: product.onHand,
    onOrder: product.onOrder, backorders: product.backorders,
    minimumOrderQuantity: product.minimumOrderQuantity,
    orderMultiple: product.orderMultiple,
  });

  const quantity = orderQuantity === undefined
    ? aResult.suggestedQuantity : parseQuantityInput(orderQuantity);
  const b1 = checkReplenishmentResult(aResult, quantity);

  const riskProduct = {
    // 原型假設：隔夜到貨，到貨時庫存以目前庫存位置保守估計
    expectedStockAtArrival: Math.max(0, aResult.inventoryPosition),
    maxCapacity: product.maxCapacity,
    dailyForecast: forecast.forecastDemand,
  };
  if (product.shelfLifeDays != null) riskProduct.remainingShelfLifeDays = product.shelfLifeDays;
  const b2 = assessB2({ b1Result: b1, product: riskProduct, specialEvent: appliedEvent });

  const historyHasEvent = historyFor(salesData, productId, HISTORY_DAYS)
    .some(r => r.specialEvent && !appliedEvent);

  return {
    productId, product, quantity,
    calc: {
      historySales, baseAverage, multiplier,
      baseForecast: forecast.forecastDemand,
      extraDemand: appliedEvent ? appliedEvent.extraDemand : 0,
      eventOutsidePeriod: eventAdjustment && !eventAdjustment.eventApplied,
      historyHasEvent,
    },
    aResult, b1, b2, riskProduct, appliedEvent,
  };
}

/**
 * 依據 B2 結果與店長／主管的確認紀錄，判斷這一行能否送出。
 * approval 物件只對「當時的數量」有效；數量改了就要重新確認。
 */
export function lineStatus(line, approval) {
  const valid = approval && approval.quantity === line.quantity;
  if (line.b2.riskLevel === 'blocked') return { key: 'blocked', label: '資料錯誤', canSubmit: false };
  if (line.b2.riskLevel === 'normal') return { key: 'ok', label: '正常', canSubmit: true };
  if (valid && approval.decision.canSubmit) {
    return { key: 'approved', label: approval.decision.actorRole === 'supervisor' ? '主管已核准' : '店長已確認', canSubmit: true };
  }
  if (valid && approval.decision.reviewStatus === 'rejected') {
    return { key: 'rejected', label: '已退回', canSubmit: false };
  }
  if (line.b2.riskLevel === 'high') return { key: 'high', label: '待主管審核', canSubmit: false };
  return { key: 'warning', label: '待店長確認', canSubmit: false };
}

/** 包裝 decideB2，保留當時的數量以便日後判斷確認是否失效。 */
export function makeApproval(line, { actorRole, decision, reason, reviewerId }) {
  const result = decideB2(line.b2, { actorRole, decision, reason, reviewerId });
  return { quantity: line.quantity, decision: result };
}

/**
 * 產生補貨單（模擬送交統家總部）。送單前呼叫端必須以最新資料重新 evaluateLine。
 * 回傳 null 代表仍有品項不能送出。
 */
export function buildOrder({ store, settings, lines, approvals, now = new Date(), sequence = 1 }) {
  const ordered = lines.filter(l => typeof l.quantity === 'number' && l.quantity > 0 ||
    l.b2.riskLevel !== 'normal');
  if (ordered.some(l => !lineStatus(l, approvals[l.productId]).canSubmit)) return null;

  const datePart = settings.forecastDate.replaceAll('-', '');
  const orderId = `EOS-${store.storeId}-${datePart}-${String(sequence).padStart(3, '0')}`;
  const timestamp = now.toISOString();
  const items = ordered.filter(l => l.quantity > 0).map(l => ({
    productId: l.productId, name: l.product.name, unit: l.product.unit,
    suggestedQuantity: l.aResult.suggestedQuantity, quantity: l.quantity,
    riskLevel: l.b2.riskLevel,
  }));
  const auditRecords = ordered.map((l) => {
    const decision = approvals[l.productId]?.quantity === l.quantity
      ? approvals[l.productId].decision
      : decideB2(l.b2, { actorRole: 'store_manager', decision: 'approve', reason: '系統建議量直接確認' });
    return createB2AuditRecord({
      orderId, b1Result: l.b1, assessment: l.b2, reviewDecision: decision,
      actorId: decision.actorRole === 'supervisor' ? decision.reviewerId : store.managerId,
      originalQuantity: l.aResult.suggestedQuantity, updatedQuantity: l.quantity,
      specialEvent: l.appliedEvent, timestamp,
    });
  });
  return {
    orderId, storeId: store.storeId, storeName: store.storeName,
    deliveryDate: settings.forecastDate, createdAt: timestamp,
    status: 'submitted', items,
    totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    auditRecords,
  };
}
