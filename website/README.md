# SSE DevTools Panel — Website

Static marketing site built with [Astro](https://astro.build). SSG output for SEO, GitHub Pages, or any static host.

## Commands

From repo root:

```bash
pnpm website:dev       # sync screenshots + http://localhost:4321/ (local dev, base path /)
pnpm website:build     # build extension zip + Astro site for GitHub Pages
pnpm release:zip       # package dist/ → website/public/releases/*.zip
```

`website:dev` and `website:build` run `scripts/sync-website-screenshots.mjs` to copy
`docs/assets/screenshots/` into `website/public/screenshots/` before Astro builds.

GitHub Pages production URL uses base path `/sse-devtools-panel/` (trailing slash):
https://fatmii.github.io/sse-devtools-panel/

From `website/`:

```bash
pnpm dev
pnpm build
pnpm preview
```

## Offline install bundle

`pnpm release:zip` copies the built extension `dist/` into:

`website/public/releases/sse-devtools-panel-v{version}.zip`

The zip contains a top-level `dist/` folder. Users extract it and load that folder via `chrome://extensions` or `edge://extensions` → Developer mode → Load unpacked.

Run `pnpm build` before `release:zip` if `dist/` is missing or stale.

Store install (no sideload): [Chrome Web Store](https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni) · [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/sse-devtools-panel/jmdceeplcpkajkiaiankkabblekdehmf).

## Deploy

- **GitHub Pages**: push to `main` triggers `.github/workflows/deploy-website.yml`
- **Custom domain**: set `site` in `astro.config.mjs` and configure DNS + HTTPS on your host

## Structure

| Path                       | Role                              |
| -------------------------- | --------------------------------- |
| `src/pages/index.astro`    | Chinese landing (`/`)             |
| `src/pages/en/index.astro` | English landing (`/en/`)          |
| `src/i18n/`                | zh / en UI strings                |
| `src/components/`          | Nav, hero, features, install      |
| `src/styles/global.css`    | Light / dark theme tokens         |
| `public/screenshots/`      | README screenshots (synced)       |
| `public/releases/`         | Offline zip artifacts (generated) |
