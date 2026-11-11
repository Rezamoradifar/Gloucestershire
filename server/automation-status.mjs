import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {getAddress} from 'ethers';

const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(value);

// Only this allowlist reaches the public API. Never return the source document,
// RPC diagnostics, private journal, signed bytes, user addresses or credentials.
export function summarizeAutomation(value, {chainId, vaultAddress, now = Date.now(), maxAgeMs = 900000}) {
  const unavailable = {version: 1, status: 'unavailable', chainId, vaultAddress,
    checkedAt: null, fresh: false, schedulerActive: false, dailyStatus: null,
    nextEpoch: null, nextDueAt: null, lastCredit: null, confirmedTransactions: [],
    blockers: ['AUTOMATION_STATUS_UNAVAILABLE']};
  if (!value || typeof value !== 'object') return unavailable;
  const report = value.automation && typeof value.automation === 'object' ? value.automation : value;
  const target = report.target ?? value.target;
  try {
    if (Number(report.chainId ?? value.chainId) !== chainId || getAddress(target) !== getAddress(vaultAddress)) return unavailable;
  } catch { return unavailable; }
  const checkedAt = report.checkedAt ?? value.checkedAt;
  const timestamp = typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 60000) return unavailable;
  const fresh = now - timestamp <= maxAgeMs;
  const blockers = [...new Set([...(Array.isArray(value.blockers) ? value.blockers : []),
    ...(Array.isArray(report.blockers) ? report.blockers : []),
    ...(Array.isArray(report.errors) ? report.errors : [])].filter(code))].slice(0,40);
  if (!fresh) blockers.push('AUTOMATION_STATUS_STALE');
  const schedulerActive = value.timerActive === true || value.scheduling?.active === true;
  if (!schedulerActive) blockers.push('AUTOMATION_SCHEDULER_NOT_CONFIRMED');
  const current = Array.isArray(report.dailyCredits) ? report.dailyCredits : [];
  const confirmedTransactions = [...new Set(current.filter(row => row?.status === 'credited' && hash(row.transactionHash)).map(row => row.transactionHash))];
  const saved = report.lastDailyCredit;
  const batches = Array.isArray(saved?.batches) ? saved.batches.filter(row => hash(row?.transactionHash) && hash(row?.blockHash) && count(row.block) !== null)
    .slice(0,100).map(row => ({transactionHash: row.transactionHash, block: row.block, blockHash: row.blockHash})) : [];
  const lastCredit = count(saved?.epoch) !== null && batches.length ? {epoch: saved.epoch, batches} : null;
  const dailyStatus = ['ready','not_due','indexing','waiting','scheduled'].includes(report.dailyStatus) ? report.dailyStatus : null;
  const progress=report.indexProgress;
  const indexProgress=progress&&typeof progress==='object'&&!Array.isArray(progress)?{
    memberThrough:count(progress.memberThrough),positionThrough:count(progress.positionThrough),target:count(progress.target),
    memberCount:count(progress.memberCount),positionCount:count(progress.positionCount)
  }:null;
  return {version: 1, status: !fresh ? 'stale' : blockers.length ? 'waiting' : confirmedTransactions.length ? 'credited' : 'running',
    chainId, vaultAddress, checkedAt, fresh, schedulerActive, dailyStatus,
    nextEpoch: count(report.nextEpoch), nextDueAt: count(report.positionSchedule?.nextDueAt ?? report.nextPeriodEndsAt),
    activityRequiredFrom: count(report.activity?.activationTimestamp),
    lastCredit, lastCreditBlockTimestamp:lastCredit&&count(report.lastCreditBlockTimestamp)!==null&&report.lastCreditBlockTimestamp>0&&report.lastCreditBlockTimestamp<=Math.floor(now/1000)+60?report.lastCreditBlockTimestamp:null,
    confirmedTransactions, indexProgress, blockers: [...new Set(blockers)]};
}

export function createAutomationStatusReader({file = '/var/www/globaldroptrade/automation-data/activation.json', chainId, vaultAddress, now = Date.now} = {}) {
  return async () => {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.size > 2097152) throw Error('Invalid status file');
      return summarizeAutomation(JSON.parse(await handle.readFile('utf8')), {chainId, vaultAddress, now: now()});
    } catch { return summarizeAutomation(null, {chainId, vaultAddress, now: now()}); }
    finally { await handle?.close(); }
  };
}
