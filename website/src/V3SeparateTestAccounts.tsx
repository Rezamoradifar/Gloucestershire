import {ArrowUpRight} from 'lucide-react';
import type {V3SiteReleaseConfig} from './v3-site-config';

// A presentation-only link for a separately installed unified test profile.
// The old account page must independently verify its own network and vault.
// Neither this component nor the link reads, moves or combines balances.
export const PREVIOUS_HOURLY_TEST_PATH='/hourly-test/';

export default function V3SeparateTestAccounts({config}:{config:V3SiteReleaseConfig|null}){
 if(!config?.unified)return null;
 const singleCapital=config.unified.singleCapital===true;
 const previousSingle=config.unified.dailyPlan||config.unified.baseProfitReferrals;
 const primary=singleCapital&&import.meta.env.VITE_V3_UNIFIED_PRIMARY==='single-capital-testnet';
 return <details className="gv3-account-archive">
  <summary>Previous test accounts</summary>
  <p>Positions, balances and requests stay on their original contracts.</p>
  <a href={previousSingle?'/single-capital-test/':singleCapital?'/unified-test/':PREVIOUS_HOURLY_TEST_PATH}>Previous {previousSingle?'single-capital':singleCapital?'unified':'hourly'} account <ArrowUpRight size={14} aria-hidden="true"/></a>
  {primary&&<a href="/previous-hourly-test/">Earlier hourly records <ArrowUpRight size={14} aria-hidden="true"/></a>}
 </details>;
}
