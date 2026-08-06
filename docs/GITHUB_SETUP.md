# GitHub repository setup (maintainers)

Checklist after merging the OSS scaffolding (CI, LICENSE, templates).

## 1. Make the repository public

When you are ready for outside contributors:

1. Open https://github.com/FatMii/sse-devtools-panel/settings
2. Scroll to **Danger Zone**
3. **Change repository visibility** → **Public**

Until this is Public, strangers cannot browse the code or open normal community PRs from forks.

## 2. Require CI on `main`

1. Push / merge so `.github/workflows/ci.yml` has run at least once on `main` (Actions tab should show a green **CI** run).
2. Open https://github.com/FatMii/sse-devtools-panel/settings/branches
3. **Add branch protection rule** (or a Ruleset) for `main`:
   - Require a pull request before merging
   - Require status checks to pass before merging
   - Status check to require: **`lint / test / typecheck / build`**
4. Save.

After this, a red CI blocks merge (unless an admin bypasses the rule).

## 3. Verify About box

Confirm description and topics (already set via `gh` if that succeeded):

- Description: Chrome DevTools panel for debugging SSE / NDJSON / Connect+JSON streaming responses
- Topics: `chrome-extension`, `devtools`, `sse`, `eventsource`, `ndjson`

## 4. Optional next steps

- Create a GitHub Release when tagging versions
- Add `CODE_OF_CONDUCT.md` / `SECURITY.md` when the community grows
- Keep internal planning notes out of the default public docs tree
