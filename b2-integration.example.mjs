/**
 * Run only after PR #1 merges into this branch (or B1 is available locally).
 * A -> B1 -> B2, with C providing the manager's input and product metadata.
 */
import {calculateReorderQuantity} from './replenishment.mjs';
import {checkReplenishmentResult} from './b1-anomaly.mjs';
import {assessB2,decideB2} from './b2-risk-review.mjs';

const aResult=calculateReorderQuantity({
 productId:'TEA-001',forecastDemand:25,safetyStock:5,onHand:10
});
const managerQuantity=200;
const b1Result=checkReplenishmentResult(aResult,managerQuantity);
const b2Result=assessB2({
 b1Result,
 product:{expectedStockAtArrival:10,maxCapacity:500,
          dailyForecast:30,remainingShelfLifeDays:10},
 specialEvent:{date:'2026-10-20',reason:'event',
               description:'附近演唱會增加需求',extraDemand:180}
});
console.log({aResult,b1Result,b2Result});
console.log('主管模擬審核:',decideB2(b2Result,{
 actorRole:'supervisor',reviewerId:'SUP-01',decision:'approve',reason:'已核實活動需求'
}));
// IMPORTANT: this example never submits an order.
// C/backend must re-run checks using trusted current data before actual submission.
