"""Archive the previous hourly account and atomically publish the verified account."""

import argparse
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import tempfile


def sibling_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


atomic = sibling_module("publish-v3-unified-route.py", "atomic_release")
http = sibling_module("check-v3-unified-route.py", "served_release")
HISTORY = "previous-hourly-test"
OLD_VAULT = "0x4f2777861cc5bdd0d6aed86014ce1370bf823884"
ACTIVE_URL = "https://globaldroptrade.com/hourly-test/"
HISTORY_URL = "https://globaldroptrade.com/previous-hourly-test/"


def index_hash(directory):
    return hashlib.sha256((directory / "index.html").read_bytes()).hexdigest()


def verify_http(dist, work, url):
    served = work / "served-index"
    subprocess.run(["curl", "-fsS", "--noproxy", "*", "--max-time", "15",
                    "--resolve", "globaldroptrade.com:443:127.0.0.1", url,
                    "-o", str(served)], check=True)
    if served.read_bytes() != (dist / "index.html").read_bytes():
        raise ValueError("GLOBAL_HOURLY_ACCOUNT_NOT_SERVED")
    http.check(dist, work, url)


def publish(root, dist, expected_index, verify=verify_http):
    metadata = root.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid()
            or metadata.st_mode & 0o022):
        raise ValueError("GLOBAL_HOURLY_ROOT_UNSAFE")
    target, history = root / "hourly-test", root / HISTORY
    original = atomic.release_digest(target)
    if index_hash(target) != expected_index:
        raise ValueError("GLOBAL_HOURLY_SOURCE_CHANGED")
    build_digest = atomic.release_digest(dist)
    if history.exists() or history.is_symlink():
        if not atomic.marked_release(history):
            raise ValueError("GLOBAL_HOURLY_HISTORY_NOT_OWNED")
        if not (atomic.marked_release(target) or original == atomic.release_digest(history)):
            raise ValueError("GLOBAL_HOURLY_TARGET_NOT_OWNED")
    else:
        if not any(OLD_VAULT in asset.read_text().lower()
                   for asset in (target / "assets").glob("*.js")):
            raise ValueError("GLOBAL_HOURLY_PREVIOUS_ACCOUNT_INVALID")
        with tempfile.TemporaryDirectory(prefix=".global-hourly-history.", dir=root) as temp:
            snapshot = Path(temp) / "site"
            shutil.copytree(target, snapshot)
            if (atomic.release_digest(snapshot) != original
                    or atomic.release_digest(target) != original):
                raise ValueError("GLOBAL_HOURLY_SOURCE_CHANGED")
            atomic.mark_release(snapshot)
            atomic.rename(snapshot, history, atomic.RENAME_NOREPLACE)
    with tempfile.TemporaryDirectory(prefix=".global-hourly-account.", dir=root) as temp:
        work, stage = Path(temp), Path(temp) / "site"
        verify(history, work, HISTORY_URL)
        shutil.copytree(dist, stage)
        if atomic.release_digest(stage) != build_digest:
            raise ValueError("GLOBAL_HOURLY_BUILD_CHANGED")
        for entry in (stage, *stage.rglob("*")):
            entry.chmod(0o755 if entry.is_dir() else 0o644)
        atomic.mark_release(stage)
        if atomic.release_digest(target) != original:
            raise ValueError("GLOBAL_HOURLY_SOURCE_CHANGED")
        atomic.rename(stage, target, atomic.RENAME_EXCHANGE)
        try:
            verify(dist, work, ACTIVE_URL)
        except BaseException:
            atomic.rename(stage, target, atomic.RENAME_EXCHANGE)
            raise
    return history


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-root", required=True, type=Path)
    parser.add_argument("--dist", required=True, type=Path)
    parser.add_argument("--expected-hourly-index", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or platform.node().split(".")[0] != "vps-luna-2585":
        raise ValueError("GLOBAL_HOURLY_WRONG_SERVER")
    state = Path("/var/lib/globaldroptrade/v3-hourly-testnet")
    metadata = state.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
            or metadata.st_mode & 0o022):
        raise ValueError("GLOBAL_HOURLY_STATE_UNSAFE")
    descriptor = os.open(state / "site-install.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as lock:
        metadata = os.fstat(lock.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_mode & 0o077):
            raise ValueError("GLOBAL_HOURLY_LOCK_UNSAFE")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publish(args.site_root, args.dist, args.expected_hourly_index)
    print("GLOBAL_HOURLY_ACCOUNT_AVAILABLE=" + ACTIVE_URL)
    print("GLOBAL_HOURLY_HISTORY_AVAILABLE=" + HISTORY_URL)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        message = str(error)
        raise SystemExit(message if message.startswith(("GLOBAL_", "UNIFIED_"))
                         else "GLOBAL_HOURLY_PUBLICATION_FAILED") from None
