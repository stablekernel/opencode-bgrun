# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-07-31

### Added
- `BGRUN_DIR` environment variable to configure the job directory; defaults to `~/.bgrun/jobs` (fixes latent split-brain bug where plugin and shell CLIs could resolve different directories)
- `bgwait <job-id>` command — blocks until a job finishes, exits with the job's exit code
- `bgkill <job-id>` command — sends SIGTERM to a running job
- `bgstatus --json` flag for machine-readable JSON output
- `--name <label>` flag on `bgrun` for human-readable job labels
- `bgrun doctor` subcommand — health check for BGRUN_DIR, runner script, notification tools, OpenCode process
- Linux desktop notifications via `notify-send` (fallback when `osascript` is unavailable)
- `bgclean` MCP tool — agents can trigger job cleanup directly
- Auto-cleanup on plugin startup (jobs older than 14 days silently removed)
- Enhanced wake prompt — includes exit code (✅/❌), command, and last log line
- Slug sanitization to prevent path traversal via crafted job names
- `Makefile` with `make dev` / `make prod` / `make status` for switching plugin between local clone and npm install
- Migration hint on startup when legacy `.run/` directory with jobs is detected

### Changed
- Default job directory changed from `.run/` (project-relative) to `~/.bgrun/jobs` (home-relative); jobs from all projects are now stored in one place

## [0.1.2] - 2026-07-30
### Added
- Ship `install.sh` / `uninstall.sh` in the npm tarball (previously excluded from the `files` allowlist).
- `npm` `scripts.test` and `scripts.lint` as shared CI/release entrypoints.
### Changed
- Package renamed to the scoped `@stablekernel/opencode-bgrun` and published to npm as the canonical install method.

## [0.1.1] - 2026-07-30
### Added
- `--cli-only` install mode (+ `--help`) in `install.sh`/`uninstall.sh`: manage just the human shell CLIs on PATH, with auto-discovery of the installed package, decoupled from dev-only plugin/skill symlinking.
### Changed
- Docs updated to the plugin-first install model.

## [0.1.0] - 2026-07-29
### Added
- Initial release: `bgrun` background job runner with live OpenCode session wake-to-act, the `bgrun` plugin tool, shell CLIs (bgrun/bgstatus/bgtail/bgclean), run-bg skill, CI, and packaging for install.
