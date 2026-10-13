import {assessB2, decideB2, prepareEventDemandAdjustment, createB2AuditRecord} from './b2-risk-review.mjs';
const specialEvent={date:'2026-10-20',reason:'event',description:'附近演唱會額外需求',extraDemand:180};
const request=prepareEventDemandAdjustment({productId:'TEA-001',orderId:'ORD-001',specialEvent,
  forecastStartDate:'2026-10-19',forecastEndDate:'2026-10-21',baseForecastDemand:25});
console.log('B2提供給A組的需求調整資料:',request);
// This B1 result is simulated. A must recalculate with adjustedForecastDemand,
// then B1 must re-check the actual manager quantity before final B2 assessment.
const b1Result={productId:'TEA-001',suggestedQuantity:205,orderQuantity:200,
  status:'ok',canProceed:true,requiresConfirmation:false,issues:[]};
const assessment=assessB2({b1Result,specialEvent,
  product:{expectedStockAtArrival:10,maxCapacity:500,dailyForecast:30,remainingShelfLifeDays:10}});
console.log('重新評估風險:',assessment);
const decision=decideB2(assessment,{actorRole:'store_manager',decision:'approve',reason:'已核實附近活動需求',reviewerId:'STORE-01'});
console.log('模擬店長確認:',decision);
console.log('審核紀錄:',JSON.stringify(createB2AuditRecord({orderId:'ORD-001',b1Result,assessment,
 reviewDecision:decision,actorId:'STORE-01',originalQuantity:20,updatedQuantity:200,
 specialEvent,timestamp:'2026-10-13T15:00:00.000Z'}),null,2));
