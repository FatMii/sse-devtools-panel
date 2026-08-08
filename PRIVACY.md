# Privacy Policy for SSE DevTools Panel

Last updated: 2026-08-08

SSE DevTools Panel ("the Extension") is a Chrome DevTools extension for debugging streaming responses (SSE, EventSource, NDJSON, and Connect+JSON).

## Data we handle

All of the following stays on the developer’s machine unless the developer exports or copies it elsewhere. The Extension does not upload this data to our servers (we do not operate a collection backend).

### Shown in the local DevTools panel

- Streaming response bodies the page already receives (assembled raw text and parsed events).
- Request metadata collected from the page when available: URL, method, status, Content-Type, transport.
- Request and response headers after automatic redaction of common sensitive header names (for example `Authorization`, `Cookie`, and many `*token*` / `*api-key*` style headers). Redaction follows known naming patterns and may not cover every custom header name.
- A text preview of the request body when available (capped; currently up to 256,000 characters). Truncation is indicated in the UI when applicable.
- Derived debugging views built from the above (Events, Timeline, Raw, Request, Conversation merge output for supported profiles).

### Stored on the device

- Language / UI preference via `chrome.storage`.
- Optional stream archives in IndexedDB when the user explicitly saves a stream. Archives can include the same classes of data listed above (including raw stream text, events, and request payload preview).

### Export / clipboard

- Export JSON/CSV/fixture and Copy actions include whatever is in the selected stream record (for example redacted headers, payload preview, events, and raw text). The developer is responsible for redacting secrets before sharing exports in issues or with third parties.

## What we do not do

- We do not operate a backend that collects Extension data from your browser.
- We do not sell user data.
- We do not use Extension data for advertising.
- We do not intentionally capture passwords from login forms; request body previews only reflect what the page’s streaming `fetch` / XHR / EventSource calls already send.

## Permissions

- **storage** — preferences and optional local archives on the device.
- **Host access (content scripts)** — required to observe streaming responses on pages the developer is debugging. Captured data is shown in the local DevTools panel and, if the user chooses, saved or exported locally.

## Contact

For privacy questions, open an issue at:  
https://github.com/FatMii/sse-devtools-panel/issues
