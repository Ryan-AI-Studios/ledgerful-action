import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

export interface AssetInfo {
  assetName: string;
  checksumAssetName: string;
  executableName: string;
  needsTar: boolean;
  needsZip: boolean;
}

export function getAssetInfo(): AssetInfo {
  const platform = process.platform;
  const arch = process.arch;

  let targetTriple = "";
  let executableName = "ledgerful";
  let needsTar = true;
  let needsZip = false;

  if (platform === "linux" && arch === "x64") {
    targetTriple = "x86_64-unknown-linux-gnu";
  } else if (platform === "darwin" && arch === "x64") {
    targetTriple = "x86_64-apple-darwin";
  } else if (platform === "darwin" && arch === "arm64") {
    targetTriple = "aarch64-apple-darwin";
  } else if (platform === "win32" && arch === "x64") {
    targetTriple = "x86_64-pc-windows-msvc";
    executableName = "ledgerful.exe";
    needsTar = false;
    needsZip = true;
  } else {
    throw new Error(
      `Unsupported runner platform/arch: ${platform}/${arch}. ` +
        `Ledgerful binaries are available for x86_64-unknown-linux-gnu, ` +
        `x86_64-apple-darwin, aarch64-apple-darwin, and x86_64-pc-windows-msvc.`,
    );
  }

  const baseName = `ledgerful-${targetTriple}`;
  const assetName = needsTar ? `${baseName}.tar.gz` : `${baseName}.zip`;
  const checksumAssetName = needsTar
    ? `${baseName}.tar.gz.sha256`
    : `${baseName}.zip.sha256`;
  return {
    assetName,
    checksumAssetName,
    executableName,
    needsTar,
    needsZip,
  };
}

const VERSION_TAG_RE = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

export function validateVersionTag(version: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  if (!VERSION_TAG_RE.test(tag)) {
    throw new Error(
      `Invalid ledgerful-version "${version}". ` +
        `Expected a SemVer release tag like v0.1.8 or v0.1.8-beta.1.`,
    );
  }
  return tag;
}

export function getReleaseAssetUrl(version: string, assetName: string): string {
  const tag = validateVersionTag(version);
  return `https://github.com/Ryan-AI-Studios/Ledgerful/releases/download/${tag}/${assetName}`;
}

export async function downloadAuthenticated(
  url: string,
  token: string | undefined,
): Promise<string> {
  if (!token) {
    return tc.downloadTool(url);
  }
  return tc.downloadTool(url, undefined, undefined, {
    Authorization: `Bearer ${token}`,
    Accept: "application/octet-stream",
  });
}

export function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): void {
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  if (actual !== expectedChecksum.toLowerCase().trim()) {
    throw new Error(
      `Checksum mismatch for ${path.basename(filePath)}. ` +
        `Expected ${expectedChecksum}, got ${actual}. ` +
        `The downloaded binary may be corrupted or tampered with.`,
    );
  }
}

function resolveBinaryPath(cacheDir: string, executableName: string): string | null {
  // The release archive may extract the binary at the root OR inside a
  // top-level directory (e.g. ledgerful-x86_64-unknown-linux-gnu/ledgerful).
  // Check root first, then one level down.
  const rootPath = path.join(cacheDir, executableName);
  if (fs.existsSync(rootPath)) return rootPath;

  const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nestedPath = path.join(cacheDir, entry.name, executableName);
      if (fs.existsSync(nestedPath)) return nestedPath;
    }
  }
  return null;
}

async function downloadAndCache(
  version: string,
  checksum: string,
  token: string | undefined,
): Promise<{ binaryPath: string; info: AssetInfo }> {
  const info = getAssetInfo();
  // Include the checksum in the cache identity so a cache hit for the same
  // version but a DIFFERENT checksum does not reuse a mismatched binary.
  const cacheName = `ledgerful-${version}-${info.assetName}`;
  const cacheVersion = `${version}-${checksum.toLowerCase().trim().slice(0, 16)}`;
  const cached = tc.find(cacheName, cacheVersion);

  let binaryDir = "";
  if (cached) {
    core.info(`Found cached Ledgerful ${version} for ${info.assetName}`);
    binaryDir = cached;
  } else {
    core.info(`Downloading Ledgerful ${version} ${info.assetName}`);
    const assetUrl = getReleaseAssetUrl(version, info.assetName);
    const checksumUrl = getReleaseAssetUrl(version, info.checksumAssetName);

    const checksumFile = await downloadAuthenticated(checksumUrl, token);
    const checksumLine = fs.readFileSync(checksumFile, "utf8").trim();
    const publishedChecksum = checksumLine.split(/\s+/)[0] ?? "";
    if (!publishedChecksum) {
      throw new Error(`Could not parse checksum from ${checksumUrl}`);
    }
    if (publishedChecksum !== checksum.toLowerCase().trim()) {
      throw new Error(
        `Pinned checksum does not match release checksum for ${info.assetName}. ` +
          `Expected ${checksum}, release publishes ${publishedChecksum}. ` +
          `Update the ledgerful-checksum input to the correct value for the runner OS/arch.`,
      );
    }

    const assetFile = await downloadAuthenticated(assetUrl, token);
    verifyChecksum(assetFile, checksum);

    let extractedDir = "";
    if (info.needsTar) {
      extractedDir = await tc.extractTar(assetFile);
    } else if (info.needsZip) {
      extractedDir = await tc.extractZip(assetFile);
    }
    if (!extractedDir) {
      throw new Error(`Failed to extract ${info.assetName}`);
    }

    binaryDir = await tc.cacheDir(extractedDir, cacheName, cacheVersion);
  }

  const binaryPath = resolveBinaryPath(binaryDir, info.executableName);
  if (!binaryPath) {
    throw new Error(
      `Ledgerful binary not found at expected path: ${binaryDir} (looked for ${info.executableName} at root and one level down)`,
    );
  }

  // The checksum is of the release archive (.tar.gz/.zip), verified above on
  // download (line 138). The extracted executable has a different hash than the
  // archive, so we do NOT re-verify the executable against the archive checksum.
  // Supply-chain integrity is established by the archive checksum + the release's
  // cosign/SLSA attestation (verified out of band by the consumer if desired).
  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  return { binaryPath, info };
}

export async function installLedgerful(
  version: string,
  checksum: string,
  token: string | undefined,
): Promise<string> {
  const { binaryPath } = await downloadAndCache(version, checksum, token);
  core.info(`Verified Ledgerful binary: ${binaryPath}`);
  return binaryPath;
}
