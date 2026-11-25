# Live dropshipping activity

The Global trading desk shows Amazon Business purchase charges and paid eBay seller orders in a single feed. Open **Live trades** on the landing page or **Home** in the member dashboard. The feed checks each account about every 30 seconds while the page is visible, backing off when the provider rate-limits it. It shows up to 20 of the latest records per store from the past seven days. Volume and profit figures summarize those records by currency. Each order counts once regardless of its number of product lines. Each provider has its own connection status.

## Connect the accounts

Use the operator's existing protected environment at `/etc/globaldroptrade/trades.env` on the API host. Catalog search credentials and the connected wallet do not authorize access to an order account.

| Source | Read access | Public activity setting |
| --- | --- | --- |
| Amazon Business | `AMAZON_BUSINESS_CLIENT_ID`, `AMAZON_BUSINESS_CLIENT_SECRET`, `AMAZON_BUSINESS_REFRESH_TOKEN` with Business Purchase Reconciliation access, and `AMAZON_BUSINESS_REGION` (`na`, `eu` or `fe`) | `AMAZON_BUSINESS_PUBLIC_ACTIVITY=1` |
| eBay seller | `EBAY_SELLER_CLIENT_ID`, `EBAY_SELLER_CLIENT_SECRET`, `EBAY_SELLER_REFRESH_TOKEN` with the `sell.fulfillment.readonly` scope. The seller token can also use the catalog app's ID and secret if they belong to the same app. | `EBAY_SELLER_PUBLIC_ACTIVITY=1` |

Set `DROPSHIPPING_PUBLIC_DETAILS=1` to disclose product details and reconciled sale results for the enabled accounts. Existing activity settings by themselves disclose the transaction side, gross amount, currency and time. The public rows use opaque activity IDs. Keep account and buyer details, order IDs and access tokens on the API host.

## Identify products

Optional `COMMERCE_PRODUCT_CATALOG_FILE` points to a private JSON file outside the web root, readable by the API service. Use an exact Amazon ASIN or eBay listing ID. Include the variation ID for an eBay variation. Here is a sample record for each provider.

```json
{
  "version": 1,
  "products": [
    {"source": "amazon", "id": "B000ABC123", "model": "X2", "type": "Headphones"},
    {"source": "ebay", "id": "123456789012", "variationId": "345678901234", "model": "X2", "type": "Headphones"}
  ]
}
```

An order containing multiple products keeps one gross amount. The product list belongs to that order. Model and type use documented source fields and matched catalog metadata. Missing fields remain unavailable.

## Publish a reconciled result

Set `EBAY_SELLER_RECONCILIATION_FILE` to the path of a private settlement file readable by the API. A settlement must match the eBay order ID, last modification timestamp, currency, gross amount and refund state. Record shipping, taxes remitted or other order expenses in the appropriate cost fields, counting each expense once.

```json
{
  "version": 1,
  "orders": [{
    "orderId": "EXAMPLE-ORDER",
    "orderRevision": "2026-11-25T08:00:00.000Z",
    "currency": "USD",
    "gross": "100.00",
    "refunds": "0.00",
    "supplierCost": "63.00",
    "fees": "7.00",
    "otherCosts": "2.00"
  }]
}
```

In this example the order earned USD 28 on USD 100 of net sales, a 28% margin. Net sales equal gross receipts less refunds. Net profit deducts supplier cost, fees and other expenses from net sales. The order result can be a loss or zero. The detailed feed labels partially and fully refunded sales that have not been canceled. A full refund can leave an order with a loss and zero net sales, which makes a percentage margin undefined. A missing or outdated settlement keeps the profit pending. A purchase charge alone has no sale margin.

## Check the installation

Restart `globaldroptrade-api` after editing its protected environment. Check both account routes on the domain.

```bash
curl -fsS 'https://globaldroptrade.com/api/commerce/activity?source=amazon'
curl -fsS 'https://globaldroptrade.com/api/commerce/activity?source=ebay'
```

`connected` means the provider responded for that account. An empty connected feed means it returned no qualifying rows in the displayed window. `partial`, `rate_limited`, `unavailable` and `not_configured` describe the individual source. The separate 30-day seller summary uses `EBAY_SELLER_PUBLIC_SUMMARY` and `EBAY_SELLER_PUBLIC_PERFORMANCE`. Commerce activity is read-only and independent of the BNB testnet account ledger.
