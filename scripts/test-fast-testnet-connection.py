"""Reuse the isolated cutover fixture with an explicitly selected fast profile."""
from pathlib import Path

fixture = Path(__file__).with_name('test-zero-start-installer.py').read_text()


def replace_once(before, after):
    global fixture
    assert fixture.count(before) == 1, 'Shared cutover fixture changed: '+before
    fixture = fixture.replace(before, after)


replace_once("'state/fresh-zero-v1', 'state/fresh-zero-automation-v1'",
             "'state/fresh-zero-v1', 'state/fresh-fast-testnet-v1', 'state/fresh-zero-automation-v1'")
for name in ['connection-public.json', 'deployment-public.json']:
    replace_once("host/'state/fresh-zero-v1/"+name+"'", "host/'state/fresh-fast-testnet-v1/"+name+"'")
replace_once("    deployment.chmod(0o600)\n", """    deployment.chmod(0o600)
    protected = {
        'state/fresh-zero-v1/deployment-public.json': 'previous-zero-deployment',
        'state/fresh-zero-v1/connection-public.json': 'previous-zero-connection',
        'state/approved-rewards-v1/deployment-public.json': 'previous-approval-deployment',
        'keys/operator.key': 'previous-private-key',
        'community/users.json': '{"users":["existing-user"]}',
    }
    for name, content in protected.items():
        file = host/name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        file.chmod(0o600)
""")
replace_once(' mode=$2; stage=$3\n', ''' mode=$2; stage=$3
 [ "$#" -eq 4 ] && [ "$4" = --fast-testnet ] || exit 1
''')
replace_once("'GLOBAL_MIGRATION_ENABLED=false' 'KEEP=preserved' >", "'GLOBAL_MIGRATION_ENABLED=false' 'KEEP=preserved' 'TRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1' >")
replace_once("assert 'GLOBAL_MIGRATION_ENABLED=false' in (p/'etc/globaldroptrade/trades.env').read_text()",
             "assert 'GLOBAL_MIGRATION_ENABLED=false' in (p/'etc/globaldroptrade/trades.env').read_text()\nassert 'TRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1' in (p/'etc/globaldroptrade/trades.env').read_text()")
replace_once("['bash', str(source/'ubuntu-connect-zero-start.sh')]", "['bash', str(source/'ubuntu-connect-zero-start.sh'), '--fast-testnet']")
replace_once('        return result\n', '''        for name, content in protected.items():
            assert (host/name).read_text() == content, name+' changed'
            assert (host/name).stat().st_mode & 0o777 == 0o600, name+' permissions changed'
        assert not (host/'state/fresh-zero-connection').exists(), 'Default connection namespace was used'
        return result
''')
replace_once("    print('PASS: exact fresh-target activation;", """    assert (host/'state/fresh-fast-testnet-connection/run.lock').is_file()
    for flags in [['--fast-testnet', '--fast-testnet'], ['--unknown'], ['0x1234']]:
        result = subprocess.run(['bash', str(source/'ubuntu-connect-zero-start.sh'), *flags], cwd=source,
                                env=environment, capture_output=True, text=True, timeout=30)
        assert result.returncode != 0 and 'FRESH_ZERO_SITE_CONNECTED' not in result.stdout
    saved = deployment.read_bytes()
    deployment.unlink()
    try:
        result = run()
        assert result.returncode != 0 and 'FRESH_ZERO_DEPLOYMENT_REPORT_REQUIRED' in result.stdout
        assert (host/'state/fresh-zero-v1/deployment-public.json').read_text() == protected['state/fresh-zero-v1/deployment-public.json']
    finally:
        deployment.write_bytes(saved)
    print('PASS: explicit fast profile and separate report/lock/backup paths; old deployments, keys and community preserved; exact fresh-target activation;""")

exec(compile(fixture, str(Path(__file__).with_name('test-zero-start-installer.py')), 'exec'), {'__file__': __file__})
