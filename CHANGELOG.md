# Changelog

## [Unreleased]

### Added

- **Test gaps sticky section (track 0115):** optional `testGaps` on PR scan schema v2.
  When present, fail-closed `validateTestGaps` (status enum, caps, mappingKind) and render a
  **Test gaps** section with `escapeMarkdown` on all dynamic fields. Absent `testGaps` remains
  valid for older engines. Honest statuses only — not line coverage; no default merge block.
