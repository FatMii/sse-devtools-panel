import { MESSAGE_SOURCE, type PageToExtensionMessage } from "../shared/types";
import { patchEventSource } from "./inject/patch-eventsource";
import { patchFetch } from "./inject/patch-fetch";
import { patchXhr } from "./inject/patch-xhr";
import type {
  PostChunk,
  PostDiscard,
  PostEnd,
  PostError,
  PostReconnect,
  PostStart,
} from "./inject/types";

const STATE_KEY = "__EVENTSTREAM_PANEL_INSTALLED__";

declare global {
  interface Window {
    [STATE_KEY]?: boolean;
  }
}

if (!window[STATE_KEY]) {
  window[STATE_KEY] = true;
  install();
}

function install(): void {
  let seq = 0;
  const nextId = () => `sse-${Date.now()}-${++seq}`;

  const post = (msg: PageToExtensionMessage): void => {
    window.postMessage(msg, "*");
  };

  const postStart: PostStart = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-start", payload });
  const postChunk: PostChunk = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-chunk", payload });
  const postEnd: PostEnd = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-end", payload });
  const postError: PostError = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-error", payload });
  const postReconnect: PostReconnect = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-reconnect", payload });
  const postDiscard: PostDiscard = (requestId) =>
    post({ source: MESSAGE_SOURCE, type: "stream-discard", payload: { requestId } });

  patchFetch(nextId, postStart, postChunk, postEnd, postError, postDiscard);
  patchEventSource(nextId, postStart, postChunk, postEnd, postError, postReconnect);
  patchXhr(nextId, postStart, postChunk, postEnd, postError);
}
