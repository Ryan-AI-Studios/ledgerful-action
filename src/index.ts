// Ledgerful Action — entry point.
//
// This is the wrapper: download + checksum-verify the pinned Ledgerful release,
// run `ledgerful scan --pr <base>...<head> --format json` offline, render a summary,
// and post it as a PR comment / check-run via GITHUB_TOKEN.
//
// The network call lives HERE, never in the engine. The engine has no network code.
// PR diff/title are untrusted data — escape all interpolation into shell or markdown.
//
// See track 0047 spec/plan for the full contract. This file is a minimal scaffold.

import * as core from "@actions/core";

async function run(): Promise<void> {
  const version = core.getInput("ledgerful-version", { required: true });
  const checksum = core.getInput("ledgerful-checksum", { required: true });
  const failOn = core.getInput("fail-on") || "";

  core.info(
    `Ledgerful Action scaffold — version=${version} fail-on=${failOn || "(none)"}`,
  );
  core.warning(
    "Action implementation is in progress (track 0047). " +
      "Binary download + checksum verify + scan + render + post not yet wired.",
  );
  core.setFailed("ledgerful-action: not yet implemented (track 0047 in progress)");
}

run().catch((err: unknown) => {
  if (err instanceof Error) {
    core.setFailed(err.message);
  } else {
    core.setFailed(String(err));
  }
});

export { run };