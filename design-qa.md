# Design QA: Global V1-style dashboard on V3

final result: blocked

The layout follows the historical Global user-dashboard preview: a left
workspace sidebar, account overview, three asset cards, a capital-management
panel, and a plan card. The current V3 testnet provides the account data and
actions. The digital cycle timer and the distinction between estimates and
recorded claims remain in place.

Rendered desktop and mobile comparison is blocked: the available browser's
security policy rejected the local preview URL, and local headless Chromium
could not create a socket in this environment. Therefore, no visual match or
responsive browser inspection has been verified. Static component tests and
the production build do not replace this inspection.

Intentional differences from the historical image include V3 testnet labels,
mock test-token support, the current contract's actual operations, and its
payment and eligibility disclosures. No retired contract or account data is
connected to this dashboard.
