# GitHub repository setup (maintainers)

Do these **after** the Chrome Web Store listing is approved and live.  
Until then, keep the repo **Private**.

## Day-of-public checklist

### 1. Paste the store URL into README

In `README.md` and `README.zh-CN.md`, replace the “under review” note with the live Chrome Web Store link (and badges if you want).

### 2. Make the repository public

1. Open https://github.com/FatMii/sse-devtools-panel/settings
2. Scroll to **Danger Zone**
3. **Change repository visibility** → **Public**

### 3. Protect `main` (requires Public, or GitHub Pro)

Branch protection is **not available** on a private repo with a free personal account (API returns 403). Enable it right after going Public:

1. Confirm Actions has a green **CI** run on `main` (status check name: **`lint / test / typecheck / build`**).
2. Open https://github.com/FatMii/sse-devtools-panel/settings/branches
3. Add a branch protection rule / ruleset for `main`:
   - Require a pull request before merging
   - Require status checks to pass before merging
   - Required check: **`lint / test / typecheck / build`**
4. Save.

### 4. Verify About box

| Field       | Expected                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description | Chrome extension DevTools panel for debugging SSE / EventSource / NDJSON streaming responses. Inspect, filter, search, and export stream events.           |
| Homepage    | Chrome Web Store listing URL (set this when live)                                                                                                          |
| Topics      | `chrome-extension`, `devtools`, `sse`, `eventsource`, `ndjson`, `browser-extension`, `debugging`, `developer-tools`, `event-stream`, `openai`, `streaming` |

### 5. Optional follow-ups

- Create a GitHub Release when tagging versions
- Add `CODE_OF_CONDUCT.md` / `SECURITY.md` when the community grows
- Keep internal planning notes out of the default public docs tree

## Already done (do not redo)

- CI workflow (`.github/workflows/ci.yml`)
- MIT `LICENSE`, issue / PR templates
- English default `README.md` + `README.zh-CN.md`
- `PRIVACY.md` for store privacy-policy URL
- Store screenshot assets under `docs/assets/chrome-web-store/`
