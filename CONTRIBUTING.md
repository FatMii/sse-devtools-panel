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
pnpm test          # Vitest unit tests (`src/**/__tests__/**/*.test.ts`)
pnpm test:watch    # Vitest watch mode
pnpm build
```

## Before you open a PR

1. Run locally:

   ```bash
   pnpm format:check && pnpm lint && pnpm test && pnpm typecheck && pnpm build
   ```

2. If you change UI or capture behavior, smoke-test with `pnpm demo` (or a real SSE page).
3. Keep PRs focused. Prefer Conventional Commits style when possible, e.g. `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
4. Shared logic changes should include or update Vitest tests under a sibling `__tests__/` folder when practical.

## UI icons

Panel icons live in `src/panel/core/icons.ts`.

- Prefer [Lucide](https://lucide.dev) outline icons (24×24, 2px stroke).
- Copy the SVG paths into `ICONS` and wire them with `data-icon` / `renderIcon`.
- Keep style consistent with existing icons (`currentColor`, round caps/joins).
- Do not add a second icon library (Font Awesome, Material, etc.) without discussion.

CI (GitHub Actions) runs `format:check` + `lint` + `test` + `typecheck` + `build` on every PR to `main` (Node.js 22). A red CI means the PR is not ready to merge.

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
- AI Conversation merge is implemented for several Web profiles (see README vendor matrix). Anthropic is detected as a profile but Conversation merge is not implemented yet. Deeper ReadableStream hooks (`pipeThrough` / `pipeTo`) remain out of scope until we have a confirmed miss-capture case.
