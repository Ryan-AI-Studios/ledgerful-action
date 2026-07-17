import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tc from "@actions/tool-cache";
import {
  getAssetInfo,
  getReleaseAssetUrl,
  installLedgerful,
  verifyChecksum,
} from "../src/download.js";

const knownLinuxChecksum =
  "0ecba8040149f351448362bad3ea3ec940a59cf9fc719b90b7d6f2ac2649341a";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAssetInfo", () => {
  it("resolves linux x64", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const info = getAssetInfo();
    expect(info.assetName).toBe("ledgerful-x86_64-unknown-linux-gnu.tar.gz");
    expect(info.executableName).toBe("ledgerful");
    expect(info.needsTar).toBe(true);
  });

  it("resolves darwin arm64", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "arm64" });
    const info = getAssetInfo();
    expect(info.assetName).toBe("ledgerful-aarch64-apple-darwin.tar.gz");
  });

  it("resolves windows x64", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const info = getAssetInfo();
    expect(info.assetName).toBe("ledgerful-x86_64-pc-windows-msvc.zip");
    expect(info.executableName).toBe("ledgerful.exe");
    expect(info.needsZip).toBe(true);
  });
});

describe("getReleaseAssetUrl", () => {
  it("builds a release asset URL", () => {
    expect(getReleaseAssetUrl("v0.1.8", "foo.tar.gz")).toBe(
      "https://github.com/Ryan-AI-Studios/Ledgerful/releases/download/v0.1.8/foo.tar.gz",
    );
  });

  it("rejects malformed versions", () => {
    const bads = [
      "../v0.1.8",
      "v0.1.8?x=y",
      "latest",
      "",
      "v1.2",
      "v1.2.3-rc!bad",
    ];
    for (const bad of bads) {
      expect(() => getReleaseAssetUrl(bad, "foo.tar.gz")).toThrow(
        /Invalid ledgerful-version/,
      );
    }
  });

  it("accepts a leading v if omitted", () => {
    expect(getReleaseAssetUrl("0.1.8", "foo.tar.gz")).toBe(
      "https://github.com/Ryan-AI-Studios/Ledgerful/releases/download/v0.1.8/foo.tar.gz",
    );
  });

  it("accepts pre-release tags", () => {
    expect(getReleaseAssetUrl("v0.1.8-beta.1", "foo.tar.gz")).toBe(
      "https://github.com/Ryan-AI-Studios/Ledgerful/releases/download/v0.1.8-beta.1/foo.tar.gz",
    );
  });
});

describe("verifyChecksum", () => {
  it("passes for a matching SHA-256", () => {
    const file = path.join(os.tmpdir(), "ledgerful-checksum-ok.txt");
    fs.writeFileSync(file, "hello");
    const expected =
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    verifyChecksum(file, expected);
  });

  it("throws for a mismatch", () => {
    const file = path.join(os.tmpdir(), "ledgerful-checksum-bad.txt");
    fs.writeFileSync(file, "hello");
    expect(() => {
      verifyChecksum(file, "deadbeef");
    }).toThrow(/Checksum mismatch/);
  });
});

describe("installLedgerful", () => {
  it("verifies even on cache hit", async () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-cache-"));
      const bin = path.join(dir, "ledgerful");
      fs.writeFileSync(bin, "hello");

      vi.spyOn(tc, "find").mockReturnValue(dir);

      await expect(
        installLedgerful("v0.1.8", knownLinuxChecksum, undefined),
      ).rejects.toThrow(/Checksum mismatch/);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      Object.defineProperty(process, "arch", { value: originalArch });
    }
  });
});
