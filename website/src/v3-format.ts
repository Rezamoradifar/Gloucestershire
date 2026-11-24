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

// Ratios use integer units throughout; unavailable denominators have no percentage.
export function formatShare(part:bigint,base:bigint){
 if(base<=0n)return '—';
 const negative=part<0n,absolute=negative?-part:part;
 const bps=(absolute*10000n+base/2n)/base;
 if(absolute>0n&&bps===0n)return negative?'−<0.01%':'<0.01%';
 const decimals=(bps%100n).toString().padStart(2,'0').replace(/0+$/,'');
 return (negative?'−':'')+(bps/100n).toLocaleString('en-US')+(decimals?'.'+decimals:'')+'%';
}
