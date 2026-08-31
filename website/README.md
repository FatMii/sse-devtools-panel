# SSE DevTools Panel — Website

Static marketing site built with [Astro](https://astro.build). SSG output for SEO, GitHub Pages, or any static host.

## Commands

From repo root:

```bash
pnpm website:dev       # http://localhost:4321/ (local dev, base path /)
pnpm website:build     # build extension zip + Astro site for GitHub Pages
pnpm release:zip       # package dist/ → website/public/releases/*.zip
```

GitHub Pages production URL uses base path `/sse-devtools-panel`:
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

The zip contains a top-level `dist/` folder. Users extract it and load that folder via `chrome://extensions` → Developer mode → Load unpacked.

Run `pnpm build` before `release:zip` if `dist/` is missing or stale.

## Deploy

- **GitHub Pages**: push to `main` triggers `.github/workflows/deploy-website.yml`
- **Custom domain**: set `site` in `astro.config.mjs` and configure DNS + HTTPS on your host

## Structure

| Path                    | Role                              |
| ----------------------- | --------------------------------- |
| `src/pages/index.astro` | Landing page                      |
| `src/components/`       | Nav, hero, install section        |
| `src/styles/global.css` | Light / dark theme tokens         |
| `public/releases/`      | Offline zip artifacts (generated) |
