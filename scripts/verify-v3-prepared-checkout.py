"""Accept only the clean, private dependency checkout created by the server wrapper."""
import os
from pathlib import Path
import re
import subprocess
import sys


def reject():
    sys.exit("UNIFIED_SITE_PREPARED_CHECKOUT_INVALID")


root = Path.cwd()
if root != root.resolve() or not re.fullmatch(r"/opt/global-v3-unified-run\.[A-Za-z0-9]{8}/release", str(root)):
    reject()
if not root.parent.is_dir() or root.parent.stat().st_uid != 0 or root.parent.stat().st_mode & 0o077:
    reject()
for part in (root, root / ".git", root / "node_modules", root / "website" / "node_modules"):
    if part.is_symlink() or not part.is_dir() or part.stat().st_uid != 0 or part.stat().st_mode & 0o022:
        reject()
if subprocess.run(["git", "diff", "--quiet", "HEAD", "--"]).returncode:
    reject()
untracked = subprocess.check_output(["git", "ls-files", "--others", "--directory",
                                     "--exclude=/node_modules/", "--exclude=/website/node_modules/", "-z"])
if untracked:
    reject()
