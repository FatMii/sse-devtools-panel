# Contributing to SSE DevTools Panel

Thanks for helping improve this project. Short contributions and clear bug reports are welcome.

## Development setup

```bash
pnpm i
pnpm build
pnpm demo          # http://127.0.0.1:8765
```

Load the unpacked extension from `dist/` in `chrome://extensions` (Developer mode). Open DevTools → **SSE DevTools**, then **refresh** the page before capturing streams.

Useful scripts:

```bash
pnpm dev           # watch rebuild
pnpm typecheck
pnpm lint          # eslint
pnpm format        # prettier write
pnpm test-only     # unit-style checks for shared logic
pnpm build
```

## Before you open a PR

1. Run locally:

   ```bash
   pnpm format:check && pnpm lint && pnpm test-only && pnpm typecheck && pnpm build
   ```

2. If you change UI or capture behavior, smoke-test with `pnpm demo` (or a real SSE page).
3. Keep PRs focused. Prefer Conventional Commits style when possible, e.g. `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
4. Shared logic changes should include or update tests under `scripts/test-*.mjs` when practical.

CI (GitHub Actions) runs the same `test-only` + `typecheck` + `build` checks on every PR to `main`. A red CI means the PR is not ready to merge.

## Reporting bugs

Use the Bug report issue template. Include:

- Chrome version
- Steps to reproduce
- Whether the local demo reproduces it
- Screenshots or exported JSON if useful

## Feature requests

Use the Feature request template. Describe the problem first, then the proposed idea.

## Scope notes

- Current tests cover shared parsers / export / spec / timing / request-view / close / AI merge helpers. They do **not** fully cover the DevTools panel UI or every inject edge case.
- AI Conversation view is implemented for several domestic Web profiles (see README vendor matrix). Deeper ReadableStream hooks (`pipeThrough` / `pipeTo`) remain out of scope until we have a confirmed miss-capture case.

## Maintainers: publish & branch protection

Step-by-step checklist: [docs/GITHUB_SETUP.md](./docs/GITHUB_SETUP.md).

Summary:

1. **Make the repo public** (when ready) — Settings → Danger Zone → Change visibility → Public.
2. Protect `main` — require PRs + status check **`lint / test / typecheck / build`** from `.github/workflows/ci.yml`.
3. Confirm About description / topics.

After CI has run at least once on `main`, the status check name will appear in the branch protection picker.
