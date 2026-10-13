import test from 'node:test';
import assert from 'node:assert/strict';
import {checkB1, checkReplenishmentResult} from './b1-anomaly.mjs';
const base = {productId:'P01',suggestedQuantity:20,orderQuantity:20};
const run = (patch,policy) => checkB1({...base,...patch},policy);
test('正常訂貨',()=>assert.equal(run({}).status,'ok'));
test('輸入空白',()=>assert.equal(run({orderQuantity:''}).status,'blocked'));
test('輸入文字',()=>assert.equal(run({orderQuantity:'abc'}).status,'blocked'));
test('輸入負數',()=>assert.equal(run({orderQuantity:-1}).status,'blocked'));
test('輸入小數',()=>assert.equal(run({orderQuantity:1.5}).status,'blocked'));
test('NaN 防呆',()=>assert.equal(run({orderQuantity:NaN}).status,'blocked'));
test('未輸入商品代碼',()=>assert.equal(run({productId:''}).status,'blocked'));
test('上調至200件',()=>assert.equal(run({orderQuantity:200}).status,'warning'));
test('輸入過少',()=>assert.equal(run({orderQuantity:1}).status,'warning'));
test('建議量0卻訂貨',()=>assert.equal(run({suggestedQuantity:0,orderQuantity:10}).status,'warning'));
test('建議補貨卻訂貨0',()=>assert.equal(run({orderQuantity:0}).status,'warning'));
test('少量正常差異不亂警告',()=>assert.equal(run({orderQuantity:25}).status,'ok'));
test('大型訂貨需確認',()=>assert.equal(run({suggestedQuantity:110,orderQuantity:110}).requiresConfirmation,true));
test('不以警告阻擋但必須確認',()=>{
 const r=run({orderQuantity:200}); assert.equal(r.canProceed,true);assert.equal(r.requiresConfirmation,true);
});
test('自訂門檻',()=>assert.equal(run({orderQuantity:60},{largeOrderQuantity:50}).requiresConfirmation,true));
test('使用A組結果的適配器',()=>{
 const r=checkReplenishmentResult({productId:'P02',suggestedQuantity:17},170);
 assert.equal(r.productId,'P02');assert.equal(r.status,'warning');
});
test('缺少資料不會拋出未捕捉例外',()=>assert.equal(checkB1(null).status,'blocked'));
