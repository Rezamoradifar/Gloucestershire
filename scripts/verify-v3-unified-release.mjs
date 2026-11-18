import {getAddress, getCreateAddress, keccak256} from 'ethers';
import {verifyUnifiedDeployment, recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {
 UNIFIED_TOKEN_RUNTIME_HASH, UNIFIED_INITCODE_HASH, UNIFIED_DEPLOYER,
 UNIFIED_MANAGER, UNIFIED_FEE_RECEIVER
} from './v3-unified-release-pins.mjs';

// Reconstruct the transaction identity from public chain data. A hash calculated
// from an unchecked local proof is insufficient to identify this release.
export async function verifyUnifiedRelease(provider, rawProof, expectedDeployer = UNIFIED_DEPLOYER) {
 const checked = await verifyUnifiedDeployment(provider, rawProof);
 const {proof, block, vault} = checked;
 if (proof.initcodeHash !== UNIFIED_INITCODE_HASH || proof.tokenRuntimeHash !== UNIFIED_TOKEN_RUNTIME_HASH ||
     proof.manager !== UNIFIED_MANAGER || proof.feeReceiver !== UNIFIED_FEE_RECEIVER) {
  throw Error('UNIFIED_RELEASE_PIN_MISMATCH');
 }
 const [tx, tokenCode] = await Promise.all([
  provider.getTransaction(proof.deploymentTx), provider.getCode(proof.token, block.number)
 ]);
 if (!tx || tx.hash.toLowerCase() !== proof.deploymentTx || tx.from !== getAddress(expectedDeployer) ||
     tx.to !== null || tx.value !== 0n || tx.chainId !== 97n || tx.blockNumber !== proof.deploymentBlock ||
     getCreateAddress({from:tx.from,nonce:tx.nonce}) !== proof.vault ||
     keccak256(tx.data) !== UNIFIED_INITCODE_HASH || keccak256(tokenCode) !== UNIFIED_TOKEN_RUNTIME_HASH) {
  throw Error('UNIFIED_RELEASE_CREATION_MISMATCH');
 }
 const at={blockTag:block.number};
 const roles=await Promise.all([vault.DEFAULT_ADMIN_ROLE(at),vault.MANAGER_ROLE(at),
  vault.FUNDER_ROLE(at),vault.GUARDIAN_ROLE(at)]);
 for (const role of roles) {
  const [manager, gasSigner]=await Promise.all([
   vault.hasRole(role,proof.manager,at),vault.hasRole(role,expectedDeployer,at)
  ]);
  if (!manager || gasSigner) throw Error('UNIFIED_RELEASE_ROLE_MISMATCH');
 }
 await recheckUnifiedBlock(provider,block);
 return checked;
}
