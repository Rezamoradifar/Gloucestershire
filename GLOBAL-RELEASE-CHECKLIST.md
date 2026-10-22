# GlobalDropTrade — UI and financial verification plan

Branch: feature/global-theme-brand-20261021

## Theme and identity
- Provide dark (black/gold) and light (ivory/navy/gold) themes.
- Persist explicit user choice in localStorage, with system preference fallback.
- Accessible contrast, visible keyboard focus and reduced-motion support.
- Identity concept: geometric globe + connected trade arrows; avoid implying bank guarantees.

## Financial release gates (BNB Chain ID 56)
1. Identify the actual deployed vault address and compare verified bytecode and ABI to the repository.
2. Read BNB and USDT vault balances, owner permissions, reserve liabilities, outstanding principal and allocated profits.
3. Run tests for daily accrual boundary, skipped days, precision, double-claim, cooldown, funding shortage, and failed transfers.
4. Run reinvest tests for positive sub-dollar amounts, one-time profit consumption, cap changes, position lock and asset separation.
5. Reconcile each authorized payout against a successful on-chain receipt and event, and verify destination and amount.
6. Do not enable automatic daily yields unless a funded, audited contract implementation and documented yield source exist.

This document is a plan, not a deployed feature or evidence of successful payouts.
