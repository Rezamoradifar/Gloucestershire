"""Atomic publication of a new verified preview or its operator-installed status page."""

import ctypes
import hashlib
import os
from pathlib import Path
import stat
import sys

RENAME_NOREPLACE = 1
RENAME_EXCHANGE = 2
AT_FDCWD = -100


def rename(source, target, flags):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, "renameat2", None)
    if fn is None:
        raise RuntimeError("UNIFIED_SITE_RENAME_UNAVAILABLE")
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(AT_FDCWD, os.fsencode(source), AT_FDCWD, os.fsencode(target), flags):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def matches_status(target, status):
    if target.is_symlink() or not target.is_dir():
        return False
    expected = status.read_bytes()
    if {item.name for item in target.iterdir()} != {"index.html"}:
        return False
    index = target / "index.html"
    for entry in (target, index):
        metadata = entry.lstat()
        if metadata.st_uid != os.geteuid() or metadata.st_mode & 0o022:
            return False
    metadata = index.lstat()
    return (stat.S_ISREG(metadata.st_mode) and metadata.st_size == len(expected)
            and index.read_bytes() == expected)


MANIFEST = ".global-v3-unified-release"


def release_digest(directory):
    result = hashlib.sha256()
    def add(path):
        st = path.lstat()
        if st.st_uid != os.geteuid() or st.st_mode & 0o022:
            raise ValueError("UNIFIED_SITE_RELEASE_PERMISSIONS_INVALID")
        name = path.relative_to(directory).as_posix().encode()
        result.update(len(name).to_bytes(4, "big") + name)
        if stat.S_ISDIR(st.st_mode):
            result.update(b"D")
            for child in sorted(path.iterdir()):
                if child != directory / MANIFEST:
                    add(child)
        elif stat.S_ISREG(st.st_mode):
            result.update(b"F" + hashlib.sha256(path.read_bytes()).digest())
        else:
            raise ValueError("UNIFIED_SITE_RELEASE_UNSAFE_FILE")
    add(directory)
    return result.hexdigest()


def marked_release(path):
    if path.is_symlink() or not path.is_dir():
        return False
    marker = path / MANIFEST
    if not marker.exists() or marker.is_symlink():
        return False
    info = marker.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o777 != 0o600
            or info.st_uid != os.geteuid() or info.st_size != 65):
        return False
    return marker.read_bytes() == (release_digest(path) + "\n").encode()


def mark_release(path):
    data = (release_digest(path) + "\n").encode()
    fd = os.open(path / MANIFEST, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as marker:
        marker.write(data)
        marker.flush()
        os.fsync(marker.fileno())


def identity(path):
    meta = path.lstat()
    return f"{meta.st_dev}:{meta.st_ino}"


def main():
    action, stage_name, target_name, status_name, previous_id = sys.argv[1:]
    stage, target, status = map(Path, (stage_name, target_name, status_name))
    if stage.parent != target.parent or target.name != "unified-test":
        raise ValueError("UNIFIED_SITE_ROUTE_INVALID")
    if action == "mark":
        mark_release(stage)
    elif action == "owned":
        if not (marked_release(target) or matches_status(target, status)):
            raise ValueError("UNIFIED_SITE_ROUTE_ALREADY_EXISTS")
    elif action == "install":
        if previous_id == "none":
            rename(stage, target, RENAME_NOREPLACE)
        elif identity(target) == previous_id and (matches_status(target, status) or marked_release(target)):
            rename(stage, target, RENAME_EXCHANGE)
        else:
            raise ValueError("UNIFIED_SITE_ROUTE_ALREADY_EXISTS")
    elif action == "rollback":
        if previous_id == "none":
            rename(target, stage, RENAME_NOREPLACE)
        elif identity(stage) == previous_id and (matches_status(stage, status) or marked_release(stage)):
            rename(stage, target, RENAME_EXCHANGE)
        else:
            raise ValueError("UNIFIED_SITE_ROLLBACK_REQUIRES_REVIEW")
    else:
        raise ValueError("UNIFIED_SITE_ACTION_INVALID")


if __name__ == "__main__":
    main()
