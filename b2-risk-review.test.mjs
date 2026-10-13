import test from 'node:test';
import assert from 'node:assert/strict';
import {assessB2,decideB2} from './b2-risk-review.mjs';

const b1 = (quantity=20,suggested=20,status='ok') => ({
 productId:'TEA',orderQuantity:quantity,suggestedQuantity:suggested,
 status,canProceed:true,requiresConfirmation:status==='warning',issues:[]
});
const assess = (quantity=20,suggested=20,status='ok',product={},specialEvent=null) =>
 assessB2({b1Result:b1(quantity,suggested,status),product,specialEvent});

test('正常訂貨可進入送單前最後確認',()=>{
 const r=assess();assert.equal(r.riskLevel,'normal');assert.equal(r.canSubmit,true);
});
test('B1警告需要店長二次確認',()=>{
 const r=assess(30,20,'warning');
 assert.equal(r.reviewStatus,'pending_store_confirmation');
 assert.equal(decideB2(r,{actorRole:'store_manager',decision:'approve',reason:'促銷補貨需求'}).canSubmit,true);
});
test('疑似多打一個零需主管核准',()=>{
 const r=assess(200,20,'warning');
 assert.equal(r.riskLevel,'high');
 assert.equal(decideB2(r,{actorRole:'store_manager',decision:'approve',reason:'我確定要訂購'}).canSubmit,false);
 assert.equal(decideB2(r,{actorRole:'supervisor',reviewerId:'S001',decision:'approve',reason:'已核實團購需求'}).canSubmit,true);
});
test('B1阻擋不得繞過',()=>{
 const r=assessB2({b1Result:{...b1(),status:'blocked',canProceed:false,issues:[{code:'INVALID',level:'error'}]}});
 assert.equal(r.riskLevel,'blocked');assert.equal(decideB2(r,{decision:'approve'}).canSubmit,false);
});
test('缺少資料不會默認庫存為0',()=>assert.equal(assess().issues.length,0));
test('容量超標需主管核准',()=>{
 const r=assess(30,30,'ok',{expectedStockAtArrival:90,maxCapacity:100});
 assert.equal(r.riskLevel,'high');assert.ok(r.issues.some(i=>i.code==='CAPACITY_EXCEEDED'));
});
test('效期內無法售完需警示',()=>{
 const r=assess(30,30,'ok',{expectedStockAtArrival:10,dailyForecast:5,remainingShelfLifeDays:3});
 assert.equal(r.riskLevel,'high');
});
test('特殊事件不會自動解除容量風險',()=>{
 const event={date:'2026-10-20',reason:'event',description:'附近大型演唱會',extraDemand:100};
 const r=assess(30,30,'ok',{expectedStockAtArrival:90,maxCapacity:100},event);
 assert.equal(r.riskLevel,'high');
});
test('特殊事件資料錯誤時阻擋',()=>{
 const r=assess(20,20,'ok',{}, {date:'2026-02-30',reason:'event',description:'活動',extraDemand:20});
 assert.equal(r.riskLevel,'blocked');
});
test('未填原因不可批准警告訂單',()=>{
 const r=assess(30,20,'warning');
 assert.equal(decideB2(r,{actorRole:'store_manager',decision:'approve'}).canSubmit,false);
});
test('高風險拒絕訂單',()=>{
 const r=assess(200,20,'warning');
 assert.equal(decideB2(r,{actorRole:'supervisor',decision:'reject'}).reviewStatus,'rejected');
});
test('無效B1資料阻擋',()=>assert.equal(assessB2({b1Result:{status:'ok'}}).riskLevel,'blocked'));

import {prepareEventDemandAdjustment,createB2AuditRecord} from './b2-risk-review.mjs';
const event = {date:'2026-10-20',reason:'event',description:'附近演唱會額外需求',extraDemand:180};
test('活動在預測區間內，產生交給A組的調整需求',()=>{
 const r=prepareEventDemandAdjustment({productId:'TEA',specialEvent:event,forecastStartDate:'2026-10-19',forecastEndDate:'2026-10-21',baseForecastDemand:25});
 assert.equal(r.adjustedForecastDemand,205);
 assert.equal(r.status,'requires_a_recalculation');
});
test('活動不在預測區間，不重複加入需求',()=>{
 const r=prepareEventDemandAdjustment({productId:'TEA',specialEvent:event,forecastStartDate:'2026-10-13',forecastEndDate:'2026-10-15',baseForecastDemand:25});
 assert.equal(r.adjustedForecastDemand,25);
 assert.equal(r.eventApplied,false);
});
test('活動日期不合法時拒絕',()=>{
 assert.throws(()=>prepareEventDemandAdjustment({productId:'TEA',specialEvent:{...event,date:'2026-02-30'},forecastStartDate:'2026-10-19',forecastEndDate:'2026-10-21',baseForecastDemand:25}));
});
test('審核紀錄包含訂單、數量、時間與審核人',()=>{
 const result=assess(200,20,'warning');
 const decision=decideB2(result,{actorRole:'supervisor',reviewerId:'SUP-01',decision:'approve',reason:'已核實演唱會訂貨'});
 const record=createB2AuditRecord({orderId:'ORD-001',b1Result:b1(200,20,'warning'),assessment:result,reviewDecision:decision,actorId:'SUP-01',originalQuantity:20,updatedQuantity:200,specialEvent:event,timestamp:'2026-10-13T15:00:00.000Z'});
 assert.equal(record.reviewStatus,'approved');
 assert.equal(record.originalQuantity,20);
 assert.equal(record.updatedQuantity,200);
 assert.equal(record.reviewerId,'SUP-01');
 assert.equal(record.specialEvent.extraDemand,180);
});
test('紀錄的訂貨量與B1結果不一致時阻擋',()=>{
 const result=assess(200,20,'warning');
 const decision=decideB2(result,{actorRole:'supervisor',reviewerId:'SUP-01',decision:'approve',reason:'已核實演唱會訂貨'});
 assert.throws(()=>createB2AuditRecord({orderId:'ORD-001',b1Result:b1(200,20,'warning'),assessment:result,reviewDecision:decision,actorId:'SUP-01',originalQuantity:20,updatedQuantity:999,timestamp:'2026-10-13T15:00:00Z'}));
});
