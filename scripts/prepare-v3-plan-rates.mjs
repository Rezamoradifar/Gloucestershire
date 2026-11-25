import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Contract, ZeroHash, getAddress} from 'ethers';
import {recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {verifyUnifiedRelease} from './verify-v3-unified-release.mjs';
import {withUnifiedReadRpc} from './v3-unified-verification-rpc.mjs';
import {PLAN_PORTFOLIO_PROFILE, UNIFIED_DEPLOYER} from './v3-unified-release-pins.mjs';

const tiers = ['Starter', 'Basic', 'Growth', 'Pro', 'VIP'];
const defaultProof = '/var/lib/globaldroptrade/v3-plan-portfolio-testnet/deployment-proof.json';
const abi = [
  'function planWithdrawalBps(uint256 tier) view returns (uint16)',
  'function setPlanWithdrawalBps(uint16[5] rates)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];

export function parsePlanRates(schedule) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule) ||
      Object.keys(schedule).length !== tiers.length || tiers.some(tier => !Object.hasOwn(schedule, tier))) {
    throw Error('Provide one approved percentage each for Starter, Basic, Growth, Pro and VIP.');
  }
  return tiers.map(tier => {
    const percent = schedule[tier];
    const match = (typeof percent === 'number' || typeof percent === 'string') &&
      /^(0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/.exec(String(percent));
    if (!match) throw Error('Invalid percentage for '+tier);
    const bps = Number(match[1])*100 + Number((match[2] ?? '').padEnd(2, '0'));
    if (bps > 10000) throw Error('Percentage exceeds 100% for '+tier);
    return bps;
  });
}

async function main([admin, file, proofFile = defaultProof, ...extra]) {
  if (!file || extra.length) throw Error('Usage: node scripts/prepare-v3-plan-rates.mjs ADMIN_ADDRESS SCHEDULE_JSON [V8_PROOF_JSON]');
  const from = getAddress(admin);
  const schedule = parsePlanRates(JSON.parse(await readFile(file, 'utf8')));
  const raw = JSON.parse(await readFile(proofFile, 'utf8'));
  if (raw.status !== PLAN_PORTFOLIO_PROFILE.status) throw Error('A verified V8 plan portfolio deployment is required.');
  const result = await withUnifiedReadRpc('https://bsc-testnet-rpc.publicnode.com', 'plan-rates', async provider => {
    const {proof, block} = await verifyUnifiedRelease(provider, raw, UNIFIED_DEPLOYER, PLAN_PORTFOLIO_PROFILE);
    const vault = new Contract(proof.vault, abi, provider);
    const at = {blockTag:block.number};
    if (!await vault.hasRole(ZeroHash, from, at)) throw Error('The supplied account lacks the vault admin role.');
    const previous = await Promise.all(tiers.map((_, index) => vault.planWithdrawalBps(index, at)));
    await vault.setPlanWithdrawalBps.staticCall(schedule, {...at, from});
    await recheckUnifiedBlock(provider, block);
    const changed = previous.some((value, index) => Number(value) !== schedule[index]);
    return {
      chainId:97, verifiedBlock:block.number, vault:proof.vault, admin:from,
      rates:tiers.map((tier, index) => ({tier, currentBps:Number(previous[index]), approvedBps:schedule[index]})),
      unsignedTransaction:changed ? {from, to:proof.vault, chainId:97, value:'0x0',
        data:vault.interface.encodeFunctionData('setPlanWithdrawalBps', [schedule])} : null,
    };
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
