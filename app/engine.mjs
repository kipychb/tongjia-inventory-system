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
 * @param {unknown} [p.countedOnHand] - 店長今晚盤點數；未提供時採用系統帳面庫存
 */
export function evaluateLine({
  product: master, salesData, settings, specialEvent = null, orderQuantity, countedOnHand,
}) {
  const { productId } = master;
  // 盤點數必須是非負整數；無效時沿用帳面庫存計算，但整列標示錯誤、禁止送單
  const counted = countedOnHand === undefined ? master.onHand : parseQuantityInput(countedOnHand);
  const countError = !Number.isSafeInteger(counted) || counted < 0;
  const product = { ...master, onHand: countError ? master.onHand : counted };
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
    productId, product, quantity, countError, bookOnHand: master.onHand,
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
  if (line.countError) return { key: 'blocked', label: '盤點數錯誤', canSubmit: false };
  if (line.b2.riskLevel === 'blocked') return { key: 'blocked', label: '資料錯誤', canSubmit: false };
  if (line.b2.riskLevel === 'normal') return { key: 'ok', label: '正常', canSubmit: true };
  // 確認只對「當時的訂貨量、建議量與風險等級」有效；盤點或數量改了就要重新確認
  const valid = approval && approval.quantity === line.quantity &&
    approval.suggestedQuantity === line.aResult.suggestedQuantity &&
    approval.riskLevel === line.b2.riskLevel;
  if (valid && approval.decision.canSubmit) {
    if (approval.postReview) return { key: 'override', label: '店長已確認・待事後覆核', canSubmit: true };
    return { key: 'approved', label: approval.decision.actorRole === 'supervisor' ? '主管已核准' : '店長已確認', canSubmit: true };
  }
  if (valid && approval.decision.reviewStatus === 'rejected') {
    return { key: 'rejected', label: '已退回', canSubmit: false };
  }
  if (line.b2.riskLevel === 'high') return { key: 'high', label: '高風險・需二次確認', canSubmit: false };
  return { key: 'warning', label: '待店長確認', canSubmit: false };
}

function approvalFor(line, decision, postReview = false) {
  return {
    quantity: line.quantity, suggestedQuantity: line.aResult.suggestedQuantity,
    riskLevel: line.b2.riskLevel, postReview, decision,
  };
}

/** 包裝 decideB2，保留當時的數量以便日後判斷確認是否失效。 */
export function makeApproval(line, { actorRole, decision, reason, reviewerId }) {
  return approvalFor(line, decideB2(line.b2, { actorRole, decision, reason, reviewerId }));
}

/**
 * 高風險訂單的店長二次確認：不必等主管，送出後由主管事後覆核。
 * 這是為了避免「可疑就扣單」——晚上聯絡不到主管時，真正的特殊需求仍能準時補貨。
 * 條件：補充說明至少 5 字、重新輸入的數量與訂貨量相同、勾選責任聲明。
 * B2 的 decideB2 規則維持「高風險需主管」，此處只把主管審核改為送出後進行。
 */
export function makeStoreOverride(line, { reason, note, confirmQuantity, acknowledged }) {
  if (line.b2.riskLevel !== 'high') return { ok: false, error: '只有高風險品項需要二次確認' };
  if (typeof note !== 'string' || note.trim().length < 5) {
    return { ok: false, error: '請填寫至少 5 個字的補充說明' };
  }
  if (parseQuantityInput(confirmQuantity) !== line.quantity) {
    return { ok: false, error: `再次輸入的數量與訂貨量 ${line.quantity} 不同，請確認是否打錯` };
  }
  if (acknowledged !== true) return { ok: false, error: '請勾選「由店長負責」的確認聲明' };
  const base = decideB2(line.b2, {
    actorRole: 'store_manager', decision: 'approve', reason: `${reason}：${note.trim()}`,
  });
  // reviewStatus 維持 B2 的 pending_manager，代表主管覆核尚未完成；canSubmit 由二次確認放行
  const decision = { ...base, reviewStatus: 'pending_manager', canSubmit: true, doubleConfirmed: true };
  return { ok: true, approval: approvalFor(line, decision, true) };
}

/** 主管事後覆核補貨單中的某一品項，回傳新的補貨單物件。 */
export function reviewOrderItem(order, productId, { reviewerId, note, now = new Date() }) {
  if (!String(reviewerId ?? '').trim()) throw new TypeError('需要主管編號');
  return {
    ...order,
    auditRecords: order.auditRecords.map(r => (r.productId === productId && r.postReview?.status === 'pending'
      ? { ...r, postReview: { status: 'reviewed', reviewerId, note: note ?? '', reviewedAt: now.toISOString() } }
      : r)),
  };
}

/** 補貨單中尚未完成主管事後覆核的品項數。 */
export function pendingReviewCount(order) {
  return order.auditRecords.filter(r => r.postReview?.status === 'pending').length;
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
    riskLevel: l.b2.riskLevel, postReview: approvals[l.productId]?.postReview === true &&
      l.b2.riskLevel !== 'normal',
  }));
  const auditRecords = ordered.map((l) => {
    const approval = l.b2.riskLevel === 'normal' ? null : approvals[l.productId];
    const decision = approval?.decision ??
      decideB2(l.b2, { actorRole: 'store_manager', decision: 'approve', reason: '系統建議量直接確認' });
    const record = createB2AuditRecord({
      orderId, b1Result: l.b1, assessment: l.b2, reviewDecision: decision,
      actorId: decision.actorRole === 'supervisor' ? decision.reviewerId : store.managerId,
      originalQuantity: l.aResult.suggestedQuantity, updatedQuantity: l.quantity,
      specialEvent: l.appliedEvent, timestamp,
    });
    return {
      ...record,
      countedOnHand: l.product.onHand, bookOnHand: l.bookOnHand,
      doubleConfirmed: decision.doubleConfirmed === true,
      postReview: approval?.postReview ? { status: 'pending' } : null,
    };
  });
  return {
    orderId, storeId: store.storeId, storeName: store.storeName,
    deliveryDate: settings.forecastDate, createdAt: timestamp,
    status: 'submitted', items,
    totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    auditRecords,
  };
}
