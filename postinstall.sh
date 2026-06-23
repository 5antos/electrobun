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

# Merge package/'s built contents up into this directory (overwriting the
# thin package.json with the real one) rather than wiping this directory
# and swapping package/ into its place - this script is itself a file
# inside this directory, still open while it's running, and Windows
# (unlike macOS/Linux) refuses to remove a directory with an open file
# handle inside it ("Device or resource busy").
cp -a package/. .
rm -rf package

echo "[electrobun fork] Done."
