#!/bin/bash
# See the comment in package.json - lets a consumer depend on this fork
# directly via a github: dependency (with "electrobun" in their own
# trustedDependencies) and get a normal, working install, no custom script
# of their own needed.
#
# Plain bash on purpose, not a bun script wrapping build.ts via spawnSync -
# that extra nested-bun-process layer reliably crashes Bun's own shell engine
# partway through build.ts's native build (internal "fd: 0, syscall: TODO"
# error). Invoking bun build.ts directly from a shell, like this, doesn't
# hit it.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ ! -d "package" ]; then
	# Already promoted (e.g. a second install in the same tree) - nothing to do.
	exit 0
fi

echo "[electrobun fork] Building from source..."

(cd package && bun install && bun build.ts)

TMP="${ROOT}-built-tmp"
rm -rf "$TMP"
mv package "$TMP"
cd "$(dirname "$ROOT")"
rm -rf "$ROOT"
mv "$TMP" "$ROOT"

if [ -f "$ROOT/bin/electrobun.cjs" ]; then
	mkdir -p "$ROOT/../.bin"
	ln -sf "../electrobun/bin/electrobun.cjs" "$ROOT/../.bin/electrobun"
fi

echo "[electrobun fork] Done."
