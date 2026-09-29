# Changelog

All notable changes to **SSE DevTools Panel** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

GitHub Releases mirror these notes and attach the offline zip for each tag:
https://github.com/FatMii/sse-devtools-panel/releases

## [1.2.6] — 2026-09-29

### Added

- First-run **onboarding tour** (driver.js spotlight): streams, import, tabs, and More menu
- **More** menu: replay the guided tour anytime
- **Sample stream**: load a built-in SSE sample without a live page

## [1.2.5] — 2026-09-17

### Added

- Stream list **wall-clock** start time (and end time when finished) so same-URL streams are easier to tell apart
- Detail meta shows absolute start → end plus duration
- Path hover tooltip shows the full URL

### Changed

- Sidebar minimum width raised to 265px for stable layout

## [1.2.4] — 2026-09-10

### Changed

- Request body capture soft ceiling raised from 256KB to ~8MB so typical payloads stay intact
- Source / Parsed long text folds by default with Show more / Copy (Network-like)
- Expand hover warns that large payloads may lag the panel
- Relay buffer while the panel is closed raised to 16MB

## [1.2.3] — 2026-09-08

### Fixed

- Request payload context menu: hidden Copy items no longer stay visible; object/array nodes provide Copy value
- Source view: toolbar Copy plus right-click Copy Data for the raw request body

### Changed

- Soft Context Menu / parsed payload chrome aligned closer to Network
- Ignore synced `website/public/screenshots/*` so local website builds stay out of `git status`

## [1.2.2] — 2026-08-27

### Added

- JSON tree **substring** `<mark>` highlighting in Events drawer / Parsed JSON

### Fixed

- Long collapsed strings auto-expand when the hit is only in the truncated tail
- Collapsible string meta / Show more / Copy stay trailing after wrapped text
- Windows build: avoid `fs.cpSync` crash on non-ASCII project paths (#29)

## [1.2.1] — 2026-08-25

### Added

- Parsed JSON tree: long string leaves abbreviated like Chrome Network (size + Show more/less + Copy)
- Applies to Request Payload Parsed view and Events drawer JSON tree
- en/zh i18n; unit tests for truncate/size helpers

## [1.2.0] — 2026-08-22

### Added

- **Night theme** for the DevTools panel — Light / Night / Follow DevTools
- Toolbar Theme menu with preference saved in Chrome sync
- Night token palette aligned with store promo visuals
- en/zh i18n for theme labels
- Chrome Web Store promo assets under `/assets/store/`

## [1.1.3] — 2026-08-18

### Added

- Show fetch/XHR rows in Streams while still pending when Accept / `?stream=true` / `stream: true` already look like a stream; discard if the response is not (#19)
- Conversation: merge Tongyi/Qwen `bar/workflow` thinking into reasoning and weather tools

## [1.1.2] — 2026-08-14

### Fixed

- Request/conversation subtab underline polish (matches main tabs)
- Conversation tools pane scroll for long result lists

### Changed

- Docs: Chrome Web Store install links; DeepSeek and demo screenshot GIFs

## [1.1.1] — 2026-08-10

### Fixed

- Raw / Conversation: stop scrollbar drift while streaming and runaway wheel scroll
- Kimi: stop treating all kimi hosts as `connect-json`; strip citation chips from Conversation content

### Changed

- CI: required English synthetic fixtures under `fixtures/vendors/`
- Docs / hygiene cleanup

## [1.1.0] — 2026-08-10

### Added

- Virtualize Events / Conversation / Raw; throttle detail refresh; incremental AI merge sessions
- Buffer page traffic until the DevTools panel connects; wider stream detection; EventSource `on*` custom event capture
- Demo stress stream (10k events) and refreshed landing paths

### Changed

- Broader header redaction; PRIVACY and README updates
- Split panel CSS modules; migrate unit tests to Vitest

## [1.0.0] — 2026-08-07

### Added

- Initial public release: Chromium DevTools panel for SSE / EventSource / NDJSON capture, Events, Request, Conversation, Timeline, Raw, import/export, and local demo

[1.2.6]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.6
[1.2.5]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.5
[1.2.4]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.4
[1.2.3]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.3
[1.2.2]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.2
[1.2.1]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.1
[1.2.0]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.2.0
[1.1.3]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.1.3
[1.1.2]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.1.2
[1.1.1]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.1.1
[1.1.0]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.1.0
[1.0.0]: https://github.com/FatMii/sse-devtools-panel/releases/tag/v1.0.0
