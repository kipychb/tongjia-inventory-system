// 將這個檔案與原本的 replenishment.mjs 放在同一層，即可執行。
import {calculateReorderQuantity} from './replenishment.mjs';
import {checkReplenishmentResult} from './b1-anomaly.mjs';
const aResult = calculateReorderQuantity({
  productId:'WATER-001',forecastDemand:25,safetyStock:5,onHand:10
});
const b1Result = checkReplenishmentResult(aResult,200);
console.log('A組計算：',aResult);
console.log('B1檢查：',b1Result);
// C組依狀態處理：blocked=禁送單；warning=需確認；ok=可進B2審核
// 注意：正式送單前，後端必須用可信資料再執行A/B1/B2檢查。
