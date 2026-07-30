# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
