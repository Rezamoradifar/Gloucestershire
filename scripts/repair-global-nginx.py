"""Repair only the four Global vhost entries verified in the server diagnostic."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time

CANONICAL = 'sites-available/globaldroptrade.com'
ACTIVE = 'sites-enabled/globaldroptrade.com'
EXTRAS = ['sites-enabled/globaldroptrade.com.bak.1792627288',
          'sites-enabled/globaldroptrade.com.bak.1792627441']
PINNED_HASHES = {
    CANONICAL: '3044f4ce95aff901ed6d55c4e7aad071569266a8ee18643e4aa24ee31800cc71',
    ACTIVE: 'bc9df09f34c714fcd443e41dcd0c7cab09525c780bab82e5263848a0b6da6d45',
    EXTRAS[0]: '3044f4ce95aff901ed6d55c4e7aad071569266a8ee18643e4aa24ee31800cc71',
    EXTRAS[1]: '1512c42eecee44c747c9b00d26c3eec6da071cfe5a7f630a5584bdc40fa73531',
}
HOSTS = {'globaldroptrade.com', 'www.globaldroptrade.com'}


class RepairError(Exception):
    pass


class GlobalNginxRepair:
    def __init__(self, prefix=Path('/'), expected=None, runner=subprocess.run,
                 owner_uid=0, pause=time.sleep, log=print):
        self.prefix = Path(prefix)
        self.nginx = self.prefix/'etc/nginx'
        self.releases = self.prefix/'var/www/globaldroptrade/releases'
        self.backup_root = self.prefix/'var/backups/globaldroptrade'
        self.expected = PINNED_HASHES if expected is None else expected
        self.runner, self.owner_uid, self.pause, self.log = runner, owner_uid, pause, log
        if set(self.expected) != set(PINNED_HASHES) or any(not re.fullmatch(r'[0-9a-f]{64}', h) for h in self.expected.values()):
            raise RepairError('INVALID_REPAIR_POLICY')

    def _path(self, name):
        return self.nginx/name

    def _safe(self, path, kind):
        try:
            s = path.lstat()
        except OSError:
            raise RepairError('REQUIRED_CONFIG_ENTRY_MISSING: '+path.name) from None
        valid = stat.S_ISLNK(s.st_mode) if kind == 'symlink' else stat.S_ISDIR(s.st_mode) if kind == 'directory' else stat.S_ISREG(s.st_mode)
        if not valid or s.st_uid != self.owner_uid or (kind != 'symlink' and s.st_mode & 0o022):
            raise RepairError('UNSAFE_CONFIG_ENTRY: '+path.name)

    def _command(self, args, timeout=15):
        try:
            return self.runner(args, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise RepairError('LOCAL_VERIFICATION_COMMAND_FAILED') from None

    def _check(self, strict):
        result = self._command(['nginx', '-t'])
        if result.returncode:
            raise RepairError('NGINX_CONFIGURATION_CHECK_FAILED')
        output = (result.stdout+result.stderr).decode('utf-8', errors='replace')
        if strict and re.search(r'conflicting server name "(?:www\.)?globaldroptrade\.com"', output, re.I):
            raise RepairError('GLOBAL_HOSTNAME_CONFLICT_REMAINS')

    def _curl(self, suffix):
        result = self._command(['curl', '--fail', '--silent', '--show-error',
                                '--noproxy', '*', '--connect-timeout', '3', '--max-time', '8',
                                '--resolve', 'globaldroptrade.com:443:127.0.0.1',
                                '--resolve', 'www.globaldroptrade.com:443:127.0.0.1',
                                'https://globaldroptrade.com'+suffix], timeout=10)
        if result.returncode:
            raise RepairError('LOCAL_HTTPS_VERIFICATION_FAILED')
        return result.stdout

    def _api_healthy(self):
        try:
            return json.loads(self._curl('/api/health')).get('status') == 'ok'
        except (RepairError, ValueError, AttributeError):
            return False

    def _directives(self, data, name):
        lexer = shlex.shlex(data.decode('utf-8'), posix=True, punctuation_chars='{};')
        lexer.whitespace_split = True
        lexer.commenters = '#'
        tokens = []
        for token in lexer:
            tokens.extend(token if token and all(c in '{};' for c in token) else [token])
        values = []
        for i, token in enumerate(tokens):
            if token == name and (i == 0 or tokens[i-1] in '{};'):
                end = i+1
                while end < len(tokens) and tokens[end] not in '{};':
                    end += 1
                if end >= len(tokens) or tokens[end] != ';':
                    raise RepairError('UNSUPPORTED_CONFIG_DIRECTIVE')
                values.append(tokens[i+1:end])
        return values

    def _global_names(self, data):
        if set(name for values in self._directives(data, 'server_name') for name in values) != HOSTS:
            raise RepairError('GLOBAL_ONLY_MANAGED_VHOST_REQUIRED')

    def _site_index(self, data):
        self._global_names(data)
        roots = {values[0] for values in self._directives(data, 'root') if len(values) == 1}
        if len(roots) != 1:
            raise RepairError('GLOBAL_ONLY_MANAGED_VHOST_REQUIRED')
        root = Path(roots.pop())
        if root.is_symlink() or root.parent != self.releases or not root.is_dir():
            raise RepairError('ACTIVE_MANAGED_RELEASE_REQUIRED')
        index = root/'index.html'
        if index.is_symlink() or not index.is_file():
            raise RepairError('ACTIVE_RELEASE_INDEX_REQUIRED')
        return index.read_bytes()

    def preflight(self):
        for directory in [self.nginx, self.nginx/'sites-available', self.nginx/'sites-enabled']:
            self._safe(directory, 'directory')
        self._safe(self._path(CANONICAL), 'file')
        active, canonical = self._path(ACTIVE), self._path(CANONICAL)
        normalized = active.is_symlink() and active.resolve() == canonical and not any(self._path(n).exists() or self._path(n).is_symlink() for n in EXTRAS)
        if normalized:
            self._safe(active, 'symlink')
            current = canonical.read_bytes()
        else:
            for name, expected in self.expected.items():
                self._safe(self._path(name), 'symlink' if name == EXTRAS[0] else 'file')
                if hashlib.sha256(self._path(name).read_bytes()).hexdigest() != expected:
                    raise RepairError('CONFIG_CHANGED_SINCE_DIAGNOSTIC: '+Path(name).name)
                self._global_names(self._path(name).read_bytes())
            if self._path(EXTRAS[0]).resolve() != canonical:
                raise RepairError('UNEXPECTED_BACKUP_SYMLINK_TARGET')
            current = active.read_bytes()
        index = self._site_index(current)
        self._check(strict=normalized)
        homepage = self._curl('/')
        if homepage != index:
            raise RepairError('ACTIVE_VHOST_DOES_NOT_MATCH_HTTPS')
        return {'alreadyNormalized': normalized, 'homepageHash': hashlib.sha256(homepage).hexdigest(), 'apiHealthy': self._api_healthy()}

    def _snapshot(self, report):
        self.backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._safe(self.backup_root, 'directory')
        backup = Path(tempfile.mkdtemp(prefix='nginx-enabled-'+time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())+'-', dir=self.backup_root))
        records = {}
        for name in self.expected:
            source, target = self._path(name), backup/'originals'/name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copy2(source, target, follow_symlinks=False)
            records[name] = {'kind': 'symlink' if source.is_symlink() else 'file',
                             'hash': hashlib.sha256(source.read_bytes()).hexdigest(),
                             'linkTarget': os.readlink(source) if source.is_symlink() else None}
        fd = os.open(backup/'manifest.json', os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump({'version': 1, 'files': records, 'report': report}, file, indent=2)
            file.flush()
            os.fsync(file.fileno())
        self._validated_snapshot(backup)
        return backup

    def _validated_snapshot(self, backup):
        backup = Path(backup)
        if backup.is_symlink() or backup.resolve().parent != self.backup_root.resolve():
            raise RepairError('UNSAFE_RESTORE_DIRECTORY')
        self._safe(backup, 'directory')
        if backup.stat().st_mode & 0o077:
            raise RepairError('PRIVATE_RESTORE_DIRECTORY_REQUIRED')
        self._safe(backup/'manifest.json', 'file')
        manifest = json.loads((backup/'manifest.json').read_text())
        if not isinstance(manifest, dict) or manifest.get('version') != 1 or not isinstance(manifest.get('files'), dict) or set(manifest['files']) != set(self.expected):
            raise RepairError('INVALID_RESTORE_MANIFEST')
        for name, record in manifest['files'].items():
            source = backup/'originals'/name
            kind = 'symlink' if name == EXTRAS[0] else 'file'
            self._safe(source, kind)
            if not isinstance(record, dict) or record.get('kind') != kind or record.get('hash') != self.expected[name]:
                raise RepairError('RESTORE_SNAPSHOT_MISMATCH')
            if kind == 'file' and hashlib.sha256(source.read_bytes()).hexdigest() != record['hash']:
                raise RepairError('RESTORE_SNAPSHOT_CHANGED')
            if kind == 'symlink' and (not isinstance(record.get('linkTarget'), str) or os.readlink(source) != record['linkTarget'] or (self._path(name).parent/record['linkTarget']).resolve() != self._path(CANONICAL)):
                raise RepairError('RESTORE_SYMLINK_MISMATCH')
        return manifest

    def restore(self, backup, reload=True):
        backup = Path(backup)
        self._validated_snapshot(backup)
        for directory in [self.nginx, self.nginx/'sites-available', self.nginx/'sites-enabled']:
            self._safe(directory, 'directory')
        # Stage outside active include directories; rename replaces symlinks themselves.
        with tempfile.TemporaryDirectory(prefix='.global-nginx-restore-', dir=self.nginx) as staging:
            for i, name in enumerate(self.expected):
                target = Path(staging)/str(i)
                shutil.copy2(backup/'originals'/name, target, follow_symlinks=False)
                os.replace(target, self._path(name))
        if reload:
            self._check(strict=False)
            if self._command(['systemctl', 'reload', 'nginx']).returncode:
                raise RepairError('RESTORED_CONFIG_RELOAD_FAILED')

    def apply(self):
        report = self.preflight()
        if report['alreadyNormalized']:
            return report
        backup = self._snapshot(report)
        self.log('NGINX_REPAIR_BACKUP='+str(backup))
        self.log('ROLLBACK_COMMAND=python3 '+str(Path(__file__).resolve())+' --restore '+str(backup))
        # A detected concurrent edit precedes our mutations; do not overwrite it by restoring.
        for name, expected in self.expected.items():
            self._safe(self._path(name), 'symlink' if name == EXTRAS[0] else 'file')
            if hashlib.sha256(self._path(name).read_bytes()).hexdigest() != expected:
                raise RepairError('CONFIG_CHANGED_DURING_BACKUP')
        self._validated_snapshot(backup)
        try:
            with tempfile.TemporaryDirectory(prefix='.global-nginx-repair-', dir=self.nginx) as staging:
                current = Path(staging)/'canonical'
                shutil.copy2(backup/'originals'/ACTIVE, current)
                os.replace(current, self._path(CANONICAL))
                link = Path(staging)/'enabled'
                link.symlink_to(self._path(CANONICAL))
                os.replace(link, self._path(ACTIVE))
                for name in EXTRAS:
                    self._path(name).unlink()
            self._check(strict=True)
            if self._command(['systemctl', 'reload', 'nginx']).returncode:
                raise RepairError('NGINX_RELOAD_FAILED')
            verified = False
            for attempt in range(3):
                try:
                    verified = hashlib.sha256(self._curl('/')).hexdigest() == report['homepageHash'] and (not report['apiHealthy'] or self._api_healthy())
                except RepairError:
                    verified = False
                if verified:
                    break
                if attempt < 2:
                    self.pause(1)
            if not verified:
                raise RepairError('HTTPS_CONTENT_OR_API_CHANGED')
            return {**report, 'backup': str(backup), 'repaired': True}
        except Exception as error:
            try:
                self.restore(backup)
            except Exception:
                raise RepairError('RESTORE_REQUIRES_REVIEW BACKUP='+str(backup)) from None
            message = str(error) if isinstance(error, RepairError) else 'LOCAL_REPAIR_OPERATION_FAILED'
            raise RepairError(message+'; ORIGINAL_CONFIG_RESTORED BACKUP='+str(backup)) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RepairError('ROOT_REQUIRED')
    repair = GlobalNginxRepair()
    if args.restore:
        repair.restore(args.restore)
        print('GLOBAL_NGINX_ORIGINAL_ENTRIES_RESTORED')
    else:
        report = repair.apply() if args.apply else repair.preflight()
        print('GLOBAL_NGINX_REPAIR_READY' if args.apply else 'GLOBAL_NGINX_REPAIR_PREFLIGHT_OK')
        print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (RepairError, OSError, ValueError):
        error = sys.exc_info()[1]
        print('GLOBAL_NGINX_REPAIR_STOPPED: '+(str(error) if isinstance(error, RepairError) else 'LOCAL_CONFIG_VALIDATION_FAILED'), file=sys.stderr)
        sys.exit(1)
