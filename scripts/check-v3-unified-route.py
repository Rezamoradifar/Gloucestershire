"""Check the entry module, initial styles and the lazy-loaded dashboard against the build."""

from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys

ROUTE = "https://globaldroptrade.com/unified-test/"
RELATIVE_ASSET = re.compile(r"(?:\./)?(assets/[\w.-]+\.(?:js|css))", re.ASCII)


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.modules = set()
        self.styles = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "module":
            self.modules.add(attrs.get("src", ""))
        elif tag == "link" and attrs.get("rel") in ("stylesheet", "modulepreload"):
            (self.styles if attrs["rel"] == "stylesheet" else self.modules).add(attrs.get("href", ""))


def check(dist, tmpdir, base_url=ROUTE, resolver=("globaldroptrade.com:443:127.0.0.1",)):
    parser = EntryAssets()
    parser.feed((dist / "index.html").read_text(encoding="utf-8"))
    if not parser.modules:
        raise ValueError("UNIFIED_SITE_ENTRY_INVALID")
    chunks = list((dist / "assets").glob("V3Dashboard-*.js"))
    if not chunks:
        raise ValueError("UNIFIED_SITE_DASHBOARD_CHUNK_MISSING")
    names = {name: ".js" for name in parser.modules}
    names.update({name: ".css" for name in parser.styles})
    names.update({p.relative_to(dist).as_posix(): ".js" for p in chunks})
    for name, suffix in sorted(names.items()):
        asset = RELATIVE_ASSET.fullmatch(name)
        if not asset or not name.endswith(suffix):
            raise ValueError("UNIFIED_SITE_ENTRY_INVALID")
        asset_path = asset.group(1)
        expected = dist / asset_path
        if expected.is_symlink() or not expected.is_file():
            raise ValueError("UNIFIED_SITE_ENTRY_MISSING")
        body = tmpdir / "served-asset"
        args = ["curl", "-fsS", "--noproxy", "*", "--max-time", "15"]
        for item in resolver:
            args.extend(["--resolve", item])
        args.extend(["-o", str(body), "-w", "%{content_type}", base_url + asset_path])
        mime = subprocess.check_output(args, text=True).partition(";")[0].strip().lower()
        allowed = {"application/javascript", "text/javascript"} if suffix == ".js" else {"text/css"}
        if mime not in allowed or body.read_bytes() != expected.read_bytes():
            raise ValueError("UNIFIED_SITE_ASSET_NOT_SERVED: " + asset_path)


if __name__ == "__main__":
    try:
        args = sys.argv[3:]
        if args not in ([], ["--single-capital"], ["--daily-capital"], ["--referral-profit"], ["--manual-reinvest"], ["--upline-rates"], ["--account-reinvest"], ["--portfolio"], ["--plan-portfolio"], ["--primary"]):
            raise ValueError("UNIFIED_SITE_ROUTE_INVALID")
        route = "https://globaldroptrade.com/" if args == ["--primary"] else (
            "https://globaldroptrade.com/" + args[0][2:] + "-test/" if args else ROUTE)
        check(Path(sys.argv[1]), Path(sys.argv[2]), route)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
