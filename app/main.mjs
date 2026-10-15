/**
 * C 組：店長操作介面。狀態集中在 state，變更後呼叫 render()。
 */
import {
  evaluateLine, lineStatus, makeApproval, buildOrder, historyFor, parseQuantityInput,
  isHolidayDate, submittedOrderFor, makeStoreOverride, reviewOrderItem, pendingReviewCount,
  HOLIDAY_MULTIPLIER, PROMOTION_MULTIPLIER, HISTORY_DAYS,
} from './engine.mjs';
import { B2_EVENT_REASONS } from '../b2-risk-review.mjs';
import { B1_DEFAULT_POLICY } from '../b1-anomaly.mjs';
import { B2_DEFAULT_POLICY } from '../b2-risk-review.mjs';
import {
  STORE, PRODUCTS, EXTRA_SALES_DATA, EVENT_REASON_LABELS, CONFIRM_REASONS,
} from './store-data.mjs';

const ORDERS_KEY = 'tongjia-eos-orders';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (typeof n === 'number' && Number.isFinite(n)
  ? (Number.isInteger(n) ? n.toLocaleString('zh-TW') : n.toFixed(1)) : esc(n));

const state = {
  tab: 'replenish',
  role: 'store_manager',
  settings: { forecastDate: '2026-10-08', isHoliday: false, isPromotion: false },
  events: [],          // B2 特殊事件 + productId
  quantities: {},      // productId -> 店長輸入的原始字串
  counts: {},          // productId -> 店長今晚盤點數（原始字串）
  approvals: {},       // productId -> makeApproval() 結果
  selected: null,
  salesData: [],
  orders: loadOrders(),
  lines: [],
};

function loadOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) ?? []; } catch { return []; }
}
function saveOrders() {
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(state.orders)); } catch { /* 私密模式 */ }
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------- 計算 ---------- */

function eventFor(productId) {
  return state.events.find(e => e.productId === productId) ?? null;
}

function recompute() {
  state.lines = PRODUCTS.map((product) => {
    const ev = eventFor(product.productId);
    const specialEvent = ev
      ? { date: ev.date, reason: ev.reason, description: ev.description, extraDemand: ev.extraDemand }
      : null;
    return evaluateLine({
      product, salesData: state.salesData, settings: state.settings, specialEvent,
      orderQuantity: state.quantities[product.productId],
      countedOnHand: state.counts[product.productId],
    });
  });
}

function statusOf(line) {
  return lineStatus(line, state.approvals[line.productId]);
}

/* ---------- 今日補貨 ---------- */

function riskBadge(line) {
  const s = statusOf(line);
  return `<span class="badge badge-${s.key}">${esc(s.label)}</span>`;
}

function renderReplenish() {
  const lines = state.lines;
  const statuses = lines.map(statusOf);
  const needCount = lines.filter(l => l.aResult.suggestedQuantity > 0).length;
  const pendingStore = statuses.filter(s => s.key === 'warning').length;
  const pendingMgr = statuses.filter(s => s.key === 'high').length;
  const blocked = statuses.filter(s => s.key === 'blocked' || s.key === 'rejected').length;
  const total = lines.reduce((s, l) => s + (typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : 0), 0);
  const { settings } = state;
  const submitted = submittedOrderFor(state.orders, STORE.storeId, settings.forecastDate);
  const ready = !submitted && !pendingStore && !pendingMgr && !blocked && total > 0;

  $('#tab-replenish').innerHTML = `
    <div class="settings card">
      <div class="field">
        <label for="forecast-date">預計到貨日（預測日期）</label>
        <input type="date" id="forecast-date" value="${esc(settings.forecastDate)}">
      </div>
      <label class="check"><input type="checkbox" id="is-holiday" ${settings.isHoliday ? 'checked' : ''}>
        假日／連假 <small>需求 ×${HOLIDAY_MULTIPLIER}</small></label>
      <label class="check"><input type="checkbox" id="is-promotion" ${settings.isPromotion ? 'checked' : ''}>
        促銷檔期 <small>需求 ×${PROMOTION_MULTIPLIER}</small></label>
      <button class="btn ghost" id="reset-qty">全部恢復系統建議量</button>
    </div>

    <div class="stats">
      <div class="stat"><span>商品品項</span><strong>${lines.length}</strong></div>
      <div class="stat"><span>需要補貨</span><strong>${needCount}</strong></div>
      <div class="stat warn"><span>待店長確認</span><strong>${pendingStore}</strong></div>
      <div class="stat high"><span>高風險待確認</span><strong>${pendingMgr}</strong></div>
      <div class="stat"><span>本次訂貨總量</span><strong>${fmt(total)}</strong></div>
    </div>

    <div class="card table-wrap">
      <table class="grid">
        <thead><tr>
          <th>商品</th><th class="num">帳面庫存</th><th class="num">今晚盤點</th><th class="num">在途</th>
          <th class="num">預測需求</th><th class="num">安全庫存</th>
          <th class="num">系統建議</th><th class="num">訂貨量</th><th>狀態</th><th></th>
        </tr></thead>
        <tbody>${lines.map(rowHtml).join('')}</tbody>
      </table>
    </div>

    <div class="actionbar">
      <p>${submitted ? `${esc(settings.forecastDate)} 的補貨單 ${esc(submitted.orderId)} 已送出，同一到貨日不能重複訂貨。`
        : ready ? '所有品項已檢查完成，可以產生補貨單。'
        : blocked ? `有 ${blocked} 個品項資料錯誤或被退回，請先修正盤點數或訂貨量。`
        : pendingStore || pendingMgr ? `尚有 ${pendingStore + pendingMgr} 個品項需要確認或審核（點「明細」處理）。`
        : '目前沒有需要訂貨的品項。'}</p>
      <button class="btn primary" id="build-order" ${ready ? '' : 'disabled'}>產生補貨單</button>
    </div>`;
}

function rowHtml(line) {
  const { product, aResult, calc } = line;
  const raw = state.quantities[product.productId];
  const value = raw === undefined ? aResult.suggestedQuantity : raw;
  const changed = raw !== undefined && parseQuantityInput(raw) !== aResult.suggestedQuantity;
  const flags = [
    line.appliedEvent ? `<span class="tag event">活動 +${fmt(calc.extraDemand)}</span>` : '',
    calc.historyHasEvent ? '<span class="tag note" title="最近銷售含特殊活動日，預測可能偏高">歷史含活動日</span>' : '',
  ].join('');
  return `<tr data-pid="${esc(product.productId)}" class="${state.selected === product.productId ? 'selected' : ''}">
    <td><div class="pname">${esc(product.name)}</div>
      <div class="muted small">${esc(product.productId)}・${esc(product.category)}${
        product.orderMultiple > 1 ? `・每箱 ${product.orderMultiple}` : ''}</div>${flags}</td>
    <td class="num muted">${fmt(line.bookOnHand)}</td>
    <td class="num">${countInput(line)}</td>
    <td class="num">${fmt(product.onOrder)}</td>
    <td class="num">${fmt(aResult.forecastDemand)}</td>
    <td class="num">${fmt(product.safetyStock)}</td>
    <td class="num strong">${fmt(aResult.suggestedQuantity)}</td>
    <td class="num"><input class="qty ${changed ? 'changed' : ''}" inputmode="numeric"
      aria-label="${esc(product.name)} 訂貨量" data-pid="${esc(product.productId)}" value="${esc(value)}"></td>
    <td>${riskBadge(line)}</td>
    <td><button class="btn small" data-detail="${esc(product.productId)}">明細</button></td>
  </tr>`;
}

function countInput(line) {
  const raw = state.counts[line.productId];
  const value = raw === undefined ? line.bookOnHand : raw;
  const cls = line.countError ? 'invalid'
    : raw !== undefined && parseQuantityInput(raw) !== line.bookOnHand ? 'changed' : '';
  return `<input class="count ${cls}" inputmode="numeric" aria-label="${esc(line.product.name)} 今晚盤點數"
    data-pid="${esc(line.productId)}" value="${esc(value)}">`;
}

/* ---------- 明細側欄 ---------- */

function renderDrawer() {
  const drawer = $('#drawer');
  const line = state.lines.find(l => l.productId === state.selected);
  drawer.hidden = !line;
  $('#drawer-backdrop').hidden = !line;
  if (!line) return;
  const { product, aResult, calc, b1, b2 } = line;
  const status = statusOf(line);
  const history = historyFor(state.salesData, product.productId, 7);
  const maxSale = Math.max(...history.map(h => h.salesQuantity), 1);
  const rounding = aResult.suggestedQuantity !== aResult.unconstrainedQuantity && aResult.suggestedQuantity > 0;
  const allIssues = [...(b2.b1Issues ?? []), ...b2.issues];
  const checks = [
    ['容量檢查', true],
    ['效期檢查', product.shelfLifeDays != null],
  ];

  drawer.innerHTML = `
    <header class="drawer-head">
      <div><h2>${esc(product.name)}</h2>
        <p class="muted">${esc(product.productId)}・${esc(product.category)}・單位：${esc(product.unit)}</p></div>
      <button class="btn ghost" id="close-drawer" aria-label="關閉">✕</button>
    </header>

    <section>
      <h3>1. 歷史銷售（A2 取最近 ${HISTORY_DAYS} 筆）</h3>
      <div class="bars">${history.map(h => `
        <div class="bar ${h.usedInForecast ? 'used' : ''}" title="${esc(h.date)}：${h.salesQuantity}${h.specialEvent ? '（' + esc(h.specialEvent) + '）' : ''}">
          <span class="bar-val">${h.salesQuantity}</span>
          <span class="bar-fill" style="height:${Math.max(4, h.salesQuantity / maxSale * 80)}px"></span>
          <span class="bar-label">${esc(h.date.slice(5))}${h.specialEvent ? '<b>★</b>' : ''}</span>
        </div>`).join('')}</div>
      ${calc.historyHasEvent ? '<p class="hint warn">★ 最近紀錄含特殊活動日，預測需求可能偏高，請店長判斷是否下修訂貨量。</p>' : ''}
    </section>

    <section>
      <h3>2. 系統建議量怎麼算</h3>
      <ol class="calc">
        <li>移動平均 = (${calc.historySales.join(' + ')}) ÷ ${calc.historySales.length} = <b>${fmt(calc.baseAverage)}</b></li>
        <li>特殊日期調整 × ${calc.multiplier === 1 ? '1（平日）' : fmt(Number(calc.multiplier.toFixed(2)))} → 四捨五入 <b>${fmt(calc.baseForecast)}</b></li>
        ${calc.extraDemand ? `<li>特殊事件額外需求 + ${fmt(calc.extraDemand)} → 預測需求 <b>${fmt(aResult.forecastDemand)}</b></li>` : ''}
        ${calc.eventOutsidePeriod ? '<li class="muted">已登錄的特殊事件不在預測日期內，未加入需求</li>' : ''}
        <li>目標庫存 = 預測需求 ${fmt(aResult.forecastDemand)} + 安全庫存 ${fmt(aResult.safetyStock)} = <b>${fmt(aResult.targetStock)}</b></li>
        <li>庫存位置 = 盤點 ${fmt(product.onHand)}${product.onHand !== line.bookOnHand ? `（帳面 ${fmt(line.bookOnHand)}）` : ''} + 在途 ${fmt(product.onOrder)} − 欠貨 ${fmt(product.backorders)} = <b>${fmt(aResult.inventoryPosition)}</b></li>
        <li>需補量 = max(0, ${fmt(aResult.targetStock)} − ${fmt(aResult.inventoryPosition)}) = <b>${fmt(aResult.unconstrainedQuantity)}</b></li>
        ${rounding ? `<li>依最低訂購量 ${fmt(product.minimumOrderQuantity)}、整箱倍數 ${fmt(product.orderMultiple)} 調整</li>` : ''}
      </ol>
      <p class="result">系統建議補貨：<b>${fmt(aResult.suggestedQuantity)} ${esc(product.unit)}</b>
        ${typeof line.quantity === 'number' && line.quantity !== aResult.suggestedQuantity
          ? `，店長目前輸入 <b>${fmt(line.quantity)}</b>` : ''}</p>
    </section>

    <section>
      <h3>3. 風險檢查（B1 異常偵測＋B2 風險審核）</h3>
      <p>風險等級：${riskBadge(line)}</p>
      ${allIssues.length ? `<ul class="issues">${allIssues.map(i => `
        <li class="lvl-${esc(i.level)}"><span>${esc(levelLabel(i.level))}</span>${esc(issueText(i))}</li>`).join('')}</ul>`
        : '<p class="ok-text">✓ 沒有發現異常</p>'}
      <ul class="checks">${checks.map(([name, done]) => `
        <li>${done ? '✓' : '—'} ${name}${done ? '' : '：非效期商品，不適用'}</li>`).join('')}
        ${capacityLine(line)}
      </ul>
    </section>

    ${approvalHtml(line, status)}`;
}

function capacityLine(line) {
  const projected = line.riskProduct.expectedStockAtArrival +
    (typeof line.quantity === 'number' ? line.quantity : 0);
  const over = projected > line.product.maxCapacity;
  return `<li class="${over ? 'over' : ''}">${over ? '✗' : '✓'} 到貨後預估庫存 ${fmt(projected)} ／容量 ${fmt(line.product.maxCapacity)}${over ? '（超過容量）' : ''}</li>`;
}

// B2 原文寫「需主管審核」；C 組流程改為店長二次確認、主管事後覆核，顯示時對齊新流程
function issueText(issue) {
  return issue.message.replace('需主管審核', '需店長二次確認，主管事後覆核');
}

function levelLabel(level) {
  return { error: '錯誤', warning: '提醒', high: '高風險', info: '紀錄' }[level] ?? level;
}

function approvalHtml(line, status) {
  const approval = state.approvals[line.productId];
  if (status.key === 'ok') return '';
  if (status.key === 'blocked') {
    return `<section class="approve"><h3>4. 需要修正</h3><p>${line.countError
      ? '今晚盤點數必須是 0 以上的整數，請回到列表修正。'
      : '訂貨量格式錯誤（空白、文字、小數或負數），系統禁止送出，請回到列表修正。'}</p></section>`;
  }
  if (status.key === 'approved' || status.key === 'rejected' || status.key === 'override') {
    const d = approval.decision;
    return `<section class="approve done"><h3>4. 確認紀錄</h3>
      <p>${d.actorRole === 'supervisor' ? `主管 ${esc(d.reviewerId)}` : '店長'}
        ${d.reviewStatus === 'rejected' ? '已退回' : '已確認'}：「${esc(d.reason)}」</p>
      ${status.key === 'override'
        ? '<p class="muted">店長已二次確認並承擔責任，補貨單會照常送出；區督導之後在「補貨單紀錄」事後覆核。</p>' : ''}
      <button class="btn ghost" id="undo-approval">撤銷確認</button></section>`;
  }
  const needManager = status.key === 'high';
  const isManagerRole = state.role === 'supervisor';
  if (needManager && !isManagerRole) return overrideHtml(line);
  return `<section class="approve">
    <h3>4. ${needManager ? '主管審核' : '店長確認'}</h3>
    <div class="field"><label for="ap-reason">原因</label>
      <select id="ap-reason">${CONFIRM_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>
    <div class="field"><label for="ap-note">補充說明（至少 5 個字）</label>
      <input id="ap-note" placeholder="例如：週六體育館有演唱會"></div>
    ${needManager ? `<div class="field"><label for="ap-reviewer">主管編號</label>
      <input id="ap-reviewer" value="SUP-01"></div>` : ''}
    <div class="row">
      <button class="btn primary" id="approve">${needManager ? '核准' : '確認此數量'}</button>
      ${needManager ? '<button class="btn danger" id="reject">退回</button>' : ''}
      <button class="btn ghost" id="revert-qty">改回系統建議量 ${fmt(line.aResult.suggestedQuantity)}</button>
    </div>
    <p id="ap-error" class="hint warn" hidden></p>
  </section>`;
}

function overrideHtml(line) {
  return `<section class="approve">
    <h3>4. 高風險訂貨：店長二次確認</h3>
    <p>這個數量明顯超出平常，可能是手誤，也可能真的有特殊需求。
      系統<b>不會扣單，也不必等主管</b>：確認是真實需求後就能送出，區督導事後覆核。</p>
    <div class="field"><label for="ov-reason">原因</label>
      <select id="ov-reason">${CONFIRM_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>
    <div class="field"><label for="ov-note">補充說明（至少 5 個字）</label>
      <input id="ov-note" placeholder="例如：朋友週末辦戶外活動，需要雨衣"></div>
    <div class="field"><label for="ov-confirm">請再輸入一次訂貨量（防止多按或少按）</label>
      <input id="ov-confirm" inputmode="numeric" autocomplete="off"></div>
    <label class="check ack"><input type="checkbox" id="ov-ack">
      我確認此數量正確，由店長負責，送出後由區督導事後覆核</label>
    <div class="row">
      <button class="btn primary" id="override-submit">二次確認此數量</button>
      <button class="btn ghost" id="revert-qty">改回系統建議量 ${fmt(line.aResult.suggestedQuantity)}</button>
    </div>
    <p id="ap-error" class="hint warn" hidden></p>
  </section>`;
}

function submitOverride() {
  const line = state.lines.find(l => l.productId === state.selected);
  const result = makeStoreOverride(line, {
    reason: $('#ov-reason').value, note: $('#ov-note').value,
    confirmQuantity: $('#ov-confirm').value, acknowledged: $('#ov-ack').checked,
  });
  if (!result.ok) {
    const err = $('#ap-error');
    err.textContent = result.error;
    err.hidden = false;
    return;
  }
  state.approvals[line.productId] = result.approval;
  toast(`${line.product.name} 已二次確認，送出後由主管事後覆核`);
  render();
}

function submitApproval(decision) {
  const line = state.lines.find(l => l.productId === state.selected);
  const reason = `${$('#ap-reason').value}：${$('#ap-note').value.trim()}`;
  const note = $('#ap-note').value.trim();
  if (note.length < 5) {
    const err = $('#ap-error');
    err.textContent = '請填寫至少 5 個字的補充說明，作為審核紀錄。';
    err.hidden = false;
    return;
  }
  const reviewerId = $('#ap-reviewer')?.value.trim() ?? '';
  const approval = makeApproval(line, { actorRole: state.role, decision, reason, reviewerId });
  if (decision === 'approve' && !approval.decision.canSubmit) {
    const err = $('#ap-error');
    err.textContent = '核准未通過，請確認身分與主管編號。';
    err.hidden = false;
    return;
  }
  state.approvals[line.productId] = approval;
  toast(decision === 'reject' ? `${line.product.name} 已退回` : `${line.product.name} 已確認`);
  render();
}

/* ---------- 特殊事件 ---------- */

function renderEvents() {
  $('#tab-events').innerHTML = `
    <div class="two-col">
      <form class="card" id="event-form">
        <h2>登錄特殊事件</h2>
        <p class="muted">例如附近演唱會、颱風、團購預訂。系統會把額外需求加到預測需求後重新計算建議量，
          並自動列入風險審核紀錄。</p>
        <div class="field"><label for="ev-product">商品</label>
          <select id="ev-product">${PRODUCTS.map(p => `<option value="${esc(p.productId)}">${esc(p.productId)} ${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ev-date">活動日期</label>
          <input type="date" id="ev-date" value="${esc(state.settings.forecastDate)}" required></div>
        <div class="field"><label for="ev-reason">原因類別</label>
          <select id="ev-reason">${B2_EVENT_REASONS.map(r => `<option value="${r}">${esc(EVENT_REASON_LABELS[r])}</option>`).join('')}</select></div>
        <div class="field"><label for="ev-desc">說明（至少 5 個字）</label>
          <input id="ev-desc" placeholder="例如：小巨蛋週四晚間演唱會" required></div>
        <div class="field"><label for="ev-extra">預估額外需求（件）</label>
          <input id="ev-extra" type="number" min="1" step="1" required></div>
        <p id="ev-error" class="hint warn" hidden></p>
        <button class="btn primary" type="submit">登錄事件並重新計算</button>
      </form>
      <div class="card">
        <h2>已登錄事件</h2>
        ${state.events.length ? `<ul class="event-list">${state.events.map((e, i) => {
          const p = PRODUCTS.find(x => x.productId === e.productId);
          const inPeriod = e.date === state.settings.forecastDate;
          return `<li><div><b>${esc(p.name)}</b>　${esc(e.date)}・${esc(EVENT_REASON_LABELS[e.reason])}
            <div class="muted">${esc(e.description)}・額外需求 +${fmt(e.extraDemand)}</div>
            ${inPeriod ? '<span class="tag event">已套用至本次預測</span>' : '<span class="tag note">不在預測日期內，未套用</span>'}</div>
            <button class="btn small ghost" data-remove-event="${i}">移除</button></li>`;
        }).join('')}</ul>` : '<p class="muted">目前沒有特殊事件。</p>'}
      </div>
    </div>`;
}

function addEvent(e) {
  e.preventDefault();
  const ev = {
    productId: $('#ev-product').value,
    date: $('#ev-date').value,
    reason: $('#ev-reason').value,
    description: $('#ev-desc').value.trim(),
    extraDemand: Number($('#ev-extra').value),
  };
  const err = $('#ev-error');
  if (ev.description.length < 5 || !Number.isSafeInteger(ev.extraDemand) || ev.extraDemand <= 0 || !ev.date) {
    err.textContent = '請填寫有效日期、至少 5 個字的說明，以及正整數的額外需求。';
    err.hidden = false;
    return;
  }
  state.events = state.events.filter(x => x.productId !== ev.productId);
  state.events.push(ev);
  delete state.quantities[ev.productId];
  delete state.approvals[ev.productId];
  toast('特殊事件已登錄，建議量已重新計算');
  render();
}

/* ---------- 補貨單 ---------- */

function openOrderPreview() {
  recompute(); // 送單前以最新資料重新執行 A/B1/B2
  const order = buildOrder({
    store: STORE, settings: state.settings, lines: state.lines,
    approvals: state.approvals,
    sequence: state.orders.filter(o => o.storeId === STORE.storeId).length + 1,
  });
  if (!order) { toast('仍有品項未完成確認'); render(); return; }
  const dialog = $('#order-dialog');
  dialog.innerHTML = orderHtml(order, true);
  dialog.showModal();
  $('#confirm-submit', dialog).addEventListener('click', () => {
    state.orders.unshift(order);
    saveOrders();
    state.quantities = {};
    state.approvals = {};
    state.counts = {};
    dialog.close();
    toast(`補貨單 ${order.orderId} 已送交統家總部（模擬）`);
    state.tab = 'orders';
    render();
  });
}

function riskText(item) {
  if (item.postReview) return '店長二次確認';
  return { normal: '正常', warning: '已確認', high: '主管核准' }[item.riskLevel] ?? item.riskLevel;
}

function reviewText(r) {
  if (!r.postReview) return '';
  if (r.postReview.status === 'reviewed') {
    return `<span class="badge badge-approved">主管 ${esc(r.postReview.reviewerId)} 已覆核</span>`;
  }
  return state.role === 'supervisor'
    ? `<button class="btn small primary" data-review="${esc(r.productId)}">覆核通過</button>`
    : '<span class="badge badge-warning">待主管事後覆核</span>';
}

function orderHtml(order, preview) {
  const reviewed = order.auditRecords.filter(r => r.riskLevel !== 'normal');
  return `<div class="order-doc">
    <header><h2>${preview ? '補貨單預覽' : '補貨單'}</h2><button class="btn ghost" data-close-dialog aria-label="關閉">✕</button></header>
    <dl class="meta">
      <div><dt>單號</dt><dd>${esc(order.orderId)}</dd></div>
      <div><dt>門市</dt><dd>${esc(order.storeName)}（${esc(order.storeId)}）</dd></div>
      <div><dt>到貨日</dt><dd>${esc(order.deliveryDate)}</dd></div>
      <div><dt>建立時間</dt><dd>${esc(new Date(order.createdAt).toLocaleString('zh-TW'))}</dd></div>
    </dl>
    <table class="grid">
      <thead><tr><th>商品</th><th class="num">系統建議</th><th class="num">訂貨量</th><th>風險</th></tr></thead>
      <tbody>${order.items.map(i => `<tr><td>${esc(i.productId)} ${esc(i.name)}</td>
        <td class="num">${fmt(i.suggestedQuantity)}</td><td class="num strong">${fmt(i.quantity)} ${esc(i.unit)}</td>
        <td>${esc(riskText(i))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>合計</td><td></td><td class="num strong">${fmt(order.totalQuantity)}</td><td></td></tr></tfoot>
    </table>
    ${reviewed.length ? `<h3>審核紀錄</h3><ul class="audit">${reviewed.map(r => `<li>
      <b>${esc(r.productId)}</b> 建議 ${fmt(r.suggestedQuantity)} → 訂購 ${fmt(r.updatedQuantity)}，
      ${r.actorRole === 'supervisor' ? `主管 ${esc(r.reviewerId)}核准`
        : r.doubleConfirmed ? '店長二次確認' : '店長確認'}：${esc(r.reason)}
      <span class="muted">（${esc(r.riskIssueCodes.concat(r.b1IssueCodes).join(', '))}）</span>
      ${preview ? '' : reviewText(r)}</li>`).join('')}</ul>` : ''}
    ${preview ? `<div class="row end"><button class="btn ghost" data-close-dialog>返回修改</button>
      <button class="btn primary" id="confirm-submit">確認送出給統家總部</button></div>` : ''}
  </div>`;
}

function renderOrders() {
  $('#tab-orders').innerHTML = `<div class="card">
    <h2>補貨單紀錄</h2>
    <p class="muted">補貨單為模擬送出，紀錄儲存在這台電腦的瀏覽器中。
      店長二次確認的高風險品項，由區督導在這裡點「查看」事後覆核。</p>
    ${state.orders.length ? `<table class="grid"><thead><tr><th>單號</th><th>到貨日</th><th class="num">品項</th>
      <th class="num">總量</th><th>狀態</th><th></th></tr></thead><tbody>
      ${state.orders.map((o, i) => `<tr><td>${esc(o.orderId)}</td><td>${esc(o.deliveryDate)}</td>
        <td class="num">${o.items.length}</td><td class="num">${fmt(o.totalQuantity)}</td>
        <td><span class="badge badge-ok">已送出</span>${pendingReviewCount(o)
          ? ` <span class="badge badge-warning">${pendingReviewCount(o)} 項待事後覆核</span>` : ''}</td>
        <td><button class="btn small" data-view-order="${i}">查看</button></td></tr>`).join('')}
      </tbody></table>
      <button class="btn ghost" id="clear-orders">清除示範紀錄</button>` : '<p>尚未送出任何補貨單。</p>'}
  </div>`;
}

/* ---------- 模型說明 ---------- */

function renderModel() {
  $('#tab-model').innerHTML = `
  <div class="card prose">
    <h2>庫存管理模式：定期盤點、補到目標庫存（R, S）</h2>
    <p>便利店每天固定時間訂貨、隔天到貨，屬於<b>定期盤點系統（Periodic Review）</b>。
      每次訂貨時，系統把每樣商品「補到」一個目標庫存水準 S，而不是每次訂固定數量。</p>
    ${sawtoothSvg()}
    <div class="formula">
      <div><span>目標庫存 S</span> = 預測需求 + 安全庫存</div>
      <div><span>庫存位置 IP</span> = 現有庫存 + 在途量 − 欠貨</div>
      <div><span>建議補貨量 Q</span> = max(0, S − IP)，再依最低訂購量與整箱倍數向上取整</div>
    </div>

    <h2>需求預測：簡單移動平均＋特殊日期調整</h2>
    <ul>
      <li>取最近 ${HISTORY_DAYS} 筆銷售的平均作為基礎需求（簡單移動平均 SMA）。</li>
      <li>假日／連假 ×${HOLIDAY_MULTIPLIER}，促銷 ×${PROMOTION_MULTIPLIER}，兩者同時發生時相乘。</li>
      <li>店長登錄的特殊事件（演唱會、團購等），額外需求直接加到預測需求上。</li>
    </ul>

    <h2>安全庫存：應付預測誤差</h2>
    <p>需求不會剛好等於預測。安全庫存是額外保留的緩衝量，避免缺貨；
      鮮食類效期短，安全庫存不宜過高，以免報廢。</p>

    <h2>風險控管：系統建議，店長決定</h2>
    <table class="grid">
      <thead><tr><th>情況</th><th>系統反應</th></tr></thead>
      <tbody>
        <tr><td>空白、文字、小數、負數</td><td><span class="badge badge-blocked">禁止送出</span></td></tr>
        <tr><td>超過建議量 ${B1_DEFAULT_POLICY.upwardRatio} 倍、少於 ${B1_DEFAULT_POLICY.downwardRatio * 100}%、或達 ${B1_DEFAULT_POLICY.largeOrderQuantity} 件</td>
          <td><span class="badge badge-warning">店長選原因確認</span></td></tr>
        <tr><td>超過建議量 ${B2_DEFAULT_POLICY.highOrderRatio} 倍、超過儲存容量、嚴重效期風險</td>
          <td><span class="badge badge-high">店長二次確認後送出，主管事後覆核</span></td></tr>
        <tr><td>登錄特殊事件</td><td><span class="badge badge-warning">店長確認並留下紀錄</span></td></tr>
      </tbody>
    </table>
    <p class="muted small">以上倍數與門檻為課堂原型示範值，不是統家實際政策。</p>
  </div>`;
}

function sawtoothSvg() {
  // 示意：每天補到目標庫存 S，庫存隨銷售下降
  const S = 60, ss = 15, days = 6, w = 560, h = 200, pad = 36;
  const x = d => pad + d / days * (w - pad * 2);
  const y = v => h - pad - v / (S + 10) * (h - pad * 2);
  const ends = [22, 18, 28, 20, 24, 19];
  let path = `M${x(0)},${y(S)}`;
  ends.forEach((end, d) => { path += ` L${x(d + 1)},${y(end)} L${x(d + 1)},${y(S)}`; });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="定期補貨庫存變化示意圖">
    <line x1="${pad}" x2="${w - pad}" y1="${y(S)}" y2="${y(S)}" class="ref"/>
    <text x="${w - pad}" y="${y(S) - 6}" text-anchor="end" class="lbl">目標庫存 S</text>
    <line x1="${pad}" x2="${w - pad}" y1="${y(ss)}" y2="${y(ss)}" class="ref safety"/>
    <text x="${w - pad}" y="${y(ss) - 6}" text-anchor="end" class="lbl">安全庫存</text>
    <path d="${path}" class="line"/>
    ${ends.map((_, d) => `<text x="${x(d + 1)}" y="${h - 12}" text-anchor="middle" class="lbl">第${d + 1}天</text>`).join('')}
    <text x="${pad}" y="${h - 12}" class="lbl">訂貨</text>
  </svg>`;
}

/* ---------- 主繪製與事件 ---------- */

function render() {
  recompute();
  document.querySelectorAll('.tabs [role=tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  });
  for (const tab of ['replenish', 'events', 'orders', 'model']) {
    $(`#tab-${tab}`).hidden = tab !== state.tab;
  }
  // 保留輸入框焦點與游標位置，避免重繪打斷店長輸入
  const active = document.activeElement;
  const focusCls = ['qty', 'count'].find(c => active?.classList?.contains(c));
  const focusPid = focusCls ? active.dataset.pid : null;
  const caret = focusPid ? active.selectionStart : null;

  if (state.tab === 'replenish') renderReplenish();
  if (state.tab === 'events') renderEvents();
  if (state.tab === 'orders') renderOrders();
  if (state.tab === 'model') renderModel();
  renderDrawer();

  if (focusPid) {
    const input = document.querySelector(`.${focusCls}[data-pid="${focusPid}"]`);
    input?.focus();
    input?.setSelectionRange(caret, caret);
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-tab]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; state.selected = null; render(); return; }
  if (t.dataset.detail) { state.selected = t.dataset.detail; render(); return; }
  if (t.id === 'close-drawer') { state.selected = null; render(); return; }
  if (t.id === 'reset-qty') { state.quantities = {}; state.approvals = {}; render(); return; }
  if (t.id === 'approve') { submitApproval('approve'); return; }
  if (t.id === 'override-submit') { submitOverride(); return; }
  if (t.dataset.review) {
    const dialog = $('#order-dialog');
    const idx = Number(dialog.dataset.orderIndex);
    state.orders[idx] = reviewOrderItem(state.orders[idx], t.dataset.review,
      { reviewerId: 'SUP-01', note: '事後覆核通過' });
    saveOrders();
    dialog.innerHTML = orderHtml(state.orders[idx], false);
    toast('已完成事後覆核');
    render(); return;
  }
  if (t.id === 'reject') { submitApproval('reject'); return; }
  if (t.id === 'undo-approval') { delete state.approvals[state.selected]; render(); return; }
  if (t.id === 'revert-qty') {
    delete state.quantities[state.selected];
    delete state.approvals[state.selected];
    toast('已改回系統建議量'); render(); return;
  }
  if (t.id === 'build-order') { openOrderPreview(); return; }
  if (t.dataset.removeEvent !== undefined) {
    const [ev] = state.events.splice(Number(t.dataset.removeEvent), 1);
    delete state.quantities[ev.productId];
    delete state.approvals[ev.productId];
    render(); return;
  }
  if (t.dataset.viewOrder !== undefined) {
    const dialog = $('#order-dialog');
    dialog.dataset.orderIndex = t.dataset.viewOrder;
    dialog.innerHTML = orderHtml(state.orders[Number(t.dataset.viewOrder)], false);
    dialog.showModal(); return;
  }
  if (t.hasAttribute('data-close-dialog')) { $('#order-dialog').close(); return; }
  if (t.id === 'clear-orders') { state.orders = []; saveOrders(); render(); }
});

$('#drawer-backdrop').addEventListener('click', () => { state.selected = null; render(); });

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('qty')) {
    state.quantities[e.target.dataset.pid] = e.target.value;
    render();
  } else if (e.target.classList.contains('count')) {
    // 盤點數改變 → 建議量重算；店長沒改過訂貨量時，訂貨量自動跟著新建議量
    state.counts[e.target.dataset.pid] = e.target.value;
    render();
  }
});

document.addEventListener('change', (e) => {
  const { id } = e.target;
  if (id === 'forecast-date') {
    state.settings.forecastDate = e.target.value || state.settings.forecastDate;
    state.settings.isHoliday = isHolidayDate(state.settings.forecastDate);
  }
  else if (id === 'is-holiday') state.settings.isHoliday = e.target.checked;
  else if (id === 'is-promotion') state.settings.isPromotion = e.target.checked;
  else if (id === 'role-select') state.role = e.target.value;
  else return;
  if (id !== 'role-select') { state.quantities = {}; state.approvals = {}; }
  render();
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'event-form') addEvent(e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
});

async function init() {
  $('#store-name').textContent = `${STORE.storeName}（${STORE.storeId}）`;
  try {
    const res = await fetch('../sales_data.json');
    state.salesData = [...await res.json(), ...EXTRA_SALES_DATA];
  } catch {
    $('#tab-replenish').innerHTML = '<p class="card">無法讀取 sales_data.json，請用 <code>npm start</code> 啟動伺服器後開啟。</p>';
    return;
  }
  render();
}

init();
