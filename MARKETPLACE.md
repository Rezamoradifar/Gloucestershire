# Global Drop Trade: dimensional commerce update

Base: `7f2723ba48a7e48aa6da5314c4073d3eb658c809`.

The existing black/gold landing gains perspective tilt, layered hero depth, floating motion, a motion pause control, and a responsive marketplace section. No 3D product reconstruction is claimed: product pictures remain the retailer's 2D assets. Motion respects reduced-motion preferences and pointer capabilities.

## What is connected in code

- Amazon Creators API (US, NA credential version 3.1): OAuth client credentials, SearchItems, original affiliate item URLs, prices/conditions/images. No legacy PA-API or scraping.
- eBay Browse API (US): OAuth client credentials, search, retailer-side relevance or ascending-price sort, product price and original item URL.
- GET `/api/marketplace?q=headphones&provider=all&sort=relevance` (`provider`: all/amazon/ebay; `sort`: relevance/price).
- Credentials remain server-side. Request timeouts, token caching, single-flight requests, bounded 60-second result cache, 429 backoff, one search per provider per 1.1 seconds and an in-memory daily request guard are included. A process restart resets the local guard: use provider-side quotas for hard limits.
- The UI fetches on visibility and refreshes once per minute while visible. Failures and missing credentials never generate fake products, prices, orders or profits. Public links to retailer search remain usable without keys.
- The catalog is independent of the blockchain settlement feed. It is not a marketplace order ledger and cannot repair a failing RPC connection.

## Install on the existing server

Run `bash ubuntu-marketplace.sh` from this reviewed checkout as root. It reads the current chain/address from `/etc/globaldroptrade/trades.env`, builds with those public values, retains existing credentials, preserves TLS through the existing installer, backs up Nginx/service configuration, updates the API, and checks served HTML plus the catalog route. It does not use the older domain script that pins an obsolete testnet address. A failure after backup restores previous Nginx configuration and API service/release.

## Activate retailer data

Use the official portals to obtain approved production access. Enter credentials locally into `/etc/globaldroptrade/trades.env` (mode 0600), never in chat, client code or git:

```
AMAZON_CLIENT_ID=
AMAZON_CLIENT_SECRET=
AMAZON_PARTNER_TAG=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
MARKETPLACE_DAILY_LIMIT=500
```

Restart `globaldroptrade-api`. Inspect `/api/marketplace` for each provider's status. `not_configured` means keys are absent; `unavailable` includes rejected credentials/access or upstream failures; `rate_limited` means local/provider throttling. `live` requires a successful validated provider response. The code is limited to US Amazon/eBay stores; other regions require corresponding configuration and approved access.

Official APIs may have free quotas, but account eligibility and approvals still apply. No paid third-party scraper or subscription is added. No claim of a universally free, unrestricted Amazon/eBay API is made.

## Purchases, sales and validation limits

Purchases complete at the retailer using the original returned product link. Automated buying, inventory listing, seller order history and fulfillment require separate seller authorization and approved APIs; none is simulated or enabled here. No user funds or wallet transactions are touched.

Tests use mocked official API responses for both connected paths, errors, quotas and malformed URLs. Live authenticated Amazon/eBay requests cannot be verified until production credentials are installed. A successful build is not evidence of production deployment.

Official references checked 2026-10-16:
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
- https://developer.ebay.com/api-docs/buy/browse/overview.html
- https://developer.ebay.com/api-docs/buy/buy-requirements.html
