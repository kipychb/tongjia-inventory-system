# EOS A1 replenishment calculation

This workspace had no existing application source, backend, database schema,
API, package configuration, or tests when this module was added. The files here
provide an isolated A1 calculation contract; they do not represent a complete
EOS application or create and submit orders.

## Formula

```text
inventoryPosition = onHand + onOrder - backorders
targetStock = forecastDemand + safetyStock
unconstrainedQuantity = max(0, targetStock - inventoryPosition)
suggestedQuantity = 0, if unconstrainedQuantity is 0
                  = round up max(unconstrainedQuantity, minimumOrderQuantity)
                    to an orderMultiple, otherwise
```

`forecastDemand` and `safetyStock` must already be calculated for the period
that the store is replenishing. The module does not forecast demand or derive
safety stock. `onOrder` and `backorders` default to zero; `minimumOrderQuantity`
defaults to zero; `orderMultiple` defaults to one. Configure order constraints
only when the team has confirmed them. All numeric inputs must be finite and
nonnegative, and `orderMultiple` must be greater than zero. Stock quantities
can be fractional because the project has not specified unit/rounding rules.

## Contract

Import `calculateReorderQuantity` from `replenishment.mjs` and pass an object:

```js
{
  productId,              // required identifier
  forecastDemand,         // required, A2-provided, period-aligned number
  safetyStock,            // required, number supplied by agreed policy
  onHand,                 // required, currently available stock
  onOrder,                // optional, outstanding order quantity
  backorders,             // optional, unfilled demand
  minimumOrderQuantity,    // optional, confirmed product constraint
  orderMultiple           // optional, confirmed pack/order multiple
}
```

The result includes `productId`, `inventoryPosition`, `forecastDemand`,
`safetyStock`, `targetStock`, `unconstrainedQuantity`, `suggestedQuantity`,
and `needsReplenishment`. Invalid or missing numeric inputs throw a `TypeError`
or `RangeError`; callers should surface these as data errors instead of
silently using a quantity. An unusually large valid suggestion is still
returned for the store manager and the agreed B-group risk review process.

## Run the tests

Requires Node.js with the built-in `node:test` runner:

```sh
node --test replenishment.test.mjs
```

## Confirm before integration

The group still needs to agree on the review cycle and delivery lead time,
forecast coverage period with A2, safety-stock policy, whether backorders are
tracked, inventory availability semantics, unit precision, and any minimum
order, case-pack, shelf-life, or capacity constraints. C should connect this
pure function to the existing manager-confirmation/order flow once that flow is
available. B owns abnormal-order risk handling; this module only returns a
calculation and never blocks or submits a special order.
