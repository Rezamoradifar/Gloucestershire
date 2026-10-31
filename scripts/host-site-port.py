#!/usr/bin/env python3
"""Expose the verified Global frontend on its separate HTTP port."""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time

IP = '185.114.206.44'
PORT = 8898
NAME = 'globaldroptrade-ip-'+IP+'-'+str(PORT)
MARKER = '# Managed by Global Drop Trade - isolated host HTTP port 8898\n'


def fail(reason):
    raise RuntimeError('HOST_SITE_PORT_'+reason)


def render(root, ipv6=True):
    extra = '    listen [::]:8898;\n' if ipv6 else ''
    return MARKER+f'''server {{
    listen 8898;
{extra}    server_name {IP};
    include /etc/nginx/snippets/globaldroptrade-api.conf;
    root {root};
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location / {{ try_files $uri $uri/ /index.html; }}
    location /assets/ {{ try_files $uri =404; expires 30d; }}
    location ~ \\.mjs$ {{ types {{ text/javascript mjs; }} try_files $uri =404; }}
    location ~ /\\. {{ deny all; }}
}}
'''


class SitePort:
    def __init__(self, prefix=Path('/'), runner=subprocess.run, pause=time.sleep):
        self.prefix = Path(prefix)
        self.runner, self.pause = runner, pause
        self.nginx = self.path('/etc/nginx')
        self.conf = self.nginx/'sites-available'/NAME
        self.link = self.nginx/'sites-enabled'/NAME
        self.backups = self.path('/var/backups/globaldroptrade')

    def path(self, logical):
        return self.prefix/str(logical).lstrip('/')

    def safe(self, path, directory=False):
        s = path.lstat()
        valid = stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)
        if not valid or s.st_uid != os.geteuid() or s.st_mode & 0o022:
            fail('TRUSTED_PATH_REQUIRED')

    def safe_parents(self, path):
        for parent in path.parents:
            if parent == self.prefix: break
            if parent.exists() or parent.is_symlink(): self.safe(parent, True)

    def call(self, args, check=True):
        r = self.runner(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if check and r.returncode: fail('LOCAL_COMMAND_FAILED')
        return r

    def canonical(self):
        for p in (self.nginx, self.nginx/'sites-available', self.nginx/'sites-enabled'):
            self.safe(p, True)
        conf = self.nginx/'sites-available/globaldroptrade.com'; self.safe(conf)
        data = conf.read_text()
        names = set()
        for row in re.findall(r'^\s*server_name\s+([^;]+);', data, re.M): names.update(row.split())
        if names != {'globaldroptrade.com', 'www.globaldroptrade.com'}: fail('CANONICAL_GLOBAL_SITE_REQUIRED')
        roots = set(re.findall(r'^\s*root\s+([^;\s]+);', data, re.M))
        if len(roots) != 1: fail('ONE_CANONICAL_ROOT_REQUIRED')
        root = roots.pop()
        if not re.fullmatch(r'/var/www/globaldroptrade/releases/[A-Za-z0-9_.-]+', root):
            fail('MANAGED_RELEASE_REQUIRED')
        self.safe_parents(self.path(root))
        self.safe(self.path(root), True); self.safe(self.path(root)/'index.html')
        snippet = self.nginx/'snippets/globaldroptrade-api.conf'; self.safe(snippet)
        text = snippet.read_text()
        if not text.startswith('# Managed by Global Drop Trade') or not re.search(r'proxy_pass\s+http://127\.0\.0\.1:3115\s*;', text):
            fail('MANAGED_API_SNIPPET_REQUIRED')
        return root

    def nginx_dump(self):
        r = self.call(['nginx', '-T'])
        if re.search(r'conflicting server name "'+re.escape(IP)+r'"', r.stderr):
            fail('NGINX_HOST_CONFLICT')
        return r.stdout

    def owned(self):
        exists = self.conf.exists() or self.conf.is_symlink()
        linked = self.link.exists() or self.link.is_symlink()
        if not exists and not linked: return None
        if not exists or not linked: fail('EXISTING_SITE_REVIEW_REQUIRED')
        self.safe(self.conf)
        if not self.link.is_symlink() or self.link.resolve() != self.conf:
            fail('EXISTING_ENABLED_SITE_REVIEW_REQUIRED')
        old = self.conf.read_text()
        roots = re.findall(r'^\s*root\s+([^;\s]+);', old, re.M)
        if len(roots) != 1 or not re.fullmatch(r'/var/www/globaldroptrade/releases/[A-Za-z0-9_.-]+', roots[0]):
            fail('EXISTING_SITE_REVIEW_REQUIRED')
        if old not in (render(roots[0], True), render(roots[0], False)):
            fail('EXISTING_SITE_REVIEW_REQUIRED')
        return old

    def check_conflicts(self, dump, old):
        current = ''
        own = {'/etc/nginx/sites-available/'+NAME, '/etc/nginx/sites-enabled/'+NAME,
               str(self.conf), str(self.link)}
        for line in dump.splitlines():
            header = re.fullmatch(r'# configuration file (.+):', line)
            if header: current = header[1]; continue
            for match in re.finditer(r'(?:^|[;{}])\s*listen\s+([^\s;]+)', line.split('#', 1)[0]):
                if match[1].rsplit(':', 1)[-1] == str(PORT):
                    if old is None or current not in own: fail('OTHER_NGINX_SITE_USES_PORT')

    def free_port(self, old):
        listeners = self.call(['ss', '-H', '-ltnp', 'sport = :8898']).stdout.splitlines()
        if listeners:
            if old is None or any(not re.search(r'users:\(\("nginx",pid=\d+', x) for x in listeners):
                fail('PORT_IN_USE')
            return 'listen [::]:8898;' in old
        ipv6 = socket.has_ipv6
        for family, address in ((socket.AF_INET, ('0.0.0.0', PORT)),
                                (socket.AF_INET6, ('::', PORT))):
            if family == socket.AF_INET6 and not ipv6: continue
            try:
                with socket.socket(family, socket.SOCK_STREAM) as sock:
                    if family == socket.AF_INET6: sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    sock.bind(address)
            except OSError as e:
                if family == socket.AF_INET6 and e.errno in (errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL):
                    ipv6 = False; continue
                fail('PORT_IN_USE')
        return ipv6

    def preflight(self):
        root = self.canonical(); old = self.owned()
        self.check_conflicts(self.nginx_dump(), old)
        return root, old, self.free_port(old)

    def write_config(self, data):
        fd, name = tempfile.mkstemp(prefix='.global-port-', dir=self.conf.parent)
        try:
            with os.fdopen(fd, 'w') as f:
                f.write(data); f.flush(); os.fsync(f.fileno()); os.fchmod(f.fileno(), 0o644)
            os.replace(name, self.conf)
        finally:
            if os.path.exists(name): os.unlink(name)

    def health(self, root):
        direct = self.call(['curl', '-fsS', '--noproxy', '*', '--max-time', '5',
                            'http://127.0.0.1:3115/api/config'])
        try: identity = json.loads(direct.stdout)
        except ValueError: fail('API_IDENTITY_REQUIRED')
        if identity.get('chainId') != 97 or not re.fullmatch(r'0x[0-9a-fA-F]{40}', str(identity.get('vaultAddress', ''))):
            fail('TESTNET_API_REQUIRED')
        expected = (self.path(root)/'index.html').read_text()
        for attempt in range(10):
            try:
                for suffix in ('/', '/dashboard'):
                    page = self.call(['curl', '-fsS', '--noproxy', '*', '--max-time', '5',
                                      '-H', 'Host: '+IP+':8898', '-H', 'Cache-Control: no-cache',
                                      'http://127.0.0.1:8898'+suffix])
                    if page.stdout != expected: fail('FRONTEND_MISMATCH')
                api = self.call(['curl', '-fsS', '--noproxy', '*', '--max-time', '5',
                                 '-H', 'Host: '+IP+':8898', 'http://127.0.0.1:8898/api/config'])
                if json.loads(api.stdout) != identity: fail('API_TARGET_MISMATCH')
                return
            except (RuntimeError, ValueError):
                if attempt == 9: fail('HEALTH_FAILED')
                self.pause(1)

    def apply(self):
        root, old, ipv6 = self.preflight()
        self.safe_parents(self.backups)
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700); self.safe(self.backups, True)
        backup = Path(tempfile.mkdtemp(prefix='port8898-', dir=self.backups))
        if old is not None:
            (backup/'site.conf').write_text(old); (backup/'site.conf').chmod(0o600)
        (backup/'manifest.json').write_text(json.dumps({'version':1, 'port':8898,
                                                       'previouslyPresent':old is not None, 'newRoot':root}))
        (backup/'manifest.json').chmod(0o600)
        new = render(root, ipv6)
        # Recheck the owned file immediately before changing it.
        if self.owned() != old: fail('SITE_CHANGED_DURING_PREFLIGHT')
        try:
            self.write_config(new)
            if old is None: self.link.symlink_to(self.conf)
            self.nginx_dump()
            self.call(['systemctl', 'reload', 'nginx'])
            self.health(root)
        except Exception:
            # Restore only the exact new configuration created by this invocation.
            if not self.conf.is_file() or self.conf.is_symlink() or self.conf.read_text() != new:
                fail('ROLLBACK_REVIEW_REQUIRED')
            if not self.link.is_symlink() or self.link.resolve() != self.conf:
                fail('ROLLBACK_REVIEW_REQUIRED')
            if old is None:
                self.link.unlink(); self.conf.unlink()
            else:
                self.write_config(old)
            self.call(['nginx', '-t'], check=False)
            self.call(['systemctl', 'reload', 'nginx'], check=False)
            fail('INSTALL_FAILED_ROLLED_BACK')
        print('GLOBAL_SITE_PORT_READY http://'+IP+':8898 backup='+str(backup))


def main(args=None):
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--execute', action='store_true'); mode.add_argument('--check', action='store_true')
    options = p.parse_args(args)
    if os.geteuid() != 0: fail('ROOT_REQUIRED')
    os.umask(0o077)
    tool = SitePort()
    if options.check:
        tool.preflight(); print('HOST_SITE_PORT_PREFLIGHT_VALID port=8898'); return
    tool.safe_parents(tool.backups)
    tool.backups.mkdir(parents=True, exist_ok=True, mode=0o700); tool.safe(tool.backups, True)
    fd = os.open(tool.backups/'site-port-8898.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        s = os.fstat(lock.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077: fail('PRIVATE_LOCK_REQUIRED')
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        tool.apply()


if __name__ == '__main__':
    try: main()
    except Exception as e:
        reason = str(e) if isinstance(e, RuntimeError) and str(e).startswith('HOST_SITE_PORT_') else 'HOST_SITE_PORT_FAILED'
        print(reason, file=sys.stderr); sys.exit(1)
