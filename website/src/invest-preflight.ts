import {MaxUint256,ZeroAddress,formatUnits,getAddress,isAddress,type Contract} from 'ethers';

export type InvestmentKind='deposit'|'reinvest';
export type InvestmentReview={kind:InvestmentKind;who:string;asset:string;amount:bigint;decimals:number;referrer?:string;noReferrerAcknowledged?:boolean};

// Read current contract rules before requesting a token allowance. The final
// transaction is still simulated after approval and remains authoritative.
export async function checkInvestmentRequirements(vault:Contract,review:InvestmentReview){
 if(review.amount<=0n||review.amount>MaxUint256)throw Error('Enter a positive investment amount within the supported token range.');
 if(await vault.paused())throw Error('New investments are paused by the contract. Try again after the administrator resumes deposits.');
 const token=getAddress(await vault.usdt());
 if(!isAddress(review.asset)||![ZeroAddress,token].includes(getAddress(review.asset)))throw Error('The selected asset is not supported by this contract. Refresh your account.');
 const decimals=review.asset===ZeroAddress?18:Number(await vault.tokenDecimals());
 if(!Number.isInteger(review.decimals)||review.decimals!==decimals)throw Error('The token precision does not match the contract. Refresh your account before investing.');
 const user=await vault.users(review.who);
 let referrer=user.registered?getAddress(user.referrer):(review.referrer?.trim()||ZeroAddress);
 if(review.kind==='deposit'&&!user.registered){
  if(!isAddress(referrer))throw Error('Enter a valid referrer address.');
  referrer=getAddress(referrer);
  if(referrer===getAddress(review.who))throw Error('Your wallet cannot be its own referrer. Enter an already registered referrer.');
  if(referrer===ZeroAddress){
   if(!review.noReferrerAcknowledged)throw Error('Confirm that you want to register without a referrer.');
  }else if(!(await vault.users(referrer)).registered)throw Error('This referrer is not registered on the connected contract. Enter a registered referrer or review registration without one.');
 }
 const usd=await vault.quoteUsd(review.asset,review.amount);
 if(review.kind==='deposit'){
  const minimum=await vault.minDepositUsd();
  if(usd<minimum)throw Error('The amount is below the minimum deposit value of '+formatUnits(minimum,18)+' USD at the current oracle price.');
 }else if(usd===0n)throw Error('The reinvestment is too small to have a nonzero USD value.');
 const vip=await vault.tierConfig(4);
 if(user.capitalUsd+usd>=vip.minUsd&&!user.vipKyc)throw Error('This investment would enter VIP. Administrator KYC approval is required before depositing or reinvesting this amount.');
 return {referrer,usd};
}
