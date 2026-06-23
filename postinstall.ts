// Lets a consumer depend on this fork directly via a github: dependency (with
// "electrobun" listed in their own trustedDependencies) and get a normal,
// working install - no custom script of their own needed.
//
// This repo is a monorepo; the actual electrobun npm package lives in
// package/, alongside unrelated stuff (kitchen/, docs/, templates/...). Two
// things require package/'s built contents to end up as THIS package's own
// root, not nested under a package/ subdirectory:
//   1. Module resolution ("electrobun/bun" etc.) follows this package.json's
//      own "exports" field, which is relative to wherever that file sits.
//   2. Electrobun's own CLI (package/src/cli/index.ts, resolveElectrobunDir)
//      walks up from cwd for the nearest node_modules/electrobun/package.json
//      and then expects dist-<platform>/ as ITS sibling. If a package.json
//      existed here while dist-<platform>/ was still one level down inside
//      package/, the CLI would conclude the native build is "missing" and
//      silently download the unpatched upstream binary instead of using ours.
//
// So: build package/ from source, then promote its contents to fully replace
// this repo's own root (deleting everything else - kitchen/, docs/, etc. -
// none of it is needed by a consumer). Also repairs node_modules/.bin/electrobun
// afterward, since bun computes that symlink from THIS script's package.json
// (which has no "bin" field) before this script ever runs.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = import.meta.dir;
const pkgDir = join(root, "package");

if (!existsSync(pkgDir)) {
	// Already promoted (e.g. a second install in the same tree) - nothing to do.
	process.exit(0);
}

console.log("[electrobun fork] Building from source...");

const install = Bun.spawnSync(["bun", "install"], {
	cwd: pkgDir,
	stdio: ["inherit", "inherit", "inherit"],
});
if (install.exitCode !== 0) {
	console.error("[electrobun fork] bun install failed in package/");
	process.exit(install.exitCode ?? 1);
}

const build = Bun.spawnSync(["bun", "build.ts"], {
	cwd: pkgDir,
	stdio: ["inherit", "inherit", "inherit"],
});
if (build.exitCode !== 0) {
	console.error("[electrobun fork] bun build.ts failed in package/");
	process.exit(build.exitCode ?? 1);
}

const tmpDir = `${root}-built-tmp`;
await Bun.$`rm -rf ${tmpDir}`;
await Bun.$`mv ${pkgDir} ${tmpDir}`;
await Bun.$`rm -rf ${root}`;
await Bun.$`mv ${tmpDir} ${root}`;

const binShim = join(root, "bin", "electrobun.cjs");
if (existsSync(binShim)) {
	const binDir = join(root, "..", ".bin");
	await Bun.$`mkdir -p ${binDir}`;
	await Bun.$`ln -sf ${relative(binDir, binShim)} ${join(binDir, "electrobun")}`;
}

console.log("[electrobun fork] Done.");
