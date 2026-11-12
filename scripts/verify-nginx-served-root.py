#!/usr/bin/env python3
"""Discover the exact static website root from a validated nginx -T dump.

This is intentionally read-only: never guess a root or choose one when
the locally served index cannot be compared byte-for-byte with exactly
one root declared by nginx. Nginx rewrite/sub_filter/proxy configurations
that do not serve index.html directly require operator review.
"""
import argparse
import os
from pathlib import Path
import re
import stat
import sys


class SiteRootError(Exception):
    pass


def candidates(config: str):
    """Only absolute literal root/alias directives, not expansions or guesses."""
    roots = []
    for m in re.finditer(r"(?m)^\s*(?:root|alias)\s+([^;\r\n]+)\s*;", config):
        value = m.group(1).strip().strip("'\"")
        if not value.startswith("/") or "$" in value or "\x00" in value:
            continue
        directory = Path(os.path.normpath(value))
        if directory not in roots:
            roots.append(directory)
    return roots


def find_served_root(config: str, html: bytes):
    if not html:
        raise SiteRootError("EVENT_HISTORY_SERVED_HTML_EMPTY")
    configured = candidates(config)
    if not configured:
        raise SiteRootError("EVENT_HISTORY_NGINX_ROOT_DIRECTIVE_NOT_FOUND")
    matches = []
    for directory in configured:
        index = directory / "index.html"
        try:
            # We will deploy into this directory: refuse any symlink switch.
            d = directory.lstat()
            f = index.lstat()
            if not stat.S_ISDIR(d.st_mode) or not stat.S_ISREG(f.st_mode):
                continue
            if d.st_uid != 0 or f.st_uid != 0:
                continue
            if d.st_mode & 0o022 or f.st_mode & 0o022:
                continue
            if index.read_bytes() == html:
                matches.append(directory)
        except (OSError, ValueError):
            continue
    if len(matches) != 1:
        if not matches:
            raise SiteRootError("EVENT_HISTORY_SITE_ROOT_NOT_VERIFIED")
        raise SiteRootError("EVENT_HISTORY_AMBIGUOUS_SITE_ROOT")
    return matches[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--nginx-config", type=Path, required=True)
    parser.add_argument("--served", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = args.nginx_config.read_text(encoding="utf-8", errors="replace")
        html = args.served.read_bytes()
        root = find_served_root(config, html)
    except SiteRootError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    except OSError:
        print("EVENT_HISTORY_SITE_DISCOVERY_READ_FAILED", file=sys.stderr)
        sys.exit(1)
    print(root)


if __name__ == "__main__":
    main()
