/**
 * B2: risk assessment and review workflow. Pure functions; no order submission.
 * Receives the exact result shape of B1 checkB1().
 */
export const B2_DEFAULT_POLICY = Object.freeze({
  highOrderRatio: 3,
  highOrderMinDifference: 20,
  highZeroSuggestionQuantity: 100,
  expiryExcessRatio: 1.2,
  severeExpiryExcessRatio: 2,
});

const finiteNonnegative = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const validInteger = v => Number.isSafeInteger(v) && v >= 0;
const finding = (code, level, message) => ({ code, level, message });
export const B2_EVENT_REASONS = Object.freeze(['promotion', 'event', 'group_order', 'other']);
const REASONS = new Set(B2_EVENT_REASONS);

export function assessB2({
  b1Result, product = {}, specialEvent = null, policy = {},
} = {}) {
  const rules = { ...B2_DEFAULT_POLICY, ...policy };
  const issues = [];
  const add = (code, level, message) => issues.push(finding(code, level, message));
  if (!b1Result || !['blocked', 'warning', 'ok'].includes(b1Result.status) ||
      !Array.isArray(b1Result.issues) ||
      typeof b1Result.requiresConfirmation !== 'boolean' ||
      typeof b1Result.canProceed !== 'boolean' ||
      !validInteger(b1Result.orderQuantity) ||
      !validInteger(b1Result.suggestedQuantity) ||
      b1Result.productId == null || String(b1Result.productId).trim() === '') {
    add('INVALID_B1_RESULT', 'error', 'B1 結果不完整或無效，不能進行審核');
  }
  if (b1Result?.status === 'blocked' || b1Result?.canProceed === false ||
      b1Result?.issues?.some(i => i.level === 'error')) {
    add('B1_BLOCKED', 'error', 'B1 已阻擋此訂單，請先修正輸入');
  }
  const q = b1Result?.orderQuantity;
  const suggested = b1Result?.suggestedQuantity;

  // Optional data must be either omitted or valid. Never interpret missing data as 0.
  for (const key of ['expectedStockAtArrival', 'maxCapacity', 'dailyForecast', 'remainingShelfLifeDays']) {
    if (product[key] !== undefined && !finiteNonnegative(product[key])) {
      add('INVALID_' + key.toUpperCase(), 'error', `${key} 必須是非負有限數字`);
    }
  }
  if (specialEvent !== null) {
    if (!specialEvent || !REASONS.has(specialEvent.reason) ||
        typeof specialEvent.description !== 'string' ||
        specialEvent.description.trim().length < 5 ||
        !finiteNonnegative(specialEvent.extraDemand) ||
        !Number.isSafeInteger(specialEvent.extraDemand) ||
        specialEvent.extraDemand <= 0 ||
        typeof specialEvent.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(specialEvent.date) ||
        !Number.isFinite(Date.parse(specialEvent.date + 'T00:00:00Z')) ||
        new Date(specialEvent.date + 'T00:00:00Z').toISOString().slice(0,10) !== specialEvent.date) {
      add('INVALID_SPECIAL_EVENT', 'error', '特殊事件須有有效日期、原因、至少5字說明與正整數額外需求');
    }
  }
  if (issues.some(i => i.level === 'error')) {
    return { productId:b1Result?.productId ?? null, riskLevel:'blocked',
      reviewStatus:'blocked', canSubmit:false, requiresManagerApproval:false,
      requiresStoreConfirmation:false, issues, b1Issues:b1Result?.issues ?? [] };
  }

  let high = false;
  let warning = b1Result.status === 'warning' || b1Result.requiresConfirmation;
  if (suggested > 0 && q >= suggested * rules.highOrderRatio &&
      q - suggested >= rules.highOrderMinDifference) {
    high = true;
    add('EXTREME_ORDER', 'high', '訂貨量明顯超過建議量，需主管審核');
  } else if (suggested === 0 && q >= rules.highZeroSuggestionQuantity) {
    high = true;
    add('EXTREME_ZERO_SUGGESTION', 'high', '建議量為0但大量訂貨，需主管審核');
  }
  if (product.expectedStockAtArrival !== undefined &&
      product.maxCapacity !== undefined &&
      product.expectedStockAtArrival + q > product.maxCapacity) {
    high = true;
    add('CAPACITY_EXCEEDED', 'high', '到貨後庫存預計超過儲存容量');
  }
  if (product.remainingShelfLifeDays !== undefined &&
      product.dailyForecast !== undefined &&
      product.expectedStockAtArrival !== undefined) {
    const demandBeforeExpiry = product.remainingShelfLifeDays * product.dailyForecast +
      (specialEvent?.extraDemand ?? 0);
    const projected = product.expectedStockAtArrival + q;
    if (projected > demandBeforeExpiry * rules.expiryExcessRatio &&
        projected > demandBeforeExpiry) {
      const severe = demandBeforeExpiry === 0 ||
        projected > demandBeforeExpiry * rules.severeExpiryExcessRatio;
      if (severe) high = true;
      else warning = true;
      add('EXPIRY_SURPLUS', severe ? 'high' : 'warning',
        '預計到貨後庫存可能超過剩餘效期內需求，請確認報廢風險');
    }
  }
  if (specialEvent) {
    add('SPECIAL_EVENT_RECORDED', 'info', '已登錄特殊事件；不會自動免除風險審核');
    warning = true;
  }
  const riskLevel = high ? 'high' : warning ? 'warning' : 'normal';
  return {
    productId:b1Result.productId, riskLevel,
    reviewStatus:high ? 'pending_manager' : warning ? 'pending_store_confirmation' : 'ready',
    canSubmit:!high && !warning, requiresManagerApproval:high,
    requiresStoreConfirmation:warning && !high,
    issues, b1Issues:b1Result.issues,
  };
}

/**
 * Review decision is not an actual submission. Only accepts the current
 * assessment and records the actor's decision for a later trusted server check.
 */
export function decideB2(assessment, {
  actorRole, decision, reason = '', reviewerId = '',
} = {}) {
  if (!assessment || !['blocked','normal','warning','high'].includes(assessment.riskLevel)) {
    throw new TypeError('無效的 B2 評估結果');
  }
  const audit = {
    productId:assessment.productId,
    actorRole, decision, reason, reviewerId,
    priorStatus:assessment.reviewStatus,
  };
  if (assessment.riskLevel === 'blocked')
    return { ...audit, reviewStatus:'blocked', canSubmit:false };
  if (assessment.riskLevel === 'normal')
    return { ...audit, reviewStatus:'approved', canSubmit:true };
  if (decision === 'reject')
    return { ...audit, reviewStatus:'rejected', canSubmit:false };
  if (decision !== 'approve' || typeof reason !== 'string' || reason.trim().length < 5)
    return { ...audit, reviewStatus:assessment.reviewStatus, canSubmit:false };
  if (assessment.riskLevel === 'high' &&
      (actorRole !== 'supervisor' || !String(reviewerId).trim()))
    return { ...audit, reviewStatus:'pending_manager', canSubmit:false };
  if (assessment.riskLevel === 'warning' && !['store_manager','supervisor'].includes(actorRole))
    return { ...audit, reviewStatus:'pending_store_confirmation', canSubmit:false };
  return { ...audit, reviewStatus:'approved', canSubmit:true };
}

/** Validate an event and prepare an A-group demand-adjustment request.
 * The event date must be in the A-group forecast coverage window. No order
 * quantities are recalculated here; A remains the source of suggestedQuantity.
 */
export function prepareEventDemandAdjustment({
  productId, specialEvent, forecastStartDate, forecastEndDate,
  baseForecastDemand, orderId = null,
} = {}) {
  const dateValid = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  if (productId == null || !String(productId).trim() ||
      !finiteNonnegative(baseForecastDemand) ||
      !dateValid(forecastStartDate) || !dateValid(forecastEndDate) ||
      forecastEndDate < forecastStartDate ||
      !specialEvent || !REASONS.has(specialEvent.reason) ||
      !dateValid(specialEvent.date) ||
      typeof specialEvent.description !== 'string' ||
      specialEvent.description.trim().length < 5 ||
      !validInteger(specialEvent.extraDemand) || specialEvent.extraDemand <= 0) {
    throw new TypeError('特殊事件或預測期間資料無效');
  }
  if (specialEvent.date < forecastStartDate || specialEvent.date > forecastEndDate) {
    return { productId, orderId, eventApplied:false, status:'outside_forecast_period',
      baseForecastDemand, adjustedForecastDemand:baseForecastDemand,
      extraDemand:0, specialEvent };
  }
  const adjustedForecastDemand = baseForecastDemand + specialEvent.extraDemand;
  if (!Number.isSafeInteger(adjustedForecastDemand) && !Number.isFinite(adjustedForecastDemand)) {
    throw new RangeError('調整後需求超出有效範圍');
  }
  return { productId, orderId, eventApplied:true, status:'requires_a_recalculation',
    baseForecastDemand, adjustedForecastDemand,
    extraDemand:specialEvent.extraDemand, specialEvent };
}

/** Produce an audit entry. In production, a trusted server must supply actor
 * identity/time, persist the record, and enforce permissions. */
export function createB2AuditRecord({
  orderId, b1Result, assessment, reviewDecision, actorId,
  originalQuantity, updatedQuantity, specialEvent = null, timestamp,
} = {}) {
  if (typeof orderId !== 'string' || !orderId.trim() ||
      !b1Result || !assessment || !reviewDecision ||
      b1Result.productId !== assessment.productId ||
      typeof actorId !== 'string' || !actorId.trim() ||
      !validInteger(originalQuantity) || !validInteger(updatedQuantity) ||
      updatedQuantity !== b1Result.orderQuantity ||
      typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) ||
      !['approved','rejected','pending_manager','pending_store_confirmation','blocked'].includes(reviewDecision.reviewStatus) ||
      typeof reviewDecision.canSubmit !== 'boolean' ||
      reviewDecision.productId !== assessment.productId ||
      (specialEvent !== null && (typeof specialEvent !== 'object' || !REASONS.has(specialEvent.reason)))) {
    throw new TypeError('審核紀錄欄位不完整或不一致');
  }
  return {
    orderId, productId:assessment.productId,
    suggestedQuantity:b1Result.suggestedQuantity,
    originalQuantity, updatedQuantity,
    b1Status:b1Result.status,
    b1IssueCodes:b1Result.issues.map(i=>i.code),
    riskLevel:assessment.riskLevel,
    riskIssueCodes:assessment.issues.map(i=>i.code),
    specialEvent:specialEvent ? {...specialEvent} : null,
    actorId, actorRole:reviewDecision.actorRole,
    reviewerId:reviewDecision.reviewerId || null,
    decision:reviewDecision.decision,
    reason:reviewDecision.reason || '',
    priorStatus:reviewDecision.priorStatus,
    reviewStatus:reviewDecision.reviewStatus,
    canSubmit:reviewDecision.canSubmit,
    timestamp,
  };
}
