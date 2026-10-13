/**
 * 統家 B1：補貨量異常偵測與輸入防呆。
 * 只負責檢查並回報，絕不直接送出訂單或決定主管審核流程。
 * 假設數量單位為「件」且需非負整數；若 A 組允許重量／小數商品，請調整 precision 政策。
 */
export const B1_DEFAULT_POLICY = Object.freeze({
  upwardRatio: 1.5,       // 超過 A 建議量 150% (且差異至少10件) 警告
  upwardMinDifference: 10,
  downwardRatio: 0.5,     // 店長改成不到 A 建議量的 50% 時警告
  downwardMinDifference: 10,
  largeOrderQuantity: 100, // 訂貨>=100件提示人工核對（示範值）
  integerOnly: true,
});

const issue = (code, level, message) => ({code, level, message});
const isNumber = value => typeof value === 'number' && Number.isFinite(value);

/**
 * @param {object} input
 * @param {string|number} input.productId - 與 A 組 productId 相同
 * @param {number} input.suggestedQuantity - A 組 calculateReorderQuantity() 結果
 * @param {unknown} input.orderQuantity - 店長輸入，刻意容許未知型別以便防呆
 * @param {number} [input.forecastDemand] - A 組需求預測（僅供顯示／資料交換）
 * @param {object} [policy]
 * @returns {{productId: string|number|null, status:'blocked'|'warning'|'ok',canProceed:boolean,requiresConfirmation:boolean,issues:Array<{code:string,level:string,message:string}>, suggestedQuantity:number|undefined,orderQuantity:unknown}}
 */
export function checkB1(input, policy = {}) {
  const rules = {...B1_DEFAULT_POLICY, ...policy};
  const problems = [];
  const add = (code, level, message) => problems.push(issue(code,level,message));
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { productId:null,status:'blocked',canProceed:false,requiresConfirmation:false,
      suggestedQuantity:undefined,orderQuantity:undefined,
      issues:[issue('INVALID_INPUT','error','缺少商品補貨資料')] };
  }
  const {productId, suggestedQuantity, orderQuantity} = input;
  if (productId === undefined || productId === null || String(productId).trim() === '')
    add('PRODUCT_ID_REQUIRED','error','缺少商品編號');

  for (const [key, value, label] of [
    ['suggestedQuantity',suggestedQuantity,'A組建議補貨量'],
    ['orderQuantity',orderQuantity,'店長訂貨量'],
  ]) {
    if (!isNumber(value)) {
      add(`${key.toUpperCase()}_INVALID`,'error',`${label}必須是有效數字（不接受空白、文字或 NaN）`);
    } else if (value < 0) {
      add(`${key.toUpperCase()}_NEGATIVE`,'error',`${label}不可為負數`);
    } else if (rules.integerOnly && !Number.isSafeInteger(value)) {
      add(`${key.toUpperCase()}_NOT_INTEGER`,'error',`${label}必須是安全整數件數`);
    }
  }
  if (problems.some(p => p.level === 'error')) return finish();

  if (orderQuantity >= rules.largeOrderQuantity)
    add('LARGE_ORDER','warning',`訂貨量 ${orderQuantity} 件達大量訂貨門檻 ${rules.largeOrderQuantity} 件，請確認`);
  if (suggestedQuantity === 0 && orderQuantity > 0)
    add('ZERO_SUGGESTION_OVERRIDE','warning','A組建議不補貨，但店長輸入了訂貨數量');
  if (suggestedQuantity > 0) {
    if (orderQuantity === 0)
      add('ZERO_ORDER_OVERRIDE','warning','A組建議補貨，但店長將訂貨量改為 0');
    else if (orderQuantity > suggestedQuantity * rules.upwardRatio &&
             orderQuantity - suggestedQuantity >= rules.upwardMinDifference)
      add('EXCESS_OVER_SUGGESTION','warning','店長訂貨量明顯超過 A 組建議量，請檢查是否多打了一個 0');
    else if (orderQuantity < suggestedQuantity * rules.downwardRatio &&
             suggestedQuantity - orderQuantity >= rules.downwardMinDifference)
      add('TOO_LITTLE_ORDER','warning','店長訂貨量明顯少於 A 組建議量，請確認是否有特殊原因');
  }
  return finish();

  function finish() {
    const blocked = problems.some(p => p.level === 'error');
    const warning = problems.some(p => p.level === 'warning');
    return {
      productId: input.productId ?? null,
      suggestedQuantity: input.suggestedQuantity,
      orderQuantity: input.orderQuantity,
      status: blocked ? 'blocked' : warning ? 'warning' : 'ok',
      canProceed: !blocked, // warning 還需店長確認，不能直接當成已審核
      requiresConfirmation: !blocked && warning,
      issues: problems,
    };
  }
}

/** 和 A 組的回傳物件串接；店長數量由 C 組提供。 */
export function checkReplenishmentResult(aResult, managerQuantity, policy) {
  if (!aResult || typeof aResult !== 'object') {
    return checkB1(null);
  }
  return checkB1({
    productId: aResult.productId,
    suggestedQuantity: aResult.suggestedQuantity,
    orderQuantity: managerQuantity,
  },policy);
}
