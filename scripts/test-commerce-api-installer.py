"""Exercise a narrowly scoped API upgrade and its failure rollback with stub services."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
real_git, real_node, real_stat = map(shutil.which, ['git', 'node', 'stat'])
assert real_git and real_node and real_stat
def historical_blob(blob):
    # Use the actual shipped module where the checkout contains its history.
    # Shallow checkouts exercise the same version matrix with the Git stub.
    result = subprocess.run([real_git, 'cat-file', 'blob', blob], cwd=repo, capture_output=True)
    return result.stdout if result.returncode == 0 else f'test-blob:{blob}\n'.encode()

baseline = historical_blob('5cae7c3c414386fecb82a0226b43237c3445001d')
expected = 'a' * 40

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for name in ['bin', 'scripts', 'server', 'test', 'etc/systemd/system',
                 'etc/globaldroptrade', 'opt/globaldroptrade-api/releases/old/server',
                 'opt/globaldroptrade-api/releases/old/node_modules', 'var/lib/globaldroptrade']:
        (root / name).mkdir(parents=True, exist_ok=True)
    for name in ['scripts/install-commerce-api-only.sh', 'scripts/v3-history-install.py',
                 'scripts/v3-unified-release-pins.mjs', 'scripts/verify-v3-unified-release.mjs', 'scripts/verify-v3-unified-deployment.mjs',
                 'server/portfolio-notifications.mjs', 'server/portfolio-telegram.mjs', 'server/portfolio-status.mjs', 'server/portfolio-payout.mjs', 'scripts/configure-portfolio-telegram.py', 'test/portfolio-telegram.test.mjs',
                 'server/v3-member-history.mjs', 'server/trades-api.mjs', 'server/community.mjs', 'test/v3-portfolio-support.test.mjs',
                 'server/commerce-ebay.mjs', 'server/trading-activity.mjs', 'test/commerce-ebay.test.mjs', 'test/trading-activity.test.mjs', 'test/v3-member-history-api.test.mjs']:
        source = (repo / name).read_text()
        if name.endswith('.sh'):
            for prefix in ['/opt/', '/etc/', '/var/']:
                source = source.replace(prefix, str(root) + prefix)
        (root / name).write_text(source)
    previous = root / 'opt/globaldroptrade-api/releases/old'
    (previous / 'server/trades-api.mjs').write_bytes(baseline)
    (previous / 'node_modules/sentinel').write_text('preserved dependency')
    (previous / 'unrelated-code').write_text('preserved')
    current = root / 'opt/globaldroptrade-api/current'
    current.symlink_to(previous)
    envfile = root / 'etc/globaldroptrade/trades.env'
    envfile.write_text('TRADES_CHAIN_ID=97\nEBAY_CLIENT_SECRET=never-print-this\n')
    envfile.chmod(0o600)
    unit = root / 'etc/systemd/system/globaldroptrade-api.service'
    unit.write_text('[Service]\nUser=globaldroptrade-api\nWorkingDirectory='+str(current)+'\nExecStart=/usr/bin/node '+str(current)+'/server/trades-api.mjs\n')
    original_env, original_unit = envfile.read_bytes(), unit.read_bytes()
    history_state = root/'var/lib/globaldroptrade'
    v7 = history_state/'v3-portfolio-testnet/deployment-proof.json'
    v7.parent.mkdir()
    proof = {key:'0x'+str(i)*40 for i,key in enumerate(('vault','book','network','token','manager','feeReceiver'),1)}
    proof.update({key:'0x'+'a'*64 for key in ('deploymentTx','initcodeHash','tokenRuntimeHash','vaultRuntimeHash','bookRuntimeHash','networkRuntimeHash')})
    proof.update(status='VERIFIED_PORTFOLIO_TESTNET_ONLY',chainId=97,deploymentBlock=55,operatorNote='never-export-private-keys')
    v7.write_text(json.dumps(proof))
    v7.chmod(0o600)
    archive = root/'etc/globaldroptrade/archive-rpc-url'
    archive.write_text('https://archive.example/private-rpc-secret')
    archive.chmod(0o600)
    dropin = Path(str(unit)+'.d')/'40-v3-history-read-rpc.conf'
    response = dict(chainId=97, version=1, wallet=proof['manager'], vault=proof['vault'],
                    network=proof['network'],token=proof['token'],anchor=dict(firstBlock=55,block=58,hash='0x'+'b'*64),
                    range={'from':55,'to':58},logs=[],requestIds=[])
    proof8 = {**proof, 'vault':'0x'+'7'*40, 'status':'VERIFIED_PLAN_PORTFOLIO_TESTNET_ONLY'}
    response8 = {**response, 'vault':proof8['vault']}
    stubs = {
        'id': 'if [[ "$1" == -u ]]; then echo 0; else exit 1; fi',
        'stat': f'if [[ "$1" == -c && "$2" == %u ]]; then echo 0; else exec "{real_stat}" "$@"; fi',
        'git': f'''if [[ "$1" == rev-parse ]]; then echo {expected}; exit 0; fi
if [[ "$1" == hash-object ]]; then
 IFS= read -r first < "${{!#}}" || true
 if [[ "$first" =~ ^test-blob:([a-f0-9]{{40}})$ ]]; then echo "${{BASH_REMATCH[1]}}"; exit 0; fi
fi
exec "{real_git}" "$@"''',
        'node': f'if [[ "$1" == --test || ( "$1" == --env-file=* && $# -gt 3 ) ]]; then exit 0; else exec "{real_node}" "$@"; fi',
        'systemctl': f'if [[ "$1" == restart ]]; then echo restart >> "{root}/restarts"; fi; exit 0',
        'curl': f'''target=''
url=''
while [[ $# -gt 0 ]]; do
 if [[ "$1" == -o ]]; then shift; target="$1"; fi
 if [[ "$1" == http://* ]]; then url="$1"; fi
 shift
done
case "$url" in
 */api/v3/community/*)
   part="${{url#*/api/v3/community/}}"; vault="${{part%%/*}}"
   if [[ -f "{root}/wrong-support" ]]; then echo missing; echo 404
   elif [[ "$part" == */announcements ]]; then
    printf '{{"chainId":97,"vault":"%s","notificationsVersion":1,"items":[]}}\\n200' "$vault"
   else printf '{{"chainId":97,"vault":"%s","error":"Sign in"}}\\n401' "$vault"; fi ;;
 */api/v3/member-*)
   python3 - "$url" <<'PY'
import json, sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
url = urlsplit(sys.argv[1])
params = parse_qs(url.query)
value = {response8!r} if params['vault'] == ['{proof8['vault']}'] else {response!r}
if Path('{root}/wrong-history').exists():
    value['chainId'] = 56
elif 'anchor' in params:
    assert params['anchor'] == ['58'] and params['hash'] == [value['anchor']['hash']]
    if url.path.endswith('member-withdrawals'):
        assert params['page'] == ['0']
        value.update(page=0, total=0, items=[])
        if Path('{root}/wrong-withdrawals').exists():
            value['total'] = 1
    else:
        assert params['from'] == params['to'] == ['55'] and params['category'] == ['deposits']
        value['range'] = {{'from':55,'to':55}}
        if Path('{root}/wrong-log-page').exists():
            value['range']['to'] = 58
print(json.dumps(value))
PY
   ;;
 */api/health) printf '{{"status":"ok"}}' > "$target" ;;
 */api/config) if [[ -f "{root}/fail" && -f "{root}/restarts" ]]; then printf '{{"vault":"changed"}}' > "$target"; else printf '{{"vault":"original"}}' > "$target"; fi ;;
 */api/marketplace*) printf '{{"providers":[{{}},{{}}]}}' > "$target" ;;
 */api/commerce/activity*)
   source="${{url##*=}}"
   if [[ -f "{root}/wrong-seller" && "$source" == ebay ]]; then source=kraken; fi
   printf '{{"source":"%s","status":"not_configured","rows":[]}}' "$source" > "$target" ;;
 */api/commerce/status) printf '{{"version":1,"source":"ebay","status":"not_configured","commercialProfit":null,"profitStatus":"unverified_costs_and_fees"}}' > "$target" ;;
 *) exit 1 ;;
esac''',
    }
    for name, body in stubs.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + body + '\n')
        file.chmod(0o755)
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
           'GLOBAL_COMMERCE_EXPECTED_SHA': expected}
    def run(mode):
        return subprocess.run(['bash', str(root / 'scripts/install-commerce-api-only.sh'), mode],
                              cwd=root, env=env, text=True, capture_output=True)
    check = run('--check')
    assert check.returncode == 0, check.stderr
    assert current.resolve() == previous and not (root / 'restarts').exists()
    installed = run('--install')
    assert installed.returncode == 0, installed.stdout + installed.stderr
    assert current.resolve() != previous
    assert (current / 'server/commerce-ebay.mjs').is_file()
    assert (current / 'server/trading-activity.mjs').is_file()
    assert (current / 'server/community.mjs').read_bytes() == (repo/'server/community.mjs').read_bytes()
    assert (current / 'server/v3-member-history.mjs').is_file()
    assert (current / 'scripts/verify-v3-unified-release.mjs').is_file()
    exported = json.loads((current/'server/v3-history-profiles.json').read_text())
    assert exported == [{k:v for k,v in proof.items() if k != 'operatorNote'}]
    assert archive.read_text() not in dropin.read_text() and 'LoadCredential=v3-history-rpc:' in dropin.read_text()
    again = run('--install')
    assert again.returncode == 0 and 'COMMERCE_API_ALREADY_INSTALLED' in again.stdout
    assert (root / 'restarts').read_text().count('restart') == 1
    assert (current / 'node_modules/sentinel').read_text() == 'preserved dependency'
    assert (current / 'unrelated-code').read_text() == 'preserved'
    v8 = history_state/'v3-plan-portfolio-testnet/deployment-proof.json'
    v8.parent.mkdir()
    v8.write_text(json.dumps(proof8))
    v8.chmod(0o600)
    add_stage = run('--install')
    assert add_stage.returncode == 0, add_stage.stdout + add_stage.stderr
    assert [p['vault'] for p in json.loads((current/'server/v3-history-profiles.json').read_text())] == [proof['vault'],proof8['vault']]
    v8.unlink()
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert 'never-print-this' not in installed.stdout + installed.stderr
    modules = [previous / 'server' / name for name in ('trades-api.mjs', 'commerce-ebay.mjs', 'trading-activity.mjs')]
    summary_api = '3455a60264a754cc6a558737ded964391d517109'
    for hashes in [
            (summary_api, '967e427df79f212b956e11724c331ac26326e426', None),
            (summary_api, '317ae1adc05081ee2e0ee3f6cc36e8d6535918ec', None),
            ('c94269f994a19dbb641f30430441df776d78e065', '6f21e279898a3326790a7a856e3a2b9d7c2bd040', 'cbe54780136ea3fc4afc21c3ee6bfca7588474ee'),
            ('c94269f994a19dbb641f30430441df776d78e065', '780c0035f2727a4325c2ae56efba2acd4df896e6', 'beaa81c538b393513ac1e96a7e490709130b9ac3'),
            ('c94269f994a19dbb641f30430441df776d78e065', '493d9b5dd388ce84dc559565de3c2f438b813422', '3c1cb19872b14b8cca44a370eefe81411c1ef42a'),
            ('e786a10d90a6918f95187ff1cdf982b0e4490a40', 'd8ebad0e2f064bd4c7ac0ad177da17b32b51e124', 'cbe54780136ea3fc4afc21c3ee6bfca7588474ee')]:
        current.unlink()
        current.symlink_to(previous)
        for file, blob in zip(modules, hashes):
            if blob:
                file.write_bytes(historical_blob(blob))
            else:
                file.unlink(missing_ok=True)
        upgrade = run('--install')
        assert upgrade.returncode == 0 and current.resolve() != previous, upgrade.stdout + upgrade.stderr
        for file, blob in zip(modules, hashes):
            if blob is None:
                assert not file.exists()
            else:
                assert file.read_bytes() == historical_blob(blob)
    prior = {
        'server/trades-api.mjs': 'e2dc460016caa3679f70bcda5d1c810a448b01ed',
        'server/commerce-ebay.mjs': '493d9b5dd388ce84dc559565de3c2f438b813422',
        'server/trading-activity.mjs': '3c1cb19872b14b8cca44a370eefe81411c1ef42a',
        'server/v3-member-history.mjs': '54cd1fc7f99320df137426c2fd9cbc460c0c52c9',
        'server/community.mjs': 'b5a980ce6dfc15fdacdc44f385b162f6b5ce9276',
        'scripts/v3-unified-release-pins.mjs': '63990e2f3f47f40b3d77d5ae702a2767b3e25c11',
        'scripts/verify-v3-unified-release.mjs': 'd6c8962294ff26a940462d3d33b99d3946e9e193',
        'scripts/verify-v3-unified-deployment.mjs': 'e66c5ce9912c3265465256b73bc407b1241aeb0f'
    }
    current.unlink()
    current.symlink_to(previous)
    for name, blob in prior.items():
        (previous/name).parent.mkdir(exist_ok=True)
        (previous/name).write_bytes(historical_blob(blob))
    upgrade = run('--install')
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
    assert (current/'server/community.mjs').read_bytes() == (repo/'server/community.mjs').read_bytes()
    current.unlink()
    current.symlink_to(previous)
    # Upgrade the exact previous primary support release, including its history reader.
    for name, blob in {'server/trades-api.mjs':'e9d2bed2d47f6dc0b61767f6a28178eae9eff9b0',
                       'server/v3-member-history.mjs':'63f1f716ee9688cbf128ad4081a1b20864a5b6fc',
                       'server/community.mjs':'76de3615106767056c040290b939c5f74ca1ef9a'}.items():
        (previous/name).write_bytes(historical_blob(blob))
    upgrade = run('--install')
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
    for name in ['server/portfolio-notifications.mjs','server/portfolio-telegram.mjs','scripts/configure-portfolio-telegram.py','server/portfolio-status.mjs','server/portfolio-payout.mjs']:
        assert (current/name).read_bytes() == (repo/name).read_bytes()
    current.unlink()
    current.symlink_to(previous)
    # The notification-enabled release was already deployed before keeper and payout verification were added.
    notification_modules = {
        'server/portfolio-notifications.mjs': 'de1d6ebce029583629745d9d97d4603d7a81838b',
        'server/portfolio-telegram.mjs': '2fe185146d5cedae55ebfeb818fc18da3c3e0cf2',
        'scripts/configure-portfolio-telegram.py': '2eb5f6ded03ae575c2a73ce3d4912e2177b52d27'
    }
    for name, blob in {**notification_modules, 'server/trades-api.mjs': '86e9d96817cf53c7e1101a0420e17fec39c0f1cf',
                       'server/community.mjs': '0c8b5d1eb97c6761f51acfe191b4ad6533982721'}.items():
        (previous/name).write_bytes(historical_blob(blob))
    upgrade = run('--install')
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
    assert (current/'server/portfolio-status.mjs').is_file() and (current/'server/portfolio-payout.mjs').is_file()
    current.unlink()
    current.symlink_to(previous)
    for name in notification_modules:
        (previous/name).unlink()
    (previous/'server/community.mjs').write_text('local unpublished changes')
    unknown_support = run('--check')
    assert unknown_support.returncode != 0 and 'COMMERCE_LIVE_SUPPORT_VERSION_REVIEW_REQUIRED' in unknown_support.stdout
    for name in prior:
        (previous/name).unlink()
    modules[0].write_bytes(baseline)
    for file in modules[1:]:
        file.unlink(missing_ok=True)
    current.unlink()
    current.symlink_to(previous)
    (root / 'restarts').unlink()
    (root / 'fail').touch()
    failed = run('--install')
    assert failed.returncode != 0 and current.resolve() == previous
    assert 'COMMERCE_PREVIOUS_API_RESTORED' in failed.stdout
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert (root / 'restarts').read_text().count('restart') == 2
    (root / 'fail').unlink()
    (root / 'wrong-seller').touch()
    wrong_source = run('--install')
    assert wrong_source.returncode != 0 and current.resolve() == previous
    assert 'TRADING_ACTIVITY_RESPONSE_INVALID' in wrong_source.stderr
    assert 'COMMERCE_PREVIOUS_API_RESTORED' in wrong_source.stdout
    (root / 'wrong-seller').unlink()
    dropin.unlink()
    (root/'wrong-history').touch()
    wrong_history=run('--install')
    assert wrong_history.returncode != 0 and current.resolve() == previous, wrong_history.stdout
    assert 'V3_HISTORY_API_IDENTITY_OR_COVERAGE_INVALID' in wrong_history.stderr
    assert not dropin.exists()
    (root/'wrong-history').unlink()
    for marker, message in [('wrong-log-page','V3_HISTORY_EVENT_PAGE_INVALID'),
                            ('wrong-withdrawals','V3_HISTORY_WITHDRAWAL_PAGE_INVALID'),
                            ('wrong-support','V3_SUPPORT_WORKSPACE_NOT_READY')]:
        (root/marker).touch()
        failed_page = run('--install')
        assert failed_page.returncode != 0 and current.resolve() == previous
        assert message in failed_page.stderr and not dropin.exists()
        (root/marker).unlink()
    v7.chmod(0o644)
    unsafe_history=run('--check')
    assert unsafe_history.returncode!=0 and 'V3_HISTORY_PROOF_FILE_UNSAFE' in unsafe_history.stderr
    v7.chmod(0o600)
    (previous / 'server/trades-api.mjs').write_text('unreviewed')
    (root / 'restarts').unlink()
    refused = run('--install')
    assert refused.returncode != 0 and 'COMMERCE_LIVE_API_VERSION_REVIEW_REQUIRED' in refused.stdout
    assert 'COMMERCE_MODULE_FINGERPRINT=' in refused.stdout and '/missing/missing' in refused.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    modules[0].write_bytes(historical_blob(summary_api))
    modules[1].symlink_to(envfile)
    invalid_module = run('--install')
    assert invalid_module.returncode != 0 and '/symlink/missing' in invalid_module.stdout
    assert 'never-print-this' not in invalid_module.stdout + invalid_module.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    modules[1].unlink()
    (previous / 'server/trades-api.mjs').write_bytes(baseline)
    (previous / 'server').chmod(0o777)
    unsafe = run('--install')
    assert unsafe.returncode != 0 and 'COMMERCE_API_PERMISSIONS_UNSAFE' in unsafe.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    (previous / 'server').chmod(0o755)
    envfile.write_text('TRADES_CHAIN_ID=97\nCOMMUNITY_DATA_FILE=relative/community.json\n')
    relative = run('--install')
    assert relative.returncode != 0 and 'COMMERCE_RELATIVE_DATA_PATH_REVIEW_REQUIRED' in relative.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    envfile.write_text('COMMERCE_PRODUCT_CATALOG_FILE=relative/model-catalog.json\n')
    product_path = run('--install')
    assert product_path.returncode != 0 and 'COMMERCE_RELATIVE_DATA_PATH_REVIEW_REQUIRED=COMMERCE_PRODUCT_CATALOG_FILE' in product_path.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    print('PASS: historical commerce upgrades, idempotence, rollback, configuration preservation and unknown-module diagnostics')
