# Ledgerful PR Risk Report (GitHub Action)

Runs the **real Ledgerful engine binary** inside your CI runner over a PR diff and posts a signed
change-risk summary as a PR comment / check-run. One-line install in any workflow. No hosted
service. Your code and token never leave your runner.

> **Same engine in your runner, no server.** This Action downloads a checksum-pinned Ledgerful
> release, runs `ledgerful scan --pr <base>...<head> --format json` **offline** in the runner, and
> posts a summary via `GITHUB_TOKEN`. The engine has no network code — the network call lives in
> this Action wrapper, never in the binary. That is why the surface can be "the same engine you
> run locally."

## Fork-PR safety: the two-workflow pattern (MANDATED)

A standard `pull_request` event from a fork gets a **read-only** `GITHUB_TOKEN` — it cannot post a
comment or create a check-run. Using `pull_request_target` to gain write access while checking out
untrusted PR code is a well-known **RCE footgun** and is forbidden. This Action ships **two
workflow files** that together keep fork PRs both functional and RCE-safe:

- **Workflow A** (`pull_request`, `permissions: contents: read`) — checks out and runs the engine
  over the untrusted PR. **No write token, no secrets.** Uploads the JSON report as an artifact.
  Untrusted code only ever runs here, with nothing it can abuse.
- **Workflow B** (`workflow_run` on A's completion, base-repo context with a write token) —
  downloads A's artifact and posts the comment / check-run. **Workflow B never checks out or
  executes any PR code.**

## Usage — Workflow A (runs the engine, uploads the report)

`.github/workflows/ledgerful-pr-scan.yml`:

```yaml
name: Ledgerful PR Scan

on:
  pull_request:

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR (full history required for diff)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0   # REQUIRED — default 1 omits the base commit; scan --pr can't compute the diff

      - name: Run Ledgerful PR risk scan
        uses: Ryan-AI-Studios/ledgerful-action@<pinned-sha>
        with:
          ledgerful-version: v0.1.8
          ledgerful-checksum: <sha256-of-the-pinned-release-binary-for-this-runner-os-arch>
        env:
          LEDGERFUL_NO_NETWORK: "1"   # assert the engine made no network call during the scan

      - name: Upload JSON report
        uses: actions/upload-artifact@v4
        with:
          name: ledgerful-pr-report
          path: ledgerful-pr-report.json
```

## Usage — Workflow B (downloads the artifact, posts the comment/check-run)

`.github/workflows/ledgerful-pr-report.yml`:

```yaml
name: Ledgerful PR Report

on:
  workflow_run:
    workflows: [Ledgerful PR Scan]
    types: [completed]

permissions:
  pull-requests: write
  checks: write

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - name: Download the PR scan artifact
        uses: actions/download-artifact@v4
        with:
          name: ledgerful-pr-report
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      - name: Post risk summary
        uses: Ryan-AI-Studios/ledgerful-action@<pinned-sha>
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

> Workflow B runs in the **base-repo context** with a write token and **never executes PR code.**
> Workflow A is read-only and receives no secrets. Fork PRs get no secrets and no write token.

## Version pinning + binary caching

- **Pin a specific Ledgerful release by version + checksum.** Never `latest` — supply-chain hygiene
  consistent with SHA-pinned Actions. The checksum is verified before exec **even on a cache hit**.
- **Binary caching:** the wrapper uses `@actions/tool-cache` (`find` → reuse; else `downloadTool` →
  `cacheDir`) to reuse the pinned binary, authenticates the download with `GITHUB_TOKEN` for the
  higher authenticated rate limit, and pairs with `actions/cache` keyed on the pinned version +
  checksum for cross-run persistence on ephemeral runners.
- **Pin this Action itself** by commit SHA (`@<pinned-sha>`), not by tag.

## Why `fetch-depth: 0` is required

`actions/checkout@v4` defaults to `fetch-depth: 1` (tip only). Without the base commit in the
runner's object DB, `ledgerful scan --pr <base>...<head>` can't compute the diff and the engine
emits a clear, actionable error: *"base commit not found — set `fetch-depth: 0`."* The README
snippet above already sets it. Do not remove it.

## Output schema

`ledgerful scan --pr <base>...<head> --format json` emits a **versioned, deterministic** report:

```json
{
  "schema_version": 1,
  "risk_summary": { ... },
  "hotspots": [ ... ],
  "files": [ ... ]
}
```

Breaking changes bump `schema_version`; the Action pins a version. Deterministic for a given diff +
pinned engine version.

## Security posture

- **Untrusted input:** the PR diff and title are attacker-controlled data. They are treated as data,
  never interpolated into shell or comment markdown unescaped (reuse of Ledgerful's 0031
  sanitization discipline). A malicious PR cannot inject into the posted comment or the runner shell.
- **Token scope:** this Action never echoes `GITHUB_TOKEN`. Fork-PR runs never receive repo secrets.
  The binary is checksum-verified before execution.
- **No egress from the engine:** the binary is invoked offline; only the wrapper talks to
  `api.github.com`. A test/inspection asserts the engine made no network call during the scan.

## Out of scope

- A hosted service / GitHub App (that's the hosted tier). Posting to non-GitHub forges (GitLab/Gitea
  later). Policy *enforcement* / fail-the-build gating (that's a separate policy engine — this
  Action *reports*; it may expose a non-blocking `--fail-on` behind a flag but the policy engine is
  out of scope here). Any engine network code.

## License

PolyForm Noncommercial License 1.0.0 + the Ledgerful Small-Entity Commercial Exception. See
[LICENSE](LICENSE) and [COMMERCIAL-EXCEPTION.md](COMMERCIAL-EXCEPTION.md).