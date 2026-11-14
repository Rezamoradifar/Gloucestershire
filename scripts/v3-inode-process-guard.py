#!/usr/bin/env python3
"""Refuse cleanup when a Linux process might still use an old release."""
import os
import sys
from pathlib import Path


def in_release(value: str, release: str) -> bool:
    value = value.removesuffix(' (deleted)')
    return value == release or value.startswith(release + '/')


def check(release: str, proc: Path = Path('/proc')) -> int:
    target = os.path.realpath(release)
    try:
        processes = list(proc.iterdir())
    except OSError:
        print('PROCESS_CHECK_UNAVAILABLE')
        return 2
    for process in processes:
        if not process.name.isdigit() or (proc == Path('/proc') and int(process.name) == os.getpid()):
            continue
        try:
            command = (process / 'cmdline').read_bytes()
        except FileNotFoundError:
            continue
        except OSError:
            print('PROCESS_CHECK_UNAVAILABLE')
            return 2
        # The caller's timeout wrapper necessarily has the release argument;
        # it is not a consumer, but its cwd and open files are still checked.
        first = os.path.basename(os.fsdecode(command.split(b'\0', 1)[0]))
        own_timeout = (proc == Path('/proc') and int(process.name) == os.getppid()
                       and first == 'timeout' and b'v3-inode-process-guard.py' in command)
        if os.fsencode(target) in command and not own_timeout:
            print('RELEASE_IN_USE_PID=' + process.name)
            return 1
        # A kernel thread has an empty command line and no user-space files.
        if not command:
            continue
        try:
            for entry in (process / 'cwd', process / 'exe'):
                try:
                    if in_release(os.readlink(entry), target):
                        print('RELEASE_IN_USE_PID=' + process.name)
                        return 1
                except FileNotFoundError:
                    pass
            for fd in (process / 'fd').iterdir():
                try:
                    if in_release(os.readlink(fd), target):
                        print('RELEASE_IN_USE_PID=' + process.name)
                        return 1
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            continue
        except OSError:
            print('PROCESS_CHECK_UNAVAILABLE')
            return 2
    print('RELEASE_NOT_IN_USE')
    return 0


def check_web_links(release: str, webroot: Path = Path('/var/www')) -> int:
    target = os.path.realpath(release)
    if not webroot.exists():
        print('WEBROOT_NOT_PRESENT')
        return 0
    if in_release(os.path.realpath(webroot), target):
        print('RELEASE_IS_WEBROOT')
        return 1

    def onerror(error: OSError) -> None:
        raise error

    try:
        for parent, directories, files in os.walk(webroot, followlinks=False, onerror=onerror):
            for name in directories + files:
                path = Path(parent) / name
                if path.is_symlink() and in_release(os.path.realpath(path), target):
                    print('RELEASE_REFERENCED_BY_WEBROOT')
                    return 1
    except OSError:
        print('WEBROOT_CHECK_UNAVAILABLE')
        return 2
    print('WEBROOT_LINKS_CLEAR')
    return 0


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--web-links' and os.path.isabs(sys.argv[2]):
        raise SystemExit(check_web_links(sys.argv[2]))
    if len(sys.argv) != 2 or not os.path.isabs(sys.argv[1]):
        print('PROCESS_CHECK_INVALID_ARGUMENT')
        raise SystemExit(2)
    raise SystemExit(check(sys.argv[1]))
