import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateLine, lineStatus, makeApproval, buildOrder, parseQuantityInput, isHolidayDate, submittedOrderFor,
} from './engine.mjs';
import { PRODUCTS, EXTRA_SALES_DATA, STORE } from './store-data.mjs';

const salesData = [
  ...JSON.parse(readFileSync(new URL('../sales_data.json', import.meta.url), 'utf8')),
  ...EXTRA_SALES_DATA,
];
const settings = { forecastDate: '2026-10-08', isHoliday: false, isPromotion: false };
const product = id => PRODUCTS.find(p => p.productId === id);
const line = (id, extra = {}) => evaluateLine({ product: product(id), salesData, settings, ...extra });

test('預設採用 A 組建議量且為正常', () => {
  const l = line('P001');
  // (48 + 65 + 70) / 3 = 61；目標 61 + 15 = 76；庫存位置 18 → 建議 58
  assert.equal(l.aResult.forecastDemand, 61);
  assert.equal(l.aResult.suggestedQuantity, 58);
  assert.equal(l.quantity, 58);
  assert.equal(lineStatus(l).key, 'ok');
});

test('整箱倍數：礦泉水向上取整到 24 的倍數', () => {
  const l = line('P005');
  assert.equal(l.aResult.suggestedQuantity % 24, 0);
});

test('多打一個 0 需要主管審核，店長不能自行核准', () => {
  const l = line('P001', { orderQuantity: '580' });
  assert.equal(l.b1.status, 'warning');
  assert.equal(l.b2.riskLevel, 'high');
  const byStore = makeApproval(l, { actorRole: 'store_manager', decision: 'approve', reason: '學校運動會訂購' });
  assert.equal(lineStatus(l, byStore).canSubmit, false);
  const bySup = makeApproval(l, { actorRole: 'supervisor', decision: 'approve', reason: '學校運動會訂購', reviewerId: 'SUP-01' });
  assert.equal(lineStatus(l, bySup).key, 'approved');
});

test('文字或空白訂貨量被阻擋', () => {
  assert.equal(lineStatus(line('P003', { orderQuantity: 'abc' })).key, 'blocked');
  assert.equal(lineStatus(line('P003', { orderQuantity: '' })).key, 'blocked');
  assert.equal(parseQuantityInput(' 12 '), 12);
});

test('數量改變後先前的確認失效', () => {
  const l = line('P003', { orderQuantity: '40' });
  const ap = makeApproval(l, { actorRole: 'store_manager', decision: 'approve', reason: '附近學校活動' });
  assert.equal(lineStatus(l, ap).canSubmit, true);
  const changed = line('P003', { orderQuantity: '45' });
  assert.equal(lineStatus(changed, ap).canSubmit, false);
});

test('預測日期內的特殊事件會提高建議量並需店長確認', () => {
  const specialEvent = { date: '2026-10-08', reason: 'event', description: '小巨蛋演唱會散場', extraDemand: 120 };
  const base = line('P005');
  const withEvent = line('P005', { specialEvent });
  assert.ok(withEvent.aResult.suggestedQuantity > base.aResult.suggestedQuantity);
  assert.equal(withEvent.b2.riskLevel, 'warning');
  const outside = line('P005', { specialEvent: { ...specialEvent, date: '2026-10-20' } });
  assert.equal(outside.aResult.suggestedQuantity, base.aResult.suggestedQuantity);
});

test('有待審核品項時不能產生補貨單；全部確認後產生含審核紀錄的補貨單', () => {
  const lines = PRODUCTS.map(p => evaluateLine({
    product: p, salesData, settings, orderQuantity: p.productId === 'P001' ? '580' : undefined,
  }));
  assert.equal(buildOrder({ store: STORE, settings, lines, approvals: {} }), null);

  const p1 = lines.find(l => l.productId === 'P001');
  const approvals = {
    P001: makeApproval(p1, { actorRole: 'supervisor', decision: 'approve', reason: '學校運動會訂購', reviewerId: 'SUP-01' }),
  };
  const order = buildOrder({ store: STORE, settings, lines, approvals, now: new Date('2026-10-07T10:00:00Z') });
  assert.equal(order.orderId, 'EOS-S0123-20261008-001');
  assert.ok(order.items.every(i => i.quantity > 0));
  const audit = order.auditRecords.find(r => r.productId === 'P001');
  assert.equal(audit.reviewerId, 'SUP-01');
  assert.equal(audit.updatedQuantity, 580);
});

test('全部商品建議量與人工計算一致', () => {
  // 依 README 公式人工計算：平均 → 四捨五入 → +安全庫存 − 庫存位置 → 最低訂購量／倍數
  const expected = { P001: 58, P002: 45, P003: 17, P004: 30, P005: 48, P006: 0, P007: 35, P008: 9 };
  for (const [id, qty] of Object.entries(expected)) {
    assert.equal(line(id).aResult.suggestedQuantity, qty, id);
  }
});

test('假日倍率：御飯糰 61 × 1.2 → 73，建議 70', () => {
  const l = evaluateLine({ product: product('P001'), salesData, settings: { ...settings, isHoliday: true } });
  assert.equal(l.aResult.forecastDemand, 73);
  assert.equal(l.aResult.suggestedQuantity, 70);
});

test('建議 100 個御飯糰只需店長確認，不需主管', () => {
  const l = line('P001', { orderQuantity: '100' });
  assert.equal(l.b2.riskLevel, 'warning');
});

test('店長把建議量改成 0 需要確認，確認後不列入補貨單品項', () => {
  const lines = PRODUCTS.map(p => evaluateLine({
    product: p, salesData, settings, orderQuantity: p.productId === 'P002' ? '0' : undefined,
  }));
  const p2 = lines.find(l => l.productId === 'P002');
  assert.equal(lineStatus(p2).key, 'warning');
  const approvals = { P002: makeApproval(p2, { actorRole: 'store_manager', decision: 'approve', reason: '雨衣庫存足夠' }) };
  const order = buildOrder({ store: STORE, settings, lines, approvals });
  assert.ok(!order.items.some(i => i.productId === 'P002'));
  assert.ok(order.auditRecords.some(r => r.productId === 'P002' && r.updatedQuantity === 0));
});

test('假日判斷與重複送單檢查', () => {
  assert.equal(isHolidayDate('2026-10-08'), false); // 週四
  assert.equal(isHolidayDate('2026-10-10'), true);  // 國慶日（週六）
  assert.equal(isHolidayDate('2026-10-25'), true);
  assert.equal(isHolidayDate('2026-10-12'), false);
  const orders = [{ storeId: 'S0123', deliveryDate: '2026-10-08', orderId: 'X' }];
  assert.equal(submittedOrderFor(orders, 'S0123', '2026-10-08').orderId, 'X');
  assert.equal(submittedOrderFor(orders, 'S0123', '2026-10-09'), null);
});
