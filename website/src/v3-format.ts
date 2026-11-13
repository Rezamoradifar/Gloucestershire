import {formatUnits} from 'ethers';

// Truncate for display, but never present a small nonzero amount as zero.
export function formatV3Amount(value:bigint,precision=6){
 if(value<0n||!Number.isInteger(precision)||precision<1||precision>18)
  throw Error('Invalid V3 test amount or precision.');
 const [whole,fraction='']=formatUnits(value,18).split('.');
 const tail=fraction.slice(0,precision).replace(/0+$/,'');
 if(value>0n&&BigInt(whole)===0n&&!tail)return '<0.'+'0'.repeat(precision-1)+'1';
 return BigInt(whole).toLocaleString('en-US')+(tail?'.'+tail:'.00');
}
