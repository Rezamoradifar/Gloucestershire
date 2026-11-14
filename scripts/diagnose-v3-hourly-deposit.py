#!/usr/bin/env python3
"""Read-only diagnosis of one V3 hourly TESTNET deposit; never signs or sends."""
import argparse
import json
import re
import stat
import sys
import urllib.request
from pathlib import Path

VAULT = '0x4f2777861cc5bdd0d6aed86014ce1370bf823884'
TOKEN = '0x000cdf5f6e3b4761721a5f76205bae6c8523ab89'
ZERO = '0x' + '0' * 40
PROOF = Path('/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json')
ENDPOINTS = ('https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet-rpc.publicnode.com')
ALLOWED = {'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'}


class RpcError(Exception):
    def __init__(self, error):
        self.error = error


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', value):
        raise ValueError('INVALID_ADDRESS')
    return value.lower()


def amount_units(value):
    if not re.fullmatch(r'[0-9]{1,18}(?:\.[0-9]{1,18})?', value):
        raise ValueError('INVALID_AMOUNT')
    whole, _, fraction = value.partition('.')
    units = int(whole) * 10**18 + int(fraction.ljust(18, '0') or '0')
    if not 0 < units < 2**256:
        raise ValueError('INVALID_AMOUNT')
    return units


def display(units):
    whole, fraction = divmod(units, 10**18)
    tail = str(fraction).zfill(18).rstrip('0')
    return str(whole) + ('.' + tail if tail else '.0')


def rpc_for(url):
    def rpc(method, params):
        if method not in ALLOWED:
            raise ValueError('READ_ONLY_METHOD_REQUIRED')
        data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
        request = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.load(response)
        if 'error' in result:
            raise RpcError(result['error'])
        if 'result' not in result:
            raise ValueError('RPC_RESULT_MISSING')
        return result['result']
    return rpc


def word_address(value):
    return address(value)[2:].zfill(64)


def call(rpc, target, data, block, sender=None):
    tx = {'to': target, 'data': data}
    if sender:
        tx['from'] = address(sender)
    return rpc('eth_call', [tx, block])


def uint_result(raw):
    if not isinstance(raw, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', raw):
        raise ValueError('INVALID_UINT_RESPONSE')
    return int(raw, 16)


def user_result(raw):
    if not isinstance(raw, str) or not re.fullmatch(r'0x[0-9a-fA-F]{832}', raw):
        raise ValueError('INVALID_USER_RESPONSE')
    values = [int(raw[2 + i * 64:2 + (i + 1) * 64], 16) for i in range(13)]
    if values[0] >= 2**160 or any(values[index] not in (0, 1) for index in (1, 2, 3, 6)):
        raise ValueError('INVALID_USER_RESPONSE')
    return {'referrer': '0x' + format(values[0], '040x'), 'registered': bool(values[1]),
            'suspended': bool(values[2]), 'vipKyc': bool(values[3]), 'capital': values[7]}


def error_selector(error):
    data = error.get('data') if isinstance(error, dict) else None
    if isinstance(data, dict):
        data = data.get('data')
    if isinstance(data, str) and re.fullmatch(r'0x[0-9a-fA-F]*', data) and len(data) >= 10:
        return data[:10].lower()
    return None


def inspect(rpc, wallet, referrer, amount):
    wallet, referrer = address(wallet), address(referrer)
    if int(rpc('eth_chainId', []), 16) != 97:
        raise ValueError('WRONG_CHAIN')
    tip = int(rpc('eth_blockNumber', []), 16)
    if tip < 3:
        raise ValueError('BLOCK_UNAVAILABLE')
    height, block = tip - 3, hex(tip - 3)
    anchor = rpc('eth_getBlockByNumber', [block, False])
    if not isinstance(anchor, dict) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', str(anchor.get('hash', ''))):
        raise ValueError('BLOCK_UNAVAILABLE')
    for contract in (VAULT, TOKEN):
        code = rpc('eth_getCode', [contract, block])
        if not isinstance(code, str) or not re.fullmatch(r'0x[0-9a-fA-F]+', code) or code == '0x0':
            raise ValueError('CONTRACT_CODE_UNAVAILABLE')
    if uint_result(call(rpc, VAULT, '0x38d52e0f', block)) != int(TOKEN, 16):
        raise ValueError('ASSET_MISMATCH')
    paused_raw = uint_result(call(rpc, VAULT, '0x5c975abb', block))
    if paused_raw not in (0, 1):
        raise ValueError('INVALID_PAUSE_RESPONSE')
    user = user_result(call(rpc, VAULT, '0xa87430ba' + word_address(wallet), block))
    sponsor = None if referrer == ZERO else user_result(call(rpc, VAULT, '0xa87430ba' + word_address(referrer), block))
    balance = uint_result(call(rpc, TOKEN, '0x70a08231' + word_address(wallet), block))
    allowance = uint_result(call(rpc, TOKEN, '0xdd62ed3e' + word_address(wallet) + word_address(VAULT), block))
    reasons = []
    if paused_raw:
        reasons.append('CONTRACT_PAUSED')
    if referrer == wallet:
        reasons.append('SELF_REFERRAL')
    if user['registered'] and user['referrer'] != referrer:
        reasons.append('PERMANENT_REFERRER_MISMATCH')
    if not user['registered'] and sponsor is not None and not sponsor['registered']:
        reasons.append('REFERRER_NOT_REGISTERED_ON_HOURLY_CONTRACT')
    if user['suspended']:
        reasons.append('ACCOUNT_SUSPENDED')
    if user['capital'] + amount > 50_000 * 10**18 and not user['vipKyc']:
        reasons.append('VIP_VERIFICATION_REQUIRED')
    if amount < 10 * 10**18:
        reasons.append('BELOW_MINIMUM_DEPOSIT')
    if balance < amount:
        reasons.append('INSUFFICIENT_TEST_TOKEN_BALANCE')
    if allowance < amount:
        reasons.append('TEST_TOKEN_ALLOWANCE_BELOW_AMOUNT')
    simulation = {'status': 'unavailable', 'selector': None}
    try:
        data = '0x6e553f65' + format(amount, '064x') + word_address(referrer)
        call(rpc, VAULT, data, block, wallet)
        simulation = {'status': 'success', 'selector': None}
    except RpcError as exc:
        simulation = {'status': 'reverted_or_rpc_error', 'selector': error_selector(exc.error)}
    again = rpc('eth_getBlockByNumber', [block, False])
    if not isinstance(again, dict) or str(again.get('hash', '')).lower() != anchor['hash'].lower():
        raise ValueError('BLOCK_CHANGED')
    return {'chainId': 97, 'contract': VAULT, 'block': height, 'wallet': wallet,
            'requestedReferrer': referrer, 'walletRegistered': user['registered'],
            'storedReferrer': user['referrer'],
            'referrerRegisteredHere': None if sponsor is None else sponsor['registered'],
            'suspended': user['suspended'], 'vipKyc': user['vipKyc'],
            'capitalTest': display(user['capital']), 'amountTest': display(amount),
            'tokenBalanceTest': display(balance), 'allowanceTest': display(allowance),
            'reasons': reasons, 'simulation': simulation,
            'note': 'Read-only snapshot; no approval or deposit was sent.'}


def valid_proof(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('PROOF_PERMISSIONS_INVALID')
    if info.st_size > 30000:
        raise ValueError('PROOF_TOO_LARGE')
    proof = json.loads(path.read_text())
    if (proof.get('status') != 'VERIFIED_BNB_TESTNET_ONLY' or
            proof.get('profile') != 'ISOLATED_HOURLY_TESTNET_ONLY' or proof.get('chainId') != 97 or
            proof.get('accrualPeriodSeconds') != 3600 or address(proof.get('contract')) != VAULT or
            address(proof.get('asset')) != TOKEN):
        raise ValueError('HOURLY_DEPLOYMENT_PROOF_MISMATCH')


def main():
    parser = argparse.ArgumentParser(description='Read-only V3 hourly deposit diagnosis')
    parser.add_argument('--wallet', required=True)
    parser.add_argument('--referrer', required=True)
    parser.add_argument('--amount-test', required=True)
    args = parser.parse_args()
    wallet, referrer, amount = address(args.wallet), address(args.referrer), amount_units(args.amount_test)
    valid_proof(PROOF)
    for url in ENDPOINTS:
        try:
            result = inspect(rpc_for(url), wallet, referrer, amount)
            print('V3_HOURLY_DEPOSIT_DIAGNOSTIC ' + json.dumps(result, separators=(',', ':')))
            return
        except (OSError, ValueError, KeyError, TypeError, RpcError):
            continue
    raise ValueError('READ_ONLY_RPC_UNAVAILABLE')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        message = str(exc)
        if not re.fullmatch(r'[A-Z_]+', message):
            message = 'DIAGNOSTIC_UNAVAILABLE'
        print('V3_HOURLY_DEPOSIT_DIAGNOSTIC_FAILED ' + message, file=sys.stderr)
        sys.exit(1)
