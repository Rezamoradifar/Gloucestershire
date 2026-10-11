#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Assets are committed directly; this check does not overwrite edited artwork.
for image in commerce-world.webp commerce-story.webp model-dropshipping-640.webp model-dropshipping-1280.webp model-arbitrage-640.webp model-arbitrage-1280.webp model-ai-640.webp model-ai-1280.webp intelligence-earth-640.webp intelligence-earth-1280.webp opportunity-projector-640.webp opportunity-projector-1280.webp; do
 test -s "$repo_dir/website/public/assets/$image" || { echo "Missing website asset: $image"; exit 1; }
done
