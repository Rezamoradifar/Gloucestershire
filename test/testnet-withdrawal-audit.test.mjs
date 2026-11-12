import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {statusName,summarizeQueueAudit} from '../scripts/testnet-withdrawal-audit.mjs';
const source=readFileSync('scripts/testnet-withdrawal-audit.mjs','utf8');
test('withdrawal status distinguishes approved, actually marked paid and cancelled',()=>{
 assert.equal(statusName(0n),'pending');
 assert.equal(statusName(1n),'paid');
 assert.equal(statusName(2n),'cancelled');
 assert.equal(statusName(3n),'approved');
 assert.throws(()=>statusName(4n),/STATUS_INVALID/);
});
test('withdrawal audit does not pretend excess cash guarantees unreserved user claims',()=>{
 const report=summarizeQueueAudit({cash:1000n,pending:200n,principal:900n,profit:400n,rewards:300n,feeReserve:100n,decimals:2});
 assert.equal(report.vaultCash,'10.0');
 assert.equal(report.queuedProfitLiability,'2.0');
 assert.equal(report.queuedProfitCoveredByCurrentCash,true);
 assert.equal(report.allLiabilitiesCovered,null);
 assert.equal(report.ledgerPrincipal,'9.0');
 assert.match(report.note,/does not guarantee/);
 const insufficient=summarizeQueueAudit({cash:20n,pending:40n,principal:90n,profit:80n,rewards:0n,feeReserve:0n,decimals:2});
 assert.equal(insufficient.queuedProfitCoveredByCurrentCash,false);
 assert.throws(()=>summarizeQueueAudit({cash:-1n,pending:1n,principal:0n,profit:0n,rewards:0n,feeReserve:0n}),/ACCOUNTING_REQUIRED/);
});
test('audit executes read-only, pins chain and checks canonical block',()=>{
 assert.equal(spawnSync(process.execPath,['--check','scripts/testnet-withdrawal-audit.mjs'],{encoding:'utf8'}).status,0);
 assert.match(source,/eth_chainId/);
 assert.match(source,/queue\.vault\(options\)/);
 assert.match(source,/WITHDRAWAL_AUDIT_REORG/);
 assert.match(source,/transactionsSent:0/);
 for(const prohibited of ['new Wallet(','signTransaction','sendTransaction','broadcastTransaction','eth_sendRawTransaction','writeFileSync','fs.rmSync('])
  assert.equal(source.includes(prohibited),false,prohibited);
});
