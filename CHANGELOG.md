# Changelog

## [Unreleased]

### Changed

- **Default engine pin v0.2.12:** `action.yml` default `ledgerful-version`,
  README Workflow A sample, `workflows/ledgerful-pr-scan.yml`, and CI smoke-scan
  pin published **v0.2.12** with Linux gnu sidecar checksum
  `843d91a399570e2d7e4335e573c6a2e019dfbf727a5f01385f4613e48d93a9d4`.

- **Default engine pin v0.2.11 (0218):** `action.yml` default `ledgerful-version`,
  README Workflow A sample, `workflows/ledgerful-pr-scan.yml`, and CI smoke-scan
  pin published **v0.2.11** with Linux gnu sidecar checksum
  `5c26c34db4cc50f51a6ff0cf129ad5c175c35716941f7c6354b47f3d7aa12e1a`.
- **Action `uses:` SHA → `#13` merge (0218 / 0198-B):** README×2 +
  `workflows/ledgerful-pr-scan.yml` + `workflows/ledgerful-pr-report.yml` pin
  `Ryan-AI-Studios/ledgerful-action@2142ced7092a9b3e41cb842255272df979ed4b87`
  (PR #13 squash). No version/checksum churn; Workflow B remains report-only.
  No `src/` / `dist/`.

### Added

- **Affected flows sticky section (track 0118):** optional `affectedFlows` on PR scan schema v1|v2
  (no schema v3). When present, fail-closed `validateAffectedFlows` (status enum, flow caps,
  matchKind, optional blast `confidenceClass`) and render an **Affected flows** section after
  Test gaps with `escapeMarkdown` on method, pathPattern, handlerSymbolName, handlerFile, and
  framework. Absent key remains valid for older engines. Registered `api_routes` only — not CRG
  execution-path flows; `unavailable` is the CI index-free default (not a merge block). Visible
  rows capped at 15.
- **Test gaps sticky section (track 0115):** optional `testGaps` on PR scan schema v2.
  When present, fail-closed `validateTestGaps` (status enum, caps, mappingKind) and render a
  **Test gaps** section with `escapeMarkdown` on all dynamic fields. Absent `testGaps` remains
  valid for older engines. Honest statuses only — not line coverage; no default merge block.
