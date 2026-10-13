import {assessB2,decideB2} from './b2-risk-review.mjs';
const b1 = (suggestedQuantity,orderQuantity,status='ok')=>({
 productId:'TEA-001',suggestedQuantity,orderQuantity,status,
 canProceed:true,requiresConfirmation:status==='warning',issues:[]
});
const cases=[
 ['正常補貨',{b1Result:b1(20,20)}],
 ['手誤多一個0',{b1Result:b1(20,200,'warning')}],
 ['演唱會大量訂貨',{b1Result:b1(20,200,'warning'),
  specialEvent:{date:'2026-10-20',reason:'event',description:'演唱會飲料預購',extraDemand:180}}],
 ['容量超標',{b1Result:b1(20,30),product:{expectedStockAtArrival:90,maxCapacity:100}}],
 ['即期品',{b1Result:b1(20,30),product:{expectedStockAtArrival:10,dailyForecast:5,remainingShelfLifeDays:2}}],
];
for(const [name,input] of cases){
 const result=assessB2(input);
 console.log('\n'+name,JSON.stringify(result,null,2));
 if(result.riskLevel==='high') console.log('主管核准模擬',decideB2(result,{
  actorRole:'supervisor',reviewerId:'SUP-01',decision:'approve',reason:'已核實實際需求'
 }));
}
