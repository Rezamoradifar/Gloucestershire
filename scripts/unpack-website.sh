#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
output_dir=${1:?Pass an output directory}
mkdir -p "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd)
cat "$repo_dir"/website-release-parts/*.b64 | base64 --decode > "$output_dir/website-release.tar.gz"
(cd "$output_dir" && sha256sum -c "$repo_dir/website-release.sha256")
