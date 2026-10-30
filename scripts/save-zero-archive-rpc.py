#!/usr/bin/env python3
"""Save an explicitly supplied archive RPC without echoing its credentials."""
import getpass
import os
from pathlib import Path
import stat
import signal
import sys
import tempfile
from urllib.parse import urlsplit
import unicodedata
import warnings

candidate_file = Path('/etc/globaldroptrade/archive-rpc-url')
maximum_bytes = 16384


def validate_url(value):
    if not isinstance(value, str) or not value or len(value.encode('utf-8')) > maximum_bytes:
        raise ValueError('ARCHIVE_RPC_HTTPS_URL_REQUIRED')
    if any(character.isspace() or unicodedata.category(character) == 'Cc' or character in '\\"\'' for character in value) or '#' in value:
        raise ValueError('ARCHIVE_RPC_HTTPS_URL_REQUIRED')
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme == 'https' and bool(parsed.hostname) and '@' not in parsed.netloc
        parsed.port
    except (ValueError, UnicodeError):
        valid = False
    if not valid:
        raise ValueError('ARCHIVE_RPC_HTTPS_URL_REQUIRED')
    return value


def private_existing(file):
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > maximum_bytes:
            raise ValueError('PRIVATE_ARCHIVE_RPC_FILE_REQUIRED')
        return source.read()


def private_write(directory, prefix, value):
    fd, filename = tempfile.mkstemp(dir=directory, prefix=prefix)
    try:
        with os.fdopen(fd, 'wb') as destination:
            os.fchmod(destination.fileno(), 0o600)
            destination.write(value)
            destination.flush()
            os.fsync(destination.fileno())
    except BaseException:
        os.unlink(filename)
        raise
    return Path(filename)


def save_candidate(file, value):
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    value = validate_url(value)
    data = (value + '\n').encode('utf-8')
    if len(data) > maximum_bytes:
        raise ValueError('ARCHIVE_RPC_HTTPS_URL_REQUIRED')
    file = Path(file)
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = file.parent.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_mode & 0o022:
        raise ValueError('PRIVATE_ARCHIVE_RPC_DIRECTORY_REQUIRED')
    original = private_existing(file)
    if original == data:
        return
    temporary = private_write(file.parent, '.archive-rpc-input-', data)
    try:
        if private_existing(file) != original:
            raise ValueError('ARCHIVE_RPC_INPUT_CHANGED')
        if original is not None:
            private_write(file.parent, '.archive-rpc-previous-', original)
        os.replace(temporary, file)
        descriptor = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def main(file=candidate_file, prompt='BNB Testnet 97 archive HTTPS RPC URL (hidden): '):
    handlers = {}

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    try:
        if os.geteuid() != 0:
            raise ValueError('ROOT_REQUIRED')
        for signum in (signal.SIGTERM, signal.SIGHUP):
            handlers[signum] = signal.signal(signum, interrupted)
        with open('/dev/tty', 'w') as terminal:
            if not os.isatty(terminal.fileno()):
                raise ValueError('INTERACTIVE_TTY_REQUIRED')
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                value = getpass.getpass(prompt, stream=terminal)
        save_candidate(file, value)
        print('ARCHIVE_RPC_PRIVATE_INPUT_SAVED')
        return 0
    except (Exception, KeyboardInterrupt):
        print('ARCHIVE_RPC_PRIVATE_INPUT_NOT_SAVED', file=sys.stderr)
        return 1
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)


if __name__ == '__main__':
    if len(sys.argv) != 1:
        print('USAGE_SAVE_ZERO_ARCHIVE_RPC_WITHOUT_ARGUMENTS', file=sys.stderr)
        sys.exit(1)
    sys.exit(main())
