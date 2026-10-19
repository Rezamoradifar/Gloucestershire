import {parseUnits,formatUnits} from 'ethers';
export function normalizeAmount(value:string){return value.trim().replace(/[\u06f0-\u06f9]/g,x=>String('\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9'.indexOf(x))).replace(/[\u0660-\u0669]/g,x=>String('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(x))).replace('\u066b','.');}
export function parseAmount(value:string,decimals:number){const v=normalizeAmount(value);if(!/^\d+(\.\d+)?$/.test(v))throw Error('Enter a positive decimal amount without thousands separators.');const amount=parseUnits(v,decimals);if(amount<=0n)throw Error('The amount must be greater than zero.');return amount;}
export function displayAmount(value:bigint|undefined,decimals=18,precision=5){if(value===undefined)return '—';const [a,b='']=formatUnits(value,decimals).split('.');const f=b.slice(0,precision).replace(/0+$/,'');if(value>0n && a==='0' && !f)return '< '+(10**(-precision)).toFixed(precision);return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(f?'.'+f:'');}
export const feeOf=(amount:bigint,bps:bigint)=>amount*bps/10000n;
export const withdrawalCap=(external:bigint)=>external/10n;
