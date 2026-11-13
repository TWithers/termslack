# Contributing

## Build from source

You need [Bun](https://bun.com).

```bash
git clone https://github.com/TWithers/termslack.git
cd termslack
bun install
bun run build        # single binary for this machine → dist/termslack
```

`bun run build:release` cross-compiles all four platforms and writes the archives (`termslack-<version>-<os>-<arch>.tar.gz`, each holding one `termslack` binary) and `checksums.txt` to `dist/release/`. Linux binaries are built for glibc.

The other commands are below.

## Develop

```bash
bun check            # type check
bun fmt              # format
bun run build        # single binary → dist/termslack
bun run build:release # all platforms → dist/release/ (archives + checksums.txt)
bun test             # unit + fake-Slack tests (no network)
bun run test:live    # tests against real Slack, using your stored workspace
```

Tests run against a fake Slack (`tests/support/fakeSlack.ts`): a `Bun.serve` that answers Web API methods and speaks Socket Mode over a websocket. `tests/setup.ts` points config at a temp directory, stores secrets in a file instead of the keychain, and disables browser launching, so tests never touch your real setup.

Environment overrides (also useful outside tests):

| Variable                                       | Effect                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `TERMSLACK_SLACK_API_URL`                      | Send all Slack API and socket traffic to another server    |
| `TERMSLACK_SECRETS_BACKEND=file`               | Store tokens in `credentials.toml` instead of the keychain |
| `TERMSLACK_BROWSER=none`                       | Print URLs instead of opening a browser (handy over SSH)   |
| `TERMSLACK_APP_TOKEN` + `TERMSLACK_USER_TOKEN` | Skip setup entirely                                        |

## Releasing

For maintainers. Pushing a version tag builds, tests and publishes everything.

1. Bump `version` in `package.json` and add a `## X.Y.Z - date` section to `CHANGELOG.md` (it becomes the release notes).
2. Commit, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` then runs the tests, fails if the tag differs from `package.json`, builds the four archives, runs the macOS arm64 and Linux x64 binaries with `--version`, creates the GitHub Release with the archives, `checksums.txt` and the changelog notes, and finally updates `Formula/termslack.rb` in `TWithers/homebrew-tap`. A failure before the publish step publishes nothing.

One-time setup: create the `TWithers/homebrew-tap` repository, and add a repository secret `HOMEBREW_TAP_TOKEN` to `TWithers/termslack`: a fine-grained personal access token limited to `TWithers/homebrew-tap` with Contents: read and write. Only the tap step uses it. If the secret is missing the release is still published and only the tap job fails; add the secret and re-run that job.
