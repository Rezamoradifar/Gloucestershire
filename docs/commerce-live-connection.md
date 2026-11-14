# Commerce connection status

The marketplace component can show Amazon and eBay catalog listings when their
existing server-side catalog integrations are configured. Links lead to the
retailer; this site does not place an order or purchase products. Catalog
availability does not establish a working seller, supplier, or profit feed.

The optional eBay seller adapter reads an authorized seller's orders over the
last 30 days with the `sell.fulfillment.readonly` user OAuth scope. It publishes
only a paid-order count, and only when the operator explicitly opts in to a
public aggregate. It never publishes order IDs, buyer details, or credentials.
Orders may later be refunded or changed. The adapter does not create sales,
make purchases, place orders, transfer funds, or determine a commercial profit.

To enable the optional seller aggregate, the operator must use their own eBay
developer app and authorize their seller account for the read-only scope. Set
the following values **only in the existing protected server environment**:
`EBAY_SELLER_CLIENT_ID`, `EBAY_SELLER_CLIENT_SECRET`, and
`EBAY_SELLER_REFRESH_TOKEN`. Set `EBAY_SELLER_PUBLIC_SUMMARY=1` only when the
operator authorizes public disclosure of the aggregate. The seller credentials
can fall back to the existing eBay catalog app's client ID and secret if the
seller token belongs to that same app. Restart the API under the operator's
normal deployment procedure; never commit secrets or paste them into chat.

The status endpoint returns `not_configured` until the explicit opt-in and all
credentials are present. It returns `unavailable`, `rate_limited`, or
`incomplete` rather than displaying stale or partial order counts when the
source cannot be verified. A working count is not a verified profit figure.
Verified profit requires reconciled sales, supplier acquisition costs, shipping,
fees, refunds, and other relevant expenses. The source and rules for these
records are not yet connected.

This release retains the separate BNB Testnet and mock-token restrictions. The
commercial adapter is not connected to deposits or the testnet contract.
