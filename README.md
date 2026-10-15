# EOS 電子補貨專題：A 組（A1 補貨、A2 預測）

## A 組目標

以歷史銷售估計下一補貨期間需求，結合庫存與安全庫存計算建議補貨量。輸出是建議數量；計算模組不建立正式訂單。

## A2：銷售資料與需求預測

`sales_data.json` 每筆紀錄包含日期、商品編號、品名、銷量、假日／促銷旗標及活動說明。

`getHistorySales(salesData, productId, days = 3)` 會依商品篩選紀錄、按日期排序，取最近三筆有資料的銷量。資料缺少某日期時不補零，也不推測該日銷量。特殊活動日的銷量保留在歷史資料中，會參與平均；目前 P002 的活動日 150 件因此會納入最近紀錄。

`predictDemand` 以最近最多三筆觀測值計算簡單平均，作為下一補貨期間的基礎需求。原型規則如下：

- 假日：基礎需求乘以 1.2。
- 促銷：再乘以 1.3；假日與促銷同時發生時兩個倍率相乘。
- 已知未來特殊活動需求：由 `specialDemand` 傳入，並加在加權後的基礎需求上。
- 基礎需求加權後先四捨五入，再加上 specialDemand。

這些是 A 組目前採用的原型假設；銷售資料日期不連續，因此「最近三筆」不保證涵蓋連續三天。預測資料輸出格式為：

```js
{ productId, forecastDemand }
```

使用方式：

```js
const forecast = predictDemandFromSalesData({
  salesData,
  productId: "P001",
  isHoliday: true,
});
```

其中 `salesData` 是解析後的 `sales_data.json` 陣列。呼叫端要傳入預測期間的假日／促銷狀態及已知特殊需求。

## A1：補貨計算

輸入欄位：

| 欄位 | 說明 |
| --- | --- |
| `productId` | 商品識別碼 |
| `forecastDemand` | A2 提供的下一補貨期間預測需求 |
| `safetyStock` | 商品設定的安全庫存數量，必須由呼叫端提供 |
| `onHand` | 目前可用庫存 |
| `onOrder` | 已訂購且尚未到貨數量，預設 0 |
| `backorders` | 尚未滿足的需求數量，預設 0 |
| `minimumOrderQuantity` | 已確認適用時提供最低訂購量，預設 0 |
| `orderMultiple` | 已確認適用時提供訂購倍數，預設 1 |

計算公式：

```text
inventoryPosition = onHand + onOrder - backorders
targetStock = forecastDemand + safetyStock
unconstrainedQuantity = max(0, targetStock - inventoryPosition)
suggestedQuantity = 0, 若 unconstrainedQuantity 為 0
                  = 將 max(unconstrainedQuantity, minimumOrderQuantity)
                    向上取整至 orderMultiple 的倍數，否則
```

`safetyStock` 是商品設定輸入，A1 函式不會自行推算。測試中的安全庫存與庫存數字是模擬值，不代表企業正式設定。所有數量必須是有限且非負的數值；缺少或無效的必要輸入會回報錯誤。

A1+A2 的串接方式：

```js
const forecast = predictDemandFromSalesData({
  salesData,
  productId: "P001",
  isHoliday: true,
});

const suggestion = calculateReorderQuantity({
  ...forecast,
  safetyStock: 10,
  onHand: 20,
});
```

上例的 `safetyStock` 和 `onHand` 僅為測試值。結果包含 `inventoryPosition`、`forecastDemand`、`safetyStock`、`suggestedQuantity` 及 `needsReplenishment`。

## 執行測試

在專案根目錄執行：

```powershell
node --test forecast.test.mjs replenishment.test.mjs
```

測試涵蓋預測、特殊日期加權、特殊需求、讀取模擬銷售資料、輸入驗證、補貨量計算及 A1/A2 串接。

## A 組交付範圍與限制

A 組交付 A2 預測模組、模擬銷售資料、A1 補貨計算模組、A1/A2 串接測試及本文件。現有資料和庫存數字用於專題模擬；專案目前沒有正式商品庫存資料庫或企業 API。

本專案以統家企業 EOS 為題，目標是根據銷售預測與門市庫存提供補貨建議，協助店長確認訂購數量。本版本目前包含 A1 補貨計算與 A2 需求預測的模擬模組及測試；正式介面、資料庫與訂單流程尚未包含。

## C 組：店長操作介面

整合 A、B1、B2 的網頁系統與教學影片腳本，請見 [README-C.md](README-C.md)。

```bash
npm start   # 開啟 http://localhost:3000/app/
npm test    # 執行全部測試
```
