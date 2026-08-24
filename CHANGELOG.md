# Changelog

## [Unreleased]

### Changed

- **Default engine pin v0.2.11 (0218):** `action.yml` default `ledgerful-version`,
  README Workflow A sample, `workflows/ledgerful-pr-scan.yml`, and CI smoke-scan
  pin published **v0.2.11** with Linux gnu sidecar checksum
  `5c26c34db4cc50f51a6ff0cf129ad5c175c35716941f7c6354b47f3d7aa12e1a`. Six
  `uses:` SHA sites stay on `bacf4007…` until a follow-on SHA bump PR after
  this merges (0198 order).

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
