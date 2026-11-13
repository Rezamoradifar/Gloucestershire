import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../scripts/fund-v2-testnet-treasury-server.mjs',import.meta.url),'utf8');
test('server funding requires a real encrypted TESTNET signer, not an API key or fabricated balance',()=>{
 for(const required of [
  "Wallet.fromEncryptedJson(keystore,password)",
  "getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89')",
  "parseUnits('1000000',18)",
  "openVerifiedV2ReadProvider()",
  "V2_RPC_CODE_HASH",
  "await vault.fundPrincipalLiquidity(TOKEN,EXACT)",
  "parsed?.name==='PrincipalLiquidityFunded'",
  "FUND 1000000 TEST USDT"
 ]) assert.ok(source.includes(required),required);
 for(const forbidden of ['process.env.PRIVATE_KEY','process.env.MNEMONIC','eth_sendRawTransaction','MaxUint256','token.mint(','receipt.status===0?true'])
  assert.equal(source.includes(forbidden),false,forbidden);
});
test('preflight is read-only, replay guard and user command use secure local storage',()=>{
 assert.ok(source.includes("if(mode==='--check')"));
 assert.ok(source.includes("transferPerformed:false"));
 assert.ok(source.includes("if(fs.existsSync(MARKER))fail('FUNDING_INTENT_ALREADY_EXISTS_INSPECT_TX_BEFORE_RETRY')"));
 assert.ok(source.includes("{flag:'wx',mode:0o600}"));
 assert.ok(source.includes("stty',['-echo']"));
 assert.ok(source.includes("terminal:false"));
 assert.ok(source.includes("receipt=await tx.wait(3)"));
 assert.ok(source.includes("V2_TESTNET_TREASURY_FUNDED"));
});
