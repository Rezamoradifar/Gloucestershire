#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run: sudo bash ubuntu-website.sh'; exit 1; }
command -v nginx >/dev/null || { echo 'Install nginx first: apt-get install -y nginx'; exit 1; }
stage_dir=$(mktemp -d)
trap 'rm -rf -- "$stage_dir"' EXIT
bash scripts/unpack-website.sh "$stage_dir"
tar -xzf "$stage_dir/website-release.tar.gz" -C "$stage_dir"
bash "$stage_dir/globaldroptrade-package/install.sh"
