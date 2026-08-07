# Privacy Policy for SSE DevTools Panel

Last updated: 2026-08-07

SSE DevTools Panel ("the Extension") is a Chrome DevTools extension for debugging streaming responses (SSE, EventSource, NDJSON, and Connect+JSON).

## Data we handle

- Stream data that the page already receives may be shown in the local DevTools panel for debugging.
- Language preference may be stored with `chrome.storage`.
- Optional stream archives may be stored locally (for example IndexedDB) when the user chooses to save them.

## What we do not do

- We do not operate a backend that collects this data from the Extension.
- We do not sell user data.
- We do not use Extension data for advertising.

## Permissions

- **storage** — preferences and optional local archives on the device.
- **Host access (content scripts)** — required to capture streaming responses on pages the developer is debugging. Captured data is shown only in the local DevTools panel.

## Contact

For privacy questions, open an issue at:  
https://github.com/FatMii/sse-devtools-panel/issues
