#!/usr/bin/env python3
"""Check the root testnet bundle's exact identity and output its asset paths."""
import argparse
from pathlib import Path
import re
import sys

ENTRY = re.compile(r'<script\b[^>]*\btype="module"[^>]*\bsrc="(?:\./)?(assets/index-[A-Za-z0-9_-]+\.js)"')
DASHBOARD = re.compile(r'V3Dashboard-[A-Za-z0-9_-]+\.js')
ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')
HASH = re.compile(r'^0x[0-9a-fA-F]{64}$')


def inspect(dist, address, runtime_hash, deployment_tx, single_capital=False, referral_profit=False, manual_reinvest=False):
    if not ADDRESS.fullmatch(address) or not HASH.fullmatch(runtime_hash) or not HASH.fullmatch(deployment_tx):
        raise ValueError('INVALID_EXPECTED_CONTRACT_IDENTITY')
    index = (dist / 'index.html').read_text(encoding='utf-8')
    entries = ENTRY.findall(index)
    if len(entries) != 1:
        raise ValueError('INVALID_ENTRY_ASSET')
    entry = entries[0]
    entry_text = (dist / entry).read_text(encoding='utf-8')
    dashboards = set(DASHBOARD.findall(entry_text))
    if len(dashboards) != 1:
        raise ValueError('INVALID_DASHBOARD_ASSET')
    dashboard = 'assets/' + dashboards.pop()
    js = (dist / dashboard).read_text(encoding='utf-8')
    if any(value.lower() not in js.lower() for value in (address, runtime_hash, deployment_tx)):
        raise ValueError('CONTRACT_IDENTITY_MISMATCH')
    if 'ONE-HOUR BNB TESTNET CONTRACT' not in js or 'Test tokens only' not in js:
        raise ValueError('HOURLY_TESTNET_DISCLOSURE_MISSING')
    if single_capital and 'single-capital-testnet' not in js:
        raise ValueError('SINGLE_CAPITAL_PROFILE_MISSING')
    if manual_reinvest and 'manual-reinvest-testnet' not in js:
        raise ValueError('MANUAL_REINVEST_PROFILE_MISSING')
    if referral_profit and 'referral-profit-testnet' not in js:
        raise ValueError('REFERRAL_PROFIT_PROFILE_MISSING')
    if any((dist / 'assets').glob('V2Dashboard-*.js')):
        raise ValueError('RETIRED_DASHBOARD_PRESENT')
    if 'Follow your one-hour test cycle' not in entry_text:
        raise ValueError('HOURLY_LANDING_DISCLOSURE_MISSING')
    return entry, dashboard


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--address', required=True)
    parser.add_argument('--runtime-hash', required=True)
    parser.add_argument('--deployment-tx', required=True)
    parser.add_argument('--single-capital', action='store_true')
    parser.add_argument('--manual-reinvest', action='store_true')
    parser.add_argument('--referral-profit', action='store_true')
    args = parser.parse_args()
    try:
        print('\n'.join(inspect(args.dist, args.address, args.runtime_hash, args.deployment_tx, args.single_capital, args.referral_profit, args.manual_reinvest)))
    except (OSError, ValueError) as exc:
        print('V3_HOURLY_PRIMARY_BUNDLE_INVALID=' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
