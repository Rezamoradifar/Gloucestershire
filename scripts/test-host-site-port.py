#!/usr/bin/env python3
"""Offline checks for scoped port ownership, verification and rollback."""
import errno
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_site_port', Path(__file__).with_name('host-site-port.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class PortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.base = Path(self.temp.name)
        self.calls = []; self.fail_reload = False; self.bad_page = False; self.unrelated = ''
        self.root = '/var/www/globaldroptrade/releases/release-one'
        self.tool = m.SitePort(self.base, self.run_command, lambda delay: None)
        for name in ('etc/nginx/sites-available','etc/nginx/sites-enabled','etc/nginx/snippets',
                     self.root.lstrip('/'),'var/backups'):
            (self.base/name).mkdir(parents=True, exist_ok=True)
        self.canonical = self.tool.nginx/'sites-available/globaldroptrade.com'
        self.canonical.write_text('server {\nserver_name globaldroptrade.com www.globaldroptrade.com;\nroot '+self.root+';\n}\n')
        (self.tool.path(self.root)/'index.html').write_text('<html>Global</html>\n')
        snippet = self.tool.nginx/'snippets/globaldroptrade-api.conf'
        snippet.write_text('# Managed by Global Drop Trade\nlocation /api/ { proxy_pass http://127.0.0.1:3115; }\n')
        self.api = {'version':1,'chainId':97,'vaultAddress':'0x'+'12'*20}

    def tearDown(self): self.temp.cleanup()

    def run_command(self, args, **kwargs):
        self.calls.append(args)
        out = ''; status = 0
        if args == ['nginx','-T']:
            out = '# configuration file /etc/nginx/sites-enabled/globaldroptrade.com:\n'+self.canonical.read_text()
            if self.tool.conf.exists():
                out += '# configuration file /etc/nginx/sites-enabled/'+m.NAME+':\n'+self.tool.conf.read_text()
            out += self.unrelated
        elif args[:3] == ['ss','-H','-ltnp']: out = ''
        elif args == ['systemctl','reload','nginx'] and self.fail_reload: status = 1
        elif args[0] == 'curl':
            url = args[-1]
            if url.endswith('/api/config'): out = json.dumps(self.api)
            else: out = 'wrong page' if self.bad_page else (self.tool.path(self.root)/'index.html').read_text()
        return SimpleNamespace(returncode=status, stdout=out, stderr='')

    def apply(self):
        with patch.object(self.tool,'free_port',lambda old:True): self.tool.apply()

    def test_new_site_preserves_domain_and_routes_spa_and_api(self):
        canonical = self.canonical.read_bytes(); snippet = (self.tool.nginx/'snippets/globaldroptrade-api.conf').read_bytes()
        self.apply()
        data = self.tool.conf.read_text()
        self.assertEqual(data,m.render(self.root,True))
        self.assertIn('listen 8898;',data)
        self.assertIn('try_files $uri $uri/ /index.html;',data)
        self.assertIn('include /etc/nginx/snippets/globaldroptrade-api.conf;',data)
        self.assertEqual(self.tool.link.resolve(),self.tool.conf)
        self.assertEqual(self.canonical.read_bytes(),canonical)
        self.assertEqual((self.tool.nginx/'snippets/globaldroptrade-api.conf').read_bytes(),snippet)
        self.assertTrue(any(x[-1]=='http://127.0.0.1:8898/dashboard' for x in self.calls))

    def test_idempotent_update_tracks_latest_https_release(self):
        self.apply(); old_root=self.root
        self.root='/var/www/globaldroptrade/releases/release-two'
        self.tool.path(self.root).mkdir(); (self.tool.path(self.root)/'index.html').write_text('<html>New</html>')
        self.canonical.write_text(self.canonical.read_text().replace(old_root,self.root))
        self.apply()
        self.assertEqual(self.tool.conf.read_text(),m.render(self.root,True))
        self.assertEqual(len(list(self.tool.backups.glob('port8898-*'))),2)

    def test_unknown_existing_site_never_overwritten(self):
        self.tool.conf.write_text('server { listen 8898; root /srv/other; }')
        self.tool.link.symlink_to(self.tool.conf)
        before=self.tool.conf.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'EXISTING_SITE'): self.apply()
        self.assertEqual(before,self.tool.conf.read_bytes())
        self.assertFalse(self.tool.backups.exists())

    def test_other_nginx_site_using_port_is_rejected(self):
        self.unrelated='# configuration file /etc/nginx/conf.d/other.conf:\nserver {\n listen 0.0.0.0:8898;\n}\n'
        with self.assertRaisesRegex(RuntimeError,'OTHER_NGINX_SITE'): self.apply()
        self.assertFalse(self.tool.conf.exists())

    def test_inline_listener_in_other_config_is_also_rejected(self):
        self.unrelated='# configuration file /etc/nginx/conf.d/other.conf:\nserver { listen 8898; server_name other.example; }\n'
        with self.assertRaisesRegex(RuntimeError,'OTHER_NGINX_SITE'): self.apply()
        self.assertFalse(self.tool.conf.exists())

    def test_unknown_listener_refused_even_when_owned_config_exists(self):
        self.tool.conf.write_text(m.render(self.root)); self.tool.link.symlink_to(self.tool.conf)
        with patch.object(self.tool,'call',lambda *args,**kwargs:SimpleNamespace(stdout='LISTEN 0 50 0.0.0.0:8898 users:(("node",pid=12,fd=3))')):
            with self.assertRaisesRegex(RuntimeError,'PORT_IN_USE'): self.tool.free_port(self.tool.conf.read_text())

    def test_owned_nginx_listener_can_be_updated(self):
        with patch.object(self.tool,'call',lambda *args,**kwargs:SimpleNamespace(stdout='LISTEN 0 50 0.0.0.0:8898 users:(("nginx",pid=12,fd=3))')):
            self.assertTrue(self.tool.free_port(m.render(self.root)))
            with self.assertRaisesRegex(RuntimeError,'PORT_IN_USE'): self.tool.free_port(None)

    def test_bound_socket_with_no_ss_entry_still_refused(self):
        with patch.object(m.socket,'socket',side_effect=OSError(errno.EADDRINUSE,'busy')):
            with self.assertRaisesRegex(RuntimeError,'PORT_IN_USE'): self.tool.free_port(None)

    def test_reload_failure_rolls_back_only_new_site(self):
        original=self.canonical.read_bytes(); self.fail_reload=True
        with self.assertRaisesRegex(RuntimeError,'INSTALL_FAILED_ROLLED_BACK'): self.apply()
        self.assertFalse(self.tool.conf.exists()); self.assertFalse(self.tool.link.is_symlink())
        self.assertEqual(original,self.canonical.read_bytes())

    def test_failed_health_restores_existing_site_bytes(self):
        old=m.render('/var/www/globaldroptrade/releases/old-release',False)
        self.tool.conf.write_text(old); self.tool.link.symlink_to(self.tool.conf)
        self.bad_page=True
        with self.assertRaisesRegex(RuntimeError,'INSTALL_FAILED_ROLLED_BACK'): self.apply()
        self.assertEqual(self.tool.conf.read_text(),old)
        self.assertEqual(self.tool.link.resolve(),self.tool.conf)

    def test_wrong_proxied_contract_rolls_back_even_with_correct_frontend(self):
        original=self.tool.runner
        def altered(args, **kwargs):
            result=original(args,**kwargs)
            if args[-1]=='http://127.0.0.1:8898/api/config':
                result.stdout=json.dumps({**self.api,'vaultAddress':'0x'+'34'*20})
            return result
        self.tool.runner=altered
        with self.assertRaisesRegex(RuntimeError,'INSTALL_FAILED_ROLLED_BACK'): self.apply()
        self.assertFalse(self.tool.conf.exists()); self.assertFalse(self.tool.link.is_symlink())

    def test_symlinked_release_ancestor_is_refused(self):
        releases=self.tool.path('/var/www/globaldroptrade/releases')
        releases.rename(releases.with_name('preserved-releases'))
        releases.symlink_to(releases.with_name('preserved-releases'),target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'TRUSTED_PATH'): self.apply()

    def test_arbitrary_canonical_directory_refused(self):
        self.canonical.write_text('server_name globaldroptrade.com www.globaldroptrade.com;\nroot /root/dravon-main;\n')
        with self.assertRaisesRegex(RuntimeError,'MANAGED_RELEASE'): self.apply()


if __name__ == '__main__': unittest.main()
