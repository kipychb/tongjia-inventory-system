# 統家自動補貨系統 — B2 風險與審核

對應 GitHub `kipychb/tongjia-inventory-system`，以 `replenishment-system` 為基底，
串接 B1 PR #1 的 `checkReplenishmentResult()` 輸出。此模組使用 Node.js 18+ 原生 ESM，沒有第三方依賴。

## 五個檔案
- `b2-risk-review.mjs`：風險評估 `assessB2` 與審核決策 `decideB2`
- `b2-risk-review.test.mjs`：12 個自動測試
- `b2-demo.mjs`：正常、手誤、特殊活動、容量、效期模擬
- `b2-integration.example.mjs`：A → B1 → B2 串接（須先取得 B1 PR 檔案）
- `README-B2.md`：本說明

## 執行
```bash
node --test b2-risk-review.test.mjs
node b2-demo.mjs
# B1 已存在同層後才能執行
node b2-integration.example.mjs
```

## 介面
```js
const result = assessB2({
  b1Result, // B1 checkB1() 原始結果，請勿只傳 status
  product: {
    expectedStockAtArrival: 10, // 到貨前預計剩餘庫存（非目前庫存）
    maxCapacity: 500,           // 相同商品/單位的可用容量
    dailyForecast: 30,          // 每日預測銷量
    remainingShelfLifeDays: 10, // 該批到貨後剩餘可銷售天數
  },
  specialEvent: {
    date:'2026-10-20', reason:'event',
    description:'附近演唱會增加需求',extraDemand:180,
  },
});
```

`specialEvent.reason` 支援 `promotion`, `event`, `group_order`, `other`。
可不傳特殊事件或商品欄位，但不會進行缺失欄位所需的風險檢查。
商品資料不完整不代表無風險；C 組應提示「尚未完成容量/效期檢查」。
額外需求只用於效期內需求的簡化估算，**不會自動改寫 A 組建議補貨量**。

輸出：`riskLevel` (`blocked|normal|warning|high`)、`reviewStatus`
(`blocked|ready|pending_store_confirmation|pending_manager`)、`canSubmit`、
`requiresManagerApproval`、`requiresStoreConfirmation`、`issues`、`b1Issues`。

`decideB2(assessment,{actorRole,decision,reason,reviewerId})` 用於模擬確認：
- `warning`：店長或主管 `approve` 且填至少5字原因。
- `high`：主管 `approve`、提供 `reviewerId` 且填至少5字原因。
- `blocked`：不可批准。
- `reject`：拒絕訂單。
- 回傳審核紀錄與 `canSubmit`，**不會實際發出訂單**。

## 注意與限制
1. B1 的 `canProceed=true` **不是送單授權**，必須看 B2 的狀態。
2. B1 原型假設數量是整數「件」；A 允許小數。需與 A/C 組統一商品單位。
3. B2 門檻（3倍、容量、效期比率）僅為課堂原型示範，非統家實際政策。
4. 效期估算假設同一批到貨庫存的剩餘效期相同；正式系統須用批次效期、FEFO、實際需求日期。
5. 預估到貨庫存應扣除在途期間銷量；容量也可能涉及共享儲位，正式系統需更精細。
6. `decideB2` 只模擬角色和審核，**沒有身份驗證、不可竄改稽核紀錄、資料庫或後端送單**。
   C/後端應驗證登入者權限、記錄審核時間與不可竄改的操作紀錄，送單前重新以可信最新資料執行 A/B1/B2。
7. 風險模型可能出現誤判，須用測試資料校準，不能以固定倍數代表實際失誤率。

## GitHub 合作
請在 `feature/b2-risk-review` 分支新增這五個檔案；不要覆蓋 A、B1 的檔案。
先發 PR，待 B1 PR #1 合併後測試 `b2-integration.example.mjs` 再合併 B2。

## 第二版新增：特殊事件需求調整 + 審核紀錄

新增兩個純函式（保留舊版函式介面）：

- `prepareEventDemandAdjustment({productId,orderId,specialEvent,forecastStartDate,forecastEndDate,baseForecastDemand})`：驗證活動資料，判斷日期是否落在預測區間，產生 `adjustedForecastDemand` 供 A 組重新計算。**此函式不自行改寫 A 組建議補貨量，也不會直接送單。**
- `createB2AuditRecord({orderId,b1Result,assessment,reviewDecision,actorId,originalQuantity,updatedQuantity,specialEvent,timestamp})`：產生含訂單編號、數量變更、風險、審核者、理由、時間的結構化紀錄。**此函式不會自動寫入資料庫。**

建議完整流程：B2 登錄活動 → A 重新計算需求與補貨建議 → B1 重新偵測 → B2 重新評估 → 店長或主管確認 → 產生審核紀錄 → C/後端保存並進行送單前驗證。

```bash
node --test b2-risk-review.test.mjs
node b2-event-audit.example.mjs
```

**整合注意**：
- 新示範檔中的 A/B1 結果為模擬值，用來說明資料交換；正式整合必須呼叫 A、B1 真正的函式。
- 特殊活動需求只在活動日期落於 A 組提供的預測期間時納入，避免不相關活動直接提高本次訂貨量。A 組須確認原始預測是否已包含活動需求，避免重複加總。
- 審核人身分與時間在原型中由呼叫者提供，**不能作為真實身分驗證或不可竄改紀錄**。正式系統應由後端認證與保存。
- 未提供效期/容量資料時，B2 無法完成該項風險檢查；前端應清楚提示缺失，不可宣稱完全安全。
