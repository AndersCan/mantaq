# checkout

Starts in `basicInfo`.

## States

### `basicInfo` (start)

- `submitBasicInfo` → `shippingAddress`

Ignores `back`, `submitPayment`, `submitShipping`.

### `error`

- `back` → `payment`

Ignores `submitBasicInfo`, `submitPayment`, `submitShipping`.

### `payment`

- `back` → `shippingAddress`
- `submitPayment` → `submitting`

Ignores `submitBasicInfo`, `submitShipping`.

### `shippingAddress`

- `back` → `basicInfo`
- `submitShipping` → `payment`

Ignores `submitBasicInfo`, `submitPayment`.

### `submitting`

On entry runs `chargeCard`, which sends `paymentOk`, `paymentFail` or `paymentTimeout`.

- `paymentFail` → `error` (sent by `chargeCard`)
- `paymentOk` → `success` (sent by `chargeCard`)
- `paymentTimeout` → `error` (sent by `chargeCard`)

Ignores `back`, `submitBasicInfo`, `submitPayment`, `submitShipping`.

### `success` (final)

Final: takes no events.

## Events

- `back`
- `paymentFail` with `reason: string` (internal)
- `paymentOk` with `orderId: string` (internal)
- `paymentTimeout` (internal)
- `submitBasicInfo` with `email: string`, `name: string`
- `submitPayment` with `cardNumber: string`
- `submitShipping` with `street: string`, `city: string`, `zip: string`
