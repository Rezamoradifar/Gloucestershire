# Plan-based earnings withdrawals on testnet

The active V7 portfolio contract uses one 10% earnings cap per request. V8 uses the same earnings sources, payout queue, principal rules and fees, and looks up the member's rate for each new request. Each capital tier starts at 10%. A change to the table applies to future requests.

The V8 site is published separately at `/plan-portfolio-test/`. It uses its own vault and ledger. Existing V7 members continue to use their original account at the main site. Deposits and pending withdrawals do not transfer to V8.

To update the current V7 main site, use the pinned release launcher with `--portfolio --primary-with-commerce`. To provision the separate V8 testnet vault and its site, use the same launcher with `--plan-portfolio --deploy-testnet`. V8 requires its own deployment proof and keeper. The launcher reports when the keeper needs test gas. Subsequent V8 site updates can use `--plan-portfolio` with that proof. The V8 profile supports isolated publication only.

## Review a schedule

Use a JSON object containing the five approved percentages, keyed by `Starter`, `Basic`, `Growth`, `Pro` and `VIP`. Supply each percentage between 0 and 100 with at most two decimal places. For example, a value of `10` means 10%. Zero prevents new earnings requests at that tier. The basis is the member's total deposits plus completed reinvestments. The actual available earnings can be less than this cap. The form's 25%, 50%, 75% and 100% buttons select a fraction of the currently eligible amount.

After deployment, run the following in the matching release checkout. Use the public address of an administrator of the V8 vault.

```sh
node scripts/prepare-v3-plan-rates.mjs "$ADMIN_ADDRESS" /path/to/approved-rates.json
```

The command verifies the chain-97 deployment from `/var/lib/globaldroptrade/v3-plan-portfolio-testnet/deployment-proof.json`, reads all five current rates at one confirmed block and simulates the complete update. The output identifies each tier's current and approved basis points. If the table changes, review the unsigned transaction in the output, verify its chain, destination, value and all five rates in the administrator's wallet, and submit it there. Rerunning the command after confirmation returns the updated rates and a null transaction when there is no change.
