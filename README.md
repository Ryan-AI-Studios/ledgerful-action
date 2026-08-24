# Ledgerful PR Risk Report (GitHub Action)

Runs the **real Ledgerful engine binary** inside your CI runner over a PR diff and posts a
change-risk summary as a PR comment / check-run. One-line install in any workflow. No hosted
service. Your code and token never leave your runner.

> **Same engine in your runner, no server.** This Action downloads a checksum-pinned Ledgerful
> release, runs `ledgerful scan --pr <base>...<head> --format json` **offline** in the runner, and
> posts a summary via `GITHUB_TOKEN`. The engine has no network code — the network call lives in
> this Action wrapper, never in the binary. That is why the surface can be "the same engine you
> run locally."
>
> **Workflow A token note:** Workflow A may receive a read-only `GITHUB_TOKEN` (the default
> `${{ github.token }}`) solely to authenticate the release download and benefit from the higher
> authenticated rate limit. The workflow's `permissions: contents: read` block removes write access.
> Workflow A never receives repo secrets.

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
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          fetch-depth: 0   # REQUIRED — default 1 omits the base commit; scan --pr can't compute the diff

      # Optional: add an actions/cache step keyed on <version>:<checksum> for cross-run
      # binary persistence on ephemeral hosted runners (tool-cache already provides
      # runner-local persistence via RUNNER_TOOL_CACHE; see "Optional cross-run binary cache" below).
      - name: Run Ledgerful PR risk scan
        # No mutable release tag yet — pin the full commit SHA from
        # https://github.com/Ryan-AI-Studios/ledgerful-action (main).
        uses: Ryan-AI-Studios/ledgerful-action@bacf400797142884c46e97c6ce755b7ef7433a53
        with:
          ledgerful-version: v0.2.11
          # checksum for ledgerful-x86_64-unknown-linux-gnu.tar.gz (v0.2.11); substitute for other OS/arch
          ledgerful-checksum: 5c26c34db4cc50f51a6ff0cf129ad5c175c35716941f7c6354b47f3d7aa12e1a
        env:
          LEDGERFUL_NO_NETWORK: "1"   # assert the engine made no network call during the scan

      - name: Upload JSON report
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
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
  # actions:read is required to download artifacts from another workflow run
  # (Workflow A) when using a restricted GITHUB_TOKEN + github-token input.
  actions: read
  pull-requests: write
  checks: write

jobs:
  post:
    # Do not post if Workflow A failed after uploading (or never completed successfully).
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: Download the PR scan artifact
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: ledgerful-pr-report
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      - name: Post risk summary
        # No mutable release tag yet — pin the full commit SHA from
        # https://github.com/Ryan-AI-Studios/ledgerful-action (main).
        uses: Ryan-AI-Studios/ledgerful-action@bacf400797142884c46e97c6ce755b7ef7433a53
        with:
          github-token: ${{ github.token }}
          report-path: ledgerful-pr-report.json
```

> **Pinning notes:** first-party Actions (`actions/checkout`, `actions/upload-artifact`,
> `actions/download-artifact`) are SHA-pinned to the versions shown. Pin `ledgerful-action` to a
> **full 40-char commit SHA** (`@<40-char-sha>`) — there is no mutable release tag yet. Take the
> SHA from https://github.com/Ryan-AI-Studios/ledgerful-action (main) of the commit you want.

> Workflow B runs in the **base-repo context** with a write token and **never executes PR code.**
> Workflow A is read-only and receives no secrets. Fork PRs get no secrets and no write token.

## Action inputs

| input | required | default | description |
| --- | --- | --- | --- |
| `ledgerful-version` | no | `v0.2.11` | pinned engine release version |
| `ledgerful-checksum` | yes | — | SHA-256 of the release archive (.tar.gz/.zip) for the runner OS/arch; required in Workflow A |
| `github-token` | no | `${{ github.token }}` | token used to authenticate the release download in Workflow A and to post the comment / check-run in Workflow B |
| `fail-on` | no | — | optional `low`/`medium`/`high` threshold that fails the build non-blockingly |

## Action outputs

| output | description |
| --- | --- |
| `report-path` | path to the JSON report written by Workflow A |
| `risk-level` | risk level reported by the scan (`low`, `medium`, `high`) |

## Version pinning + binary caching

- **Pin a specific Ledgerful release by version + checksum.** Never `latest` — supply-chain hygiene
  consistent with SHA-pinned Actions. The release **archive** (.tar.gz/.zip) checksum is verified
  before extraction; the cache identity includes the checksum so a version+checksum mismatch never
  reuses a stale cache entry.
- **Binary caching:** the wrapper uses `@actions/tool-cache` (`find` → reuse; else `downloadTool` →
  `cacheDir`) to reuse the pinned binary and authenticates the download with `GITHUB_TOKEN` for the
  higher authenticated rate limit. `tool-cache` provides runner-local persistence; for cross-run
  persistence on ephemeral hosted runners, users can add an `actions/cache` step keyed on the pinned
  version + checksum — see the example in the Workflow A snippet below.
- **Pin this Action itself** by full 40-char commit SHA (`@<40-char-sha>`). No mutable release
  tag exists yet — do not use a floating branch ref for production.

### Optional cross-run binary cache

For ephemeral hosted runners, add an `actions/cache` step before the scan step, keyed on the pinned
version + checksum. `@actions/tool-cache` already provides runner-local persistence via
`RUNNER_TOOL_CACHE` (sufficient for self-hosted runners); `actions/cache` is only needed when
runners are ephemeral AND you want to avoid re-downloading across runs. The cache path must target
the tool-cache directory for the pinned version, e.g.:

```yaml
      - name: Cache Ledgerful binary (optional, cross-run persistence)
        uses: actions/cache@<pinned-sha>
        with:
          path: ${{ runner.tool_cache }}/ledgerful/<version>/<arch>
          key: ledgerful-<version>-<checksum>-${{ runner.os }}-${{ runner.arch }}
```

## Why `fetch-depth: 0` is required

`actions/checkout@v4` defaults to `fetch-depth: 1` (tip only). Without the base commit in the
runner's object DB, `ledgerful scan --pr <base>...<head>` can't compute the diff and the engine
emits a clear, actionable error: *"base commit not found — set `fetch-depth: 0`."* The README
snippet above already sets it. Do not remove it.

## Output schema

`ledgerful scan --pr <base>...<head> --format json` emits a **versioned, deterministic** report.
This Action accepts **`schemaVersion` 1 or 2** (mixed Workflow A/B rollouts during engine upgrades).

```json
{
  "schemaVersion": 1,
  "generatedAt": "ISO-8601 UTC",
  "baseRef": "main",
  "headRef": "HEAD",
  "headHash": "abc...",
  "branchName": "feature/x",
  "treeClean": true,
  "changeCount": 3,
  "changes": [{ "path": "src/foo.rs", "changeType": "modified" }],
  "riskLevel": "low",
  "riskReasons": [],
  "analysisWarnings": []
}
```

- **`headHash` / `branchName`:** optional. On detached HEAD (typical `pull_request` checkout) the engine
  may omit them or historically emit `null`; the Action accepts string, `null`, or absent and never
  prints the word `null` into comments.
- **`analysisWarnings`:** reserved (engine currently always emits `[]`); not a live signal.
- **Schema v2 (optional fields):** per change — `oldPath`, `churn`, `lastCommitAt`, `isSensitive`;
  report-level — `historyWindowCommits`, `historyTruncated`. When present, the PR comment may include
  a size-capped “Most-churned files” section. Comment bodies and check-run text are bounded under
  GitHub’s API limits (char/byte guards with an explicit truncation marker).
- **`testGaps` (v2 additive, optional for older engines):** structural test-mapping gap summary for
  the change set (`status`, counts, capped `unmapped` / `mappedSample`, honesty `notes`). Absent key
  remains valid (older engines). When present, the Action **fail-closes** via `validateTestGaps` and
  renders a sticky **Test gaps** section. Status vocabulary:
  `available` \| `empty_mapping` \| `missing_table` \| `no_source_seeds` \| `unavailable`.
  This is **not** line coverage; CI without a local index typically shows `unavailable` (honest
  default, not a merge failure). Never treat empty mapped lists as “fully covered.”
- **`affectedFlows` (additive on schema v1|v2, optional for older engines):** registered HTTP routes
  (`api_routes`) touched by the change set (`status`, `flowCount` / `flowCapped` / `flowTotal`,
  capped `flows`, honesty `notes`). Absent key remains valid (older engines). When present, the
  Action **fail-closes** via `validateAffectedFlows` and renders a sticky **Affected flows** section
  after Test gaps. Status vocabulary:
  `available` \| `empty_map` \| `missing_table` \| `no_change_seeds` \| `unavailable`.
  Match kinds: `handler_symbol` \| `handler_impl_file` \| `route_file` \| `blast_symbol` \|
  `blast_file`. Blast-mediated rows may carry SCREAMING_SNAKE `confidenceClass`. This is **not**
  CRG execution-path / distributed-trace flows; CI without a local index typically shows
  `unavailable` (honest default, not a merge failure). Visible sticky rows are capped at **15**.

Breaking schema changes bump `schemaVersion`; this Action accepts 1 and 2. Deterministic for a given
diff + pinned engine version.

## Security posture

- **Untrusted input:** the PR diff and title are attacker-controlled data. They are treated as data,
  never interpolated into shell or comment markdown unescaped (reuse of Ledgerful's 0031
  sanitization discipline). A malicious PR cannot inject into the posted comment or the runner shell.
- **Token scope:** this Action never echoes `GITHUB_TOKEN`. Fork-PR runs never receive repo secrets.
  The release archive is checksum-verified before extraction.
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