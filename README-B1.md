# 統家自動補貨系統 — B1 異常偵測

此版本專門配合 `kipychb/tongjia-inventory-system` 的 `replenishment-system` 分支。

## 上傳方式
將 `b1-anomaly.mjs`、`b1-anomaly.test.mjs`、`b1-demo.mjs`、`b1-integration.example.mjs`、`README-B1.md` 放在 **GitHub 根目錄**，與 A 組 `replenishment.mjs` 同層；**不要覆蓋 A 組檔案**。

## 執行（Node.js 18+）
- `node --test b1-anomaly.test.mjs`：測試 B1。
- `node b1-demo.mjs`：執行 B1 獨立示範。
- `node b1-integration.example.mjs`：A+B1 串接示範（須有 A 組的 `replenishment.mjs`）。
- `node --test *.test.mjs`：執行 A/B1 全部測試（同目錄）。

## A 組的輸出
`calculateReorderQuantity({...})` 會輸出 `{ productId, suggestedQuantity, forecastDemand, ... }`。你的程式使用 `productId` 及 `suggestedQuantity`，店長更動的訂貨量由 C 組提供。

```js
import {checkReplenishmentResult} from './b1-anomaly.mjs';
const b1 = checkReplenishmentResult(aResult, managerQuantity);
```

## 回傳狀態
- `blocked`: 資料錯誤，禁止送單。
- `warning`: 發現異常；`requiresConfirmation: true`，C 組需顯示訊息並要求店長確認／提供原因；後續可交 B2 判斷是否主管審核。
- `ok`: B1 沒有發現異常，仍要送 B2 執行效期、容量、特殊事件等檢查。

`issues` 為陣列，含 `code`、`level`、`message`。

## 初始門檻（均屬示範，團隊需討論）
- 超過建議量 1.5 倍，且多至少 10 件：警告。
- 低於建議量一半，且少至少 10 件：警告。
- 訂貨量 100 件以上：大量訂貨警告。
- 建議為 0 卻訂貨、建議需補貨卻訂貨 0：警告。
- 空白、文字、小數、負數、NaN：阻擋。

**重要假設**：此版本商品以整數「件」計數。原始 A 組 `replenishment.mjs` 允許小數（如秤重商品），若業務需要小數單位，請先與 A/C 組統一單位與精度並調整 `integerOnly`。補貨量可能受整箱倍數、最小訂購量影響，告警應可由店長解釋，不能把門檻當實際公司規則。

本模組**沒有**建立網站、後端、送單、主管審核或寫入資料庫；這些是 C/B2 後續整合的工作。不可把 `canProceed` 當作直接送單授權。
