#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
stage_dir=$(mktemp -d)
trap 'rm -rf -- "$stage_dir"' EXIT
bash "$repo_dir/scripts/unpack-website.sh" "$stage_dir"
mkdir -p "$repo_dir/website/public/assets"
tar -xOf "$stage_dir/website-release.tar.gz" globaldroptrade-package/site/assets/global-trade-hero.png > "$stage_dir/hero.png"
mv "$stage_dir/hero.png" "$repo_dir/website/public/assets/global-trade-hero.png"
