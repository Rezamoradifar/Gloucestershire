#!/usr/bin/env python3
"""Verify private input, atomic preservation and terminal echo behavior."""
import fcntl
import importlib.util
import os
from pathlib import Path
import pty
import select
import signal
import stat
import subprocess
import sys
import tempfile
import termios
import time

source = Path(__file__).with_name('save-zero-archive-rpc.py')
spec = importlib.util.spec_from_file_location('private_archive_input', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def terminal_run(file, secret, cancel=False):
    master, slave = pty.openpty()
    code = 'import runpy,sys; v=runpy.run_path(sys.argv[1]);sys.exit(v["main"](sys.argv[2]))'

    def attach_terminal():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    process = subprocess.Popen([sys.executable, '-c', code, str(source), str(file)], stdin=slave, stdout=slave, stderr=slave, preexec_fn=attach_terminal, close_fds=True)
    os.close(slave)
    output = b''
    deadline = time.monotonic() + 10
    sent = False
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output += chunk
                if b'(hidden): ' in output and not sent:
                    # The prompt appears only after getpass has disabled echo.
                    if cancel == 'term':
                        process.send_signal(signal.SIGTERM)
                    else:
                        os.write(master, b'\x03' if cancel else secret.encode('utf-8') + b'\n')
                    sent = True
            if process.poll() is not None:
                try:
                    while select.select([master], [], [], 0)[0]:
                        output += os.read(master, 65536)
                except OSError:
                    pass
                break
        assert sent, output
        assert process.wait(timeout=2) in (0, 1)
        assert termios.tcgetattr(master)[3] & termios.ECHO, 'Terminal echo was not restored'
        return process.returncode, output.decode('utf-8', errors='replace')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)


assert os.geteuid() == 0, 'Run this isolated host test as root'
with tempfile.TemporaryDirectory(prefix='global-archive-input-test-') as temporary:
    directory = Path(temporary)
    file = directory / 'archive-rpc-url'
    secret = 'https://archive.example.invalid/v2/private-token?project=private-project'
    for invalid in ['', 'http://archive.invalid', 'https://user:password@archive.invalid', 'https://@archive.invalid', 'https://archive.invalid/#', 'https://archive.invalid/"\nINJECT=1', 'https://archive.invalid/back\\slash', 'https://archive.invalid:bad', 'https://archive.invalid/with space', 'https://archive.invalid/\x81secret']:
        try:
            module.save_candidate(file, invalid)
            raise AssertionError('Invalid private RPC accepted')
        except ValueError:
            pass
        assert not file.exists()
    result, output = terminal_run(file, secret)
    assert result == 0 and 'ARCHIVE_RPC_PRIVATE_INPUT_SAVED' in output, output
    assert secret not in output and 'private-token' not in output and 'private-project' not in output, output
    assert file.read_bytes() == (secret + '\n').encode()
    assert stat.S_IMODE(file.stat().st_mode) == 0o600
    old = file.read_bytes()
    before = file.stat().st_ino
    module.save_candidate(file, secret)
    assert file.stat().st_ino == before
    result, output = terminal_run(file, 'https://archive.invalid/"bad')
    assert result != 0 and file.read_bytes() == old
    assert '"bad' not in output
    result, output = terminal_run(file, '', cancel=True)
    assert result != 0 and file.read_bytes() == old
    result, output = terminal_run(file, '', cancel='term')
    assert result != 0 and file.read_bytes() == old
    file.chmod(0o644)
    try:
        module.save_candidate(file, 'https://other.invalid/v2/another-private-token')
        raise AssertionError('Non-private existing file accepted')
    except ValueError:
        pass
    assert file.read_bytes() == old
    file.chmod(0o600)
    replacement = 'https://other.invalid/v2/another-private-token'
    module.save_candidate(file, replacement)
    assert file.read_text() == replacement + '\n'
    backups = list(directory.glob('.archive-rpc-previous-*'))
    assert len(backups) == 1 and backups[0].read_bytes() == old and stat.S_IMODE(backups[0].stat().st_mode) == 0o600
    link = directory / 'linked-rpc'
    link.symlink_to(file)
    try:
        module.save_candidate(link, secret)
        raise AssertionError('Symbolic candidate file accepted')
    except OSError:
        pass
    assert file.read_text() == replacement + '\n'
    directory.chmod(0o777)
    try:
        module.save_candidate(file, secret)
        raise AssertionError('Writable input directory accepted')
    except ValueError:
        pass
    directory.chmod(0o700)
print('PRIVATE_ARCHIVE_RPC_INPUT_TESTS_PASSED')
