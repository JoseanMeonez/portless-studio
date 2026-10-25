# Releasing

A release is a version tag. Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`,
which checks that the tag matches the version in `package.json`, runs the lint, type, test and
build checks, and publishes the package to npm. No npm token is stored anywhere: the workflow uses
npm Trusted Publishing, where npm accepts a short-lived token that GitHub Actions issues for this
one workflow run (an OIDC token). The published package carries a provenance statement that links
it to the commit and the run that built it.

## One-time setup on npm

Do this once, as an owner of the `portless-studio` package on npmjs.com:

1. Open the package on npmjs.com and go to **Settings**.
2. Under **Trusted Publisher**, choose **GitHub Actions**.
3. Fill in:
   - Organization or user: `keven-bardales`
   - Repository: `portless-studio`
   - Workflow filename: `release.yml`
   - Environment: leave it empty
4. Save.

After that, npm accepts publishes only from that workflow file in that repository. If the workflow
file is renamed, update this setting too, or the publish step fails with a 404 or an
authentication error.

## Release steps

1. Make sure `main` is green in CI and your local `main` is up to date.
2. Add the new version's section to `CHANGELOG.md` and commit it.
3. Bump the version. This edits `package.json`, commits it and creates the matching tag:

   ```bash
   npm version patch   # 0.1.0 -> 0.1.1, for fixes
   npm version minor   # 0.1.0 -> 0.2.0, for new features
   ```

4. Push the commit and the tag together:

   ```bash
   git push --follow-tags
   ```

## Checking the run

The tag push starts the **Release** workflow. Follow it in the repository's **Actions** tab, or
from a terminal:

```bash
gh run list --workflow release.yml --limit 1
gh run watch
```

When it succeeds, the new version shows on the package page on npmjs.com with a provenance badge,
and `npm view portless-studio version` prints it.

If the run fails before the publish step (a failing check, or a tag that does not match
`package.json`), nothing was published: fix the cause, delete the tag with
`git push --delete origin v<version>` and `git tag -d v<version>`, then tag again. If the publish
step itself fails with an authentication error, check the Trusted Publisher settings above.
