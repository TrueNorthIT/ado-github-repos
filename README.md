# GitHub Repos for Azure DevOps

- `extension/`: the Azure DevOps hub extension (React, esbuild) that lists and browses a project's GitHub repositories under Repos.
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
