// Columns count permanent uplines, starting with the direct referrer.
// Version 5 selects the row from each recipient's principal; earlier releases use the earner's.
export const REFERRAL_BPS=[
 [800n,400n,200n,0n],
 [1000n,500n,300n,0n],
 [1200n,600n,400n,0n],
 [1400n,700n,500n,0n],
 [1600n,800n,600n,400n]
] as const;
