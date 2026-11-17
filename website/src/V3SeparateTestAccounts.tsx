import {ArrowUpRight,Info} from 'lucide-react';
import type {V3SiteReleaseConfig} from './v3-site-config';

// A presentation-only link for a separately installed unified test profile.
// The old account page must independently verify its own network and vault.
// Neither this component nor the link reads, moves or combines balances.
export const PREVIOUS_HOURLY_TEST_PATH='/hourly-test/';

export default function V3SeparateTestAccounts({config}:{config:V3SiteReleaseConfig|null}){
 if(!config?.unified)return null;
 return <section className="gv3-notice" aria-label="Separate test accounts">
  <Info size={16}/><div>
   <strong>Previous test account is separate</strong>
   <p>Positions, balances and requests on the previous hourly test contract remain separate.
    They are not automatically transferred or combined with this account.</p>
   <a href={PREVIOUS_HOURLY_TEST_PATH}>Open previous hourly test account <ArrowUpRight size={14}/></a>
   <p>Open the previous page to review its contract and account separately.</p>
  </div>
 </section>;
}
