import {parseUnits,formatUnits} from 'ethers';
export function normalizeAmount(value:string){return value.trim().replace(/[۰-۹]/g,x=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace('٫','.');}
export function parseAmount(value:string,decimals:number){const v=normalizeAmount(value);if(!/^\d+(\.\d+)?$/.test(v))throw Error('Enter a positive decimal amount without thousands separators.');const amount=parseUnits(v,decimals);if(amount<=0n)throw Error('The amount must be greater than zero.');return amount;}
export function displayAmount(value:bigint|undefined,decimals=18,precision=5){if(value===undefined)return '—';const [a,b='']=formatUnits(value,decimals).split('.');const f=b.slice(0,precision).replace(/0+$/,'');if(value>0n && a==='0' && !f)return '< '+(10**(-precision)).toFixed(precision);return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(f?'.'+f:'');}
export const feeOf=(amount:bigint,bps:bigint)=>amount*bps/10000n;
export const withdrawalCap=(external:bigint)=>external/10n;
