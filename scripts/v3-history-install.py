"""Export public chain identities and check the installed history API against them."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlencode

PROFILES = {'portfolio': 'VERIFIED_PORTFOLIO_TESTNET_ONLY', 'plan-portfolio': 'VERIFIED_PLAN_PORTFOLIO_TESTNET_ONLY'}
ADDRESSES = ('vault', 'book', 'network', 'token', 'manager', 'feeReceiver')
HASHES = ('deploymentTx', 'initcodeHash', 'tokenRuntimeHash', 'vaultRuntimeHash', 'bookRuntimeHash', 'networkRuntimeHash')


def export_profiles(root, required):
    exports = []
    for name, status in PROFILES.items():
        path = root / f'v3-{name}-testnet' / 'deployment-proof.json'
        if not os.path.lexists(path):
            if name == required:
                raise ValueError('V3_HISTORY_REQUIRED_PROOF_MISSING')
            continue
        if path.resolve(strict=True) != path:
            raise ValueError('V3_HISTORY_PROOF_PATH_UNSAFE')
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or
                    info.st_mode & 0o077 or not 2 <= info.st_size <= 65536):
                raise ValueError('V3_HISTORY_PROOF_FILE_UNSAFE')
            proof_bytes = stream.read()
            raw = json.loads(proof_bytes)
        valid = (raw.get('status') == status and raw.get('chainId') == 97 and
                 type(raw.get('deploymentBlock')) is int and raw['deploymentBlock'] > 0 and
                 all(re.fullmatch('0x[0-9a-fA-F]{40}', str(raw.get(key))) for key in ADDRESSES) and
                 all(re.fullmatch('0x[0-9a-fA-F]{64}', str(raw.get(key))) for key in HASHES))
        if not valid:
            raise ValueError('V3_HISTORY_DEPLOYMENT_PROOF_INVALID')
        public = {key: raw[key] for key in ('status', 'chainId', 'deploymentBlock', *ADDRESSES, *HASHES)}
        ready_path = path.with_name('worker-ready.json')
        if os.path.lexists(ready_path):
            with os.fdopen(os.open(ready_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > 8192:
                    raise ValueError('V3_HISTORY_WORKER_IDENTITY_INVALID')
                ready = json.load(stream)
            if (ready.get('chainId') != 97 or str(ready.get('vault')).lower() != raw['vault'].lower() or
                    ready.get('proofSha256') != hashlib.sha256(proof_bytes).hexdigest() or
                    not re.fullmatch('0x[0-9a-fA-F]{40}', str(ready.get('operator')))):
                raise ValueError('V3_HISTORY_WORKER_IDENTITY_INVALID')
            public['keeper'] = ready['operator']
        exports.append(public)
    if len({entry['vault'].lower() for entry in exports}) != len(exports):
        raise ValueError('V3_HISTORY_DUPLICATE_DEPLOYMENT')
    return exports


def check_automation(base, transport, proof, primary=False):
    from time import sleep
    vault = proof['vault'].lower()
    url = base + '/api/automation/status' + ('' if primary else '?vault=' + vault)
    for attempt in range(3 if primary else 1):
        if attempt:
            sleep(3)
        payload = subprocess.check_output(['curl', '-sS', '--noproxy', '*', '--max-time', '40', *transport,
                                           '-w', '\n%{http_code}', url])
        body, _, code = payload.rpartition(b'\n')
        data = json.loads(body)
        if (code in (b'200', b'503') and data.get('version') == 2 and data.get('chainId') == 97 and
                str(data.get('vaultAddress')).lower() == vault and data.get('deploymentTx') == proof['deploymentTx'] and
                data.get('status') in ('running', 'waiting', 'stale', 'unavailable') and isinstance(data.get('receipts'), list) and
                (not primary or data.get('checkedAt'))):
            return
    raise ValueError('V3_HISTORY_AUTOMATION_TARGET_UNVERIFIED')


def check_route(profiles, endpoint, required='optional'):
    local = endpoint == 'local'
    if not local and endpoint != 'domain':
        raise ValueError('V3_HISTORY_ENDPOINT_INVALID')
    base = 'http://127.0.0.1:3115' if local else 'https://globaldroptrade.com'
    transport = [] if local else ['--resolve', 'globaldroptrade.com:443:127.0.0.1']
    if required != 'optional':
        profiles = [p for p in profiles if p.get('status') == PROFILES[required]]
        if len(profiles) != 1:
            raise ValueError('V3_HISTORY_REQUIRED_PROOF_MISSING')

    def read(route, proof, **params):
        query = urlencode({'wallet': proof['manager'], 'vault': proof['vault'], **params})
        payload = subprocess.check_output(['curl', '-fsS', '--noproxy', '*', '--max-time', '100', *transport,
                                           f'{base}/api/v3/{route}?{query}'])
        result = json.loads(payload)
        expected = {'wallet': proof['manager'], 'vault': proof['vault'], 'network': proof['network'], 'token': proof['token']}
        if (result.get('version') != 1 or result.get('chainId') != 97 or
                any(str(result.get(key)).lower() != address.lower() for key, address in expected.items())):
            raise ValueError('V3_HISTORY_API_IDENTITY_OR_COVERAGE_INVALID')
        return result

    def check_support(proof):
        vault = proof['vault'].lower()
        for route, expected in [('announcements', 200), ('tickets?admin=1', 401), ('notifications', 401), ('notifications?admin=1', 401)]:
            payload = subprocess.check_output(['curl', '-sS', '--noproxy', '*', '--max-time', '15',
                                               *transport, '-w', '\n%{http_code}',
                                               f'{base}/api/v3/community/{vault}/{route}'])
            body, _, status = payload.rpartition(b'\n')
            if status != str(expected).encode():
                raise ValueError('V3_SUPPORT_WORKSPACE_NOT_READY')
            data = json.loads(body)
            if data.get('chainId') != 97 or str(data.get('vault')).lower() != vault:
                raise ValueError('V3_SUPPORT_WORKSPACE_NOT_READY')
            if expected == 200 and (data.get('notificationsVersion') != 1 or not isinstance(data.get('items'), list) or
                                    any(item.get('published') is not True for item in data['items'])):
                raise ValueError('V3_SUPPORT_WORKSPACE_NOT_READY')
            if expected == 401 and ('items' in data or not data.get('error')):
                raise ValueError('V3_SUPPORT_WORKSPACE_NOT_READY')

    for proof in profiles:
        check_support(proof)
        if proof.get('keeper'):
            check_automation(base, transport, proof)
        result = read('member-history', proof)
        anchor = result.get('anchor', {})
        window = result.get('range', {})
        block = anchor.get('block')
        if not (anchor.get('firstBlock') == proof['deploymentBlock'] and
                type(block) is int and block >= proof['deploymentBlock'] and
                re.fullmatch('0x[0-9a-fA-F]{64}', str(anchor.get('hash'))) and
                window.get('from') == anchor['firstBlock'] and window.get('to') == block and
                result.get('logs') == [] and result.get('requestIds') == []):
            raise ValueError('V3_HISTORY_API_IDENTITY_OR_COVERAGE_INVALID')

        # A bootstrap response does not exercise historical event reads. Use one
        # deployment block and the same confirmed snapshot for both ledgers.
        snapshot = {'anchor': block, 'hash': anchor['hash']}
        first = anchor['firstBlock']
        span = {'from': first, 'to': first}
        events = read('member-history', proof, **snapshot, **span, category='deposits')
        if (events.get('anchor') != anchor or events.get('range') != span or
                not isinstance(events.get('logs'), list) or events.get('requestIds') != [] or
                any(row.get('blockNumber') != first for row in events['logs'])):
            raise ValueError('V3_HISTORY_EVENT_PAGE_INVALID')
        withdrawals = read('member-withdrawals', proof, **snapshot, page=0)
        total = withdrawals.get('total')
        if (withdrawals.get('anchor') != anchor or withdrawals.get('page') != 0 or
                type(total) is not int or total < 0 or not isinstance(withdrawals.get('items'), list) or
                len(withdrawals['items']) != min(20, total) or
                any(str(item.get('beneficiary')).lower() != proof['manager'].lower() for item in withdrawals['items'])):
            raise ValueError('V3_HISTORY_WITHDRAWAL_PAGE_INVALID')


if __name__ == '__main__':
    try:
        operation, path, value, *extra = sys.argv[1:]
        if operation == 'primary' and not extra and value in PROFILES:
            profiles = [p for p in json.loads(Path(path).read_text()) if p['status'] == PROFILES[value]]
            if len(profiles) != 1 or not profiles[0].get('keeper'):
                raise ValueError('V3_HISTORY_WORKER_IDENTITY_INVALID')
            check_automation('https://globaldroptrade.com', ['--resolve', 'globaldroptrade.com:443:127.0.0.1'], profiles[0], True)
        elif operation == 'export' and not extra and value in ('optional', *PROFILES):
            print(json.dumps(export_profiles(Path(path), value), separators=(',', ':')))
        elif operation == 'probe' and (not extra or len(extra) == 1 and extra[0] in PROFILES):
            check_route(json.loads(Path(path).read_text()), value, *extra)
        else:
            raise ValueError('V3_HISTORY_INSTALL_ARGUMENTS_INVALID')
    except (OSError, ValueError, AttributeError, TypeError, subprocess.SubprocessError) as exc:
        print(str(exc) if str(exc).startswith(('V3_HISTORY_', 'V3_SUPPORT_')) else 'V3_HISTORY_INSTALL_CHECK_FAILED', file=sys.stderr)
        sys.exit(1)
