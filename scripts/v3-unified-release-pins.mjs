// The public TestMocks.sol:MockToken Sourcify exact match on chain 97 used solc
// 0.8.30+commit.73712a01. The historical artifacts/MockToken.json at
// 12de0606aaf2d3a047db53ebfe50aefe66a9efa1 matches the recompiled runtime.
// The only immutable is decimals = 18, 32 bytes at offset 821.
// https://sourcify.dev/server/v2/contract/97/0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89?fields=runtimeBytecode,deployment,compilation
// Creation transaction: 0xe7d76ad2ad26e450db365fd4f532f07edc113f711a3d6c5323434c348bab472c
export const UNIFIED_TOKEN = '0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
export const UNIFIED_TOKEN_RUNTIME_HASH = '0xbf2b1d4facfd078c696c0b96e69c3956fc1bd4530d18f4097996aba8f4051561';

// Solidity source at 8e8fd210ae7e33f8345a32cace551cef0d2c79ae. Includes
// the pinned manager, test token and fee receiver constructor arguments.
export const UNIFIED_INITCODE_HASH = '0x31c92f6efd0b21c271977758e9f59407dcbba1eeb88874603d10329acf2d8670';
export const UNIFIED_DEPLOYER = '0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d';
export const UNIFIED_MANAGER = '0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
export const UNIFIED_FEE_RECEIVER = '0x74015deDF36677485793f1714Ec7bD4893907b26';

export const UNIFIED_PROFILE = Object.freeze({
 status:'VERIFIED_UNIFIED_TESTNET_ONLY', mode:'unified-testnet', route:'/unified-test/',
 stateDirectory:'/var/lib/globaldroptrade/v3-unified-testnet',
 gasKey:'/etc/globaldroptrade/v3-unified-keeper-testnet-gas-only.key',
 timer:'global-v3-unified-keeper-testnet.timer', initcodeHash:UNIFIED_INITCODE_HASH
});
export const SINGLE_CAPITAL_PROFILE = Object.freeze({
 status:'VERIFIED_SINGLE_CAPITAL_TESTNET_ONLY', mode:'single-capital-testnet', route:'/single-capital-test/',
 stateDirectory:'/var/lib/globaldroptrade/v3-single-capital-testnet',
 gasKey:'/etc/globaldroptrade/v3-single-capital-keeper-testnet-gas-only.key',
 timer:'global-v3-single-capital-keeper-testnet.timer',
 // compileSingleCapitalTestnet() with the reviewed test constructor inputs above.
 initcodeHash:'0xff83d9ff867e0c683d44ad1949cbf430871f612c232ef2a881ec9d24ac548c5b'
});

export const DAILY_CAPITAL_PROFILE = Object.freeze({
 status:'VERIFIED_DAILY_CAPITAL_TESTNET_ONLY', mode:'daily-capital-testnet', route:'/daily-capital-test/',
 stateDirectory:'/var/lib/globaldroptrade/v3-daily-capital-testnet',
 gasKey:'/etc/globaldroptrade/v3-daily-capital-keeper-testnet-gas-only.key',
 timer:'global-v3-daily-capital-keeper-testnet.timer',
 initcodeHash:'0x0ea45b0a8db193a745cb7ac79a30698bfc9c65d5806d049d04a23a790c96db00'
});

export const REFERRAL_PROFIT_PROFILE = Object.freeze({
 status:'VERIFIED_REFERRAL_PROFIT_TESTNET_ONLY', mode:'referral-profit-testnet', route:'/referral-profit-test/',
 stateDirectory:'/var/lib/globaldroptrade/v3-referral-profit-testnet',
 gasKey:'/etc/globaldroptrade/v3-referral-profit-keeper-testnet-gas-only.key',
 timer:'global-v3-referral-profit-keeper-testnet.timer',
 initcodeHash:'0x460436d40acf99db439a1fe592ae6ccf26d6eca7a04c934122f77e39e2ecf05f'
});

export function unifiedProfileForFlag(flag) {
 if(flag===undefined)return UNIFIED_PROFILE;
 if(flag==='--referral-profit')return REFERRAL_PROFIT_PROFILE;
 if(flag==='--daily-capital')return DAILY_CAPITAL_PROFILE;
 if(flag==='--single-capital')return SINGLE_CAPITAL_PROFILE;
 throw Error('UNIFIED_RELEASE_PROFILE_INVALID');
}
