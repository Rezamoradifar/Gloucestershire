import{describe,it,expect}from'vitest';
import{parseAmount,feeOf,withdrawalCap,displayAmount}from'../src/money';
describe('Exact asset accounting',()=>{
 it('parses Persian and Arabic decimals without floating point',()=>{expect(parseAmount('\u06f1\u06f2\u06f3\u066b\u06f4\u06f5',6)).toBe(123450000n);expect(parseAmount('\u0661\u0662.\u0665',18)).toBe(12500000000000000000n);});
 it('rejects negative, zero, exponent and excess precision',()=>{for(const v of ['0','-1','1e18','1,000','0.0000001'])expect(()=>parseAmount(v,6)).toThrow();});
 it('preserves values beyond Number precision',()=>expect(parseAmount('9007199254740993.000001',6)).toBe(9007199254740993000001n));
 it('matches contract fee rounding and gross profit cap',()=>{expect(feeOf(1001n,1000n)).toBe(100n);expect(withdrawalCap(10009n)).toBe(1000n);});
 it('does not show missing balance as zero or tiny amount as zero',()=>{expect(displayAmount(undefined)).toBe('—');expect(displayAmount(1n,18)).toContain('<');});
});
