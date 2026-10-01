#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Assets are committed directly; this check does not overwrite edited artwork.
for image in commerce-world.webp commerce-story.webp; do
 test -s "$repo_dir/website/public/assets/$image" || { echo "Missing website asset: $image"; exit 1; }
done
