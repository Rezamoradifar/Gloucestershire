# Local auto-network prototype

**BLOCKED: DO NOT DEPLOY OR CONNECT TO A PUBLIC SITE.** This is an experimental
compile-and-test-only variant of the hourly BNB Testnet source. It has not been
deployed and is not approved for production or public testnet use.
It keeps the existing fourteen-stage schedule, eligibility, branch caps,
deposit destinations, withdrawal rules, check-in window and one-hour accrual.
The code generates a separate contract and cannot change either deployed V3
contract or automatically migrate their accounts, positions, groups or claims.

Directly referred users are assigned automatically, in the exact order their
registrations confirm on this prototype. Each successive three form a disjoint
group; a final one or two directs wait for the missing directs. Registration order
is used even if deposits or deep volume jobs are processed in another order.
Deposit auto-registration follows the same rule. Existing manual group creation
and extension methods intentionally revert on this prototype.

Groups are permanent: no branch reassignment or removal exists. If one direct
never deposits, that group can remain unable to qualify while later directs
form other groups; branch caps still apply. This is an economic consequence of
the specified pairing rule and must be disclosed and reviewed before deployment.

More seriously, registration does not require consent from the referrer and a
new wallet can register with zero deposit. An attacker can therefore create
three wallets naming any registered user as referrer, occupy that user's next
permanent group, and push legitimate later referrals into other groups. This is
demonstrated by an adversarial local EVM test. Automatic permanent assignment
must not be deployed until a separately approved design resolves unwanted or
malicious registrations. Possible directions include referrer authorization or
reversible owner-controlled grouping, each with material product consequences.

Automatic stage recording is enabled on registration by default, and a user can
sign `setAutoNetworkEnabled(false)` to stop new third-party claims. That toggle
does not disable automatic pairing on new registrations.
While enabled, anyone may register an eligible stage exclusively for the
beneficiary, with preparation and claim in one atomic transaction. Eligibility,
stage and group checks, bounded steps, consumed
volume accounting and existing events remain in the contract. The caller cannot
choose a payment recipient or transfer a token.

An incomplete permissionless claim reverts the entire transaction, without
reserving volume. The existing owner-initiated preparation function is retained;
its earlier partial reservations cannot be undone by toggling automation.

This prototype does not include a keeper, frontend, installer, migration or
testnet release. It requires separate design
review, replay/eligibility/adversarial testing, explicit plan confirmation,
gas-budget design and independent security/economic review. Claims are unfunded
test liabilities, not proof of sales profit or wallet payments.
