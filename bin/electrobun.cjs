#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const { existsSync, mkdirSync, unlinkSync, chmodSync, copyFileSync, createWriteStream, readFileSync, writeFileSync } = require('fs');
const { join, dirname } = require('path');
const https = require('https');
const ProxyAgent = require('proxy-agent').ProxyAgent;

// Create an HTTPS agent that respects environment proxy settings
const agent = new ProxyAgent();

// Detect platform and architecture
function getPlatform() {
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'darwin';
    case 'linux': return 'linux';
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getArch() {
  switch (process.arch) {
    case 'arm64': return 'arm64';
    case 'x64': return 'x64';
    default: throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}

const platform = getPlatform();
// Always use x64 for Windows since we only build x64 Windows binaries
const arch = platform === 'win' ? 'x64' : getArch();
const binExt = platform === 'win' ? '.exe' : '';

function getTarCommand() {
  if (platform !== 'win') {
    return 'tar';
  }

  // Git Bash tar can treat C:\... as a remote path. Force the built-in Windows tar.
  const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(systemTar) ? `"${systemTar}"` : 'tar';
}

// Paths
const electrobunDir = join(__dirname, '..');

async function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(filePath), { recursive: true });
    const file = createWriteStream(filePath);

    https.get(url, {agent}, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, filePath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureCliBinary() {
  // Get the package version to download the matching release — also used
  // below to decide whether an already-in-place binary is still current.
  const packageJson = require(join(electrobunDir, 'package.json'));
  const version = packageJson.version;

  const binLocation = join(electrobunDir, 'bin', 'electrobun' + binExt);
  const versionMarker = join(electrobunDir, 'bin', '.electrobun-version');

  // Only reuse a binary already sitting at binLocation if it was put there
  // for this exact version. Without this check, a version bump (e.g. via
  // `bun install` picking up a new pinned commit) would silently keep
  // running whatever CLI happened to be cached from before, with nothing
  // in the output to indicate it's stale — bumping the version alone
  // doesn't invalidate it.
  if (existsSync(binLocation) && existsSync(versionMarker)) {
    const cachedVersion = readFileSync(versionMarker, 'utf8').trim();
    if (cachedVersion === version) {
      return binLocation;
    }
  }

  // Cache dir is version-keyed for the same reason — an old extracted
  // binary from a previous version must never satisfy a lookup for the
  // current one.
  const cacheDir = join(electrobunDir, '.cache', version);
  const cliBinary = join(cacheDir, `electrobun${binExt}`);

  if (existsSync(cliBinary)) {
    // Already extracted under this version's cache dir — just (re)place it.
    mkdirSync(dirname(binLocation), { recursive: true });
    copyFileSync(cliBinary, binLocation);
    writeFileSync(versionMarker, version);
    if (platform !== 'win') {
      chmodSync(binLocation, '755');
    }
    return binLocation;
  }

  console.log('Downloading electrobun CLI for your platform...');

  const tag = `v${version}`;
  const tarballUrl = `https://github.com/5antos/electrobun/releases/download/${tag}/electrobun-cli-${platform}-${arch}.tar.gz`;
  const tarballPath = join(cacheDir, `electrobun-${platform}-${arch}.tar.gz`);

  try {
    // Download tarball
    await downloadFile(tarballUrl, tarballPath);

    // Extract using system tar (available on macOS, Linux, and Windows 10+)
    execSync(`${getTarCommand()} -xzf "${tarballPath}"`, { cwd: cacheDir, stdio: 'pipe' });

    // Clean up tarball
    unlinkSync(tarballPath);

    // Check if CLI binary was extracted
    if (!existsSync(cliBinary)) {
      throw new Error(`CLI binary not found at ${cliBinary} after extraction`);
    }

    // Make executable on Unix systems
    if (platform !== 'win') {
      chmodSync(cliBinary, '755');
    }

    // Copy CLI to bin location so npm scripts can find it
    mkdirSync(dirname(binLocation), { recursive: true });
    copyFileSync(cliBinary, binLocation);
    writeFileSync(versionMarker, version);

    // Make the bin location executable too
    if (platform !== 'win') {
      chmodSync(binLocation, '755');
    }

    console.log('electrobun CLI downloaded successfully!');
    return binLocation;

  } catch (error) {
    throw new Error(`Failed to download electrobun CLI: ${error.message}`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const cliPath = await ensureCliBinary();

    // Replace this process with the actual CLI
    const child = spawn(cliPath, args, {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    child.on('error', (error) => {
      console.error('Failed to start electrobun CLI:', error.message);
      process.exit(1);
    });

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
