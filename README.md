# GitHub Repos for Azure DevOps

- `extension/`: the Azure DevOps hub extension (React, esbuild) that lists and browses a project's GitHub repositories (Boards GitHub connections) in its own **GitHub Repos** section of the project nav.
- `auth/`: the Azure Function that runs the GitHub sign-in popup flow and token refresh.
- `shared/contract.ts`: the contract between the two.

## Local development (mock mode)

```
cd extension
npm install
npm run dev
```

Open <http://localhost:3000> in any browser tab. The hub runs on fixture data with no Azure DevOps, Marketplace upload, GitHub sign-in or function app. It rebuilds on save, so edit, then refresh.

- A small toolbar (bottom right) switches between light and dark, picks a scenario and resets stored state.
- Choose a scenario with `?scenario=` or the toolbar: `ok` (default), `signedOut`, `noConnections`, `forbidden` (403 from the connections API), `rateLimit`, `noAccess` (403 from GitHub contents) and `slow` (2 s latency).
- "Sign in with GitHub" stores a fake token instead of opening a popup.
- The mock lives in `extension/src/dev/`: the Azure DevOps SDK is swapped for `mockSdk.ts` and `fetch` for `mockFetch.ts` at build time. Production builds (`npm run build`, `npm run package`) do not include it.

To try the real auth function locally, run it with `func start` in `auth/` and build with `AUTH_BASE=http://localhost:7071`.

## Tests, build and release

- `npm test` and `npm run build` in `extension/`.
- `npm run package` builds the production vsix (`TrueNorthIT.github-repos-<version>.vsix`) against the production auth function. Bump the version in both `package.json` and `vss-extension.json`.

## Deploy the auth function

Sign `az` in to an identity with access to the function app, then from `auth/`:

```
AZ_SUBSCRIPTION=<subscription id> AZ_RESOURCE_GROUP=<resource group> AZ_FUNCTION_APP=<function app> npm run deploy
```

It builds locally, zip-deploys to an existing Flex Consumption app (Node 22) and restores dev dependencies afterwards. The app needs these settings: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `STATE_SECRET`, `AUTH_BASE_URL` and `ALLOWED_ORIGINS` (`https://<publisher>.gallerycdn.vsassets.io`). See `shared/contract.ts`.

## Licence

MIT, see [LICENSE](LICENSE). Third-party assets are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Publishing

`.github/workflows/publish.yml` publishes to the Visual Studio Marketplace with Trusted Publishing (GitHub OIDC), so no PAT is stored. To release, bump `version` in `extension/package.json` and `extension/vss-extension.json`, commit, then:

```
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag must match both versions. The workflow tests, builds, packages, publishes, and attaches the `.vsix` to a GitHub release. A manual run from the Actions tab defaults to a dry run (build and package only).
