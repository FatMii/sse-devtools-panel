import { classifyThrownError } from "../../shared/stream-close";
import type { StreamCloseReason } from "../../shared/types";
import type { PostChunk, PostEnd, PostError } from "./types";

export async function pumpReadableStream(
  body: ReadableStream<Uint8Array>,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        sink.onBytes(value);
      }
    }
    sink.onComplete();
  } catch (err) {
    const classified = classifyThrownError(err);
    sink.onError(classified.message, classified.closeReason);
  }
}

export function createFetchTextSink(
  requestId: string,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): {
  onBytes: (chunk: Uint8Array) => void;
  onComplete: () => void;
  onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
} {
  const decoder = new TextDecoder();
  let closed = false;

  const flushText = (chunk: Uint8Array | undefined, stream: boolean): void => {
    const text = chunk ? decoder.decode(chunk, { stream }) : decoder.decode();
    if (text) {
      postChunk({ requestId, text });
    }
  };

  return {
    onBytes: (chunk) => {
      if (closed) return;
      flushText(chunk, true);
    },
    onComplete: () => {
      if (closed) return;
      closed = true;
      flushText(undefined, false);
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    },
    onError: (message, closeReason = "error") => {
      if (closed) return;
      closed = true;
      flushText(undefined, false);
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    },
  };
}

/**
 * Connect+JSON: split binary frames in the page world, post each JSON payload as text.
 * (Panel ConnectJsonParser then turns each object into an event.)
 */
export function createConnectJsonSink(
  requestId: string,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): {
  onBytes: (chunk: Uint8Array) => void;
  onComplete: () => void;
  onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
} {
  // Connect framer inlined (no shared imports in page inject).
  const MAX_FRAME = 16 * 1024 * 1024;
  let buffer = new Uint8Array(0);
  let closed = false;
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const emitFrames = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return;
    const merged = new Uint8Array(buffer.length + chunk.byteLength);
    merged.set(buffer, 0);
    merged.set(chunk, buffer.length);
    buffer = merged;

    let offset = 0;
    while (buffer.length - offset >= 5) {
      const flags = buffer[offset]!;
      const length =
        ((buffer[offset + 1]! << 24) |
          (buffer[offset + 2]! << 16) |
          (buffer[offset + 3]! << 8) |
          buffer[offset + 4]!) >>>
        0;
      if (length > MAX_FRAME) {
        offset += 1;
        continue;
      }
      if (buffer.length - offset < 5 + length) break;
      const payload = buffer.subarray(offset + 5, offset + 5 + length);
      offset += 5 + length;
      // flag & 0x02 = end-stream / trailer; flag & 0x01 = compressed
      if ((flags & 0x02) !== 0 || (flags & 0x01) !== 0) continue;
      const jsonText = decoder.decode(payload).trim();
      if (jsonText) postChunk({ requestId, text: jsonText });
    }
    buffer = buffer.subarray(offset);
  };

  return {
    onBytes: (chunk) => {
      if (closed) return;
      emitFrames(chunk);
    },
    onComplete: () => {
      if (closed) return;
      closed = true;
      buffer = new Uint8Array(0);
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    },
    onError: (message, closeReason = "error") => {
      if (closed) return;
      closed = true;
      buffer = new Uint8Array(0);
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    },
  };
}

/**
 * Observe bytes as the page consumes the body (instance-level reader wrap only).
 * Avoids tee()/new Response(), which can disturb some app stream consumers.
 */
export function observeStreamReads(
  stream: ReadableStream<Uint8Array>,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): void {
  const originalGetReader = stream.getReader.bind(stream);

  const wrapReader = <R extends ReadableStreamDefaultReader<Uint8Array> | ReadableStreamBYOBReader>(
    reader: R,
  ): R => {
    const originalRead = reader.read.bind(
      reader,
    ) as ReadableStreamDefaultReader<Uint8Array>["read"];
    const originalCancel = reader.cancel.bind(reader);

    (reader as ReadableStreamDefaultReader<Uint8Array>).read = (async (
      ...readArgs: Parameters<ReadableStreamDefaultReader<Uint8Array>["read"]>
    ) => {
      try {
        const result = await originalRead(...readArgs);
        if (result.done) {
          sink.onComplete();
        } else if ("value" in result && result.value) {
          const value = result.value as unknown;
          if (value instanceof Uint8Array) {
            sink.onBytes(value);
          } else if (ArrayBuffer.isView(value)) {
            const view = value as ArrayBufferView;
            sink.onBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
          }
        }
        return result;
      } catch (err) {
        const classified = classifyThrownError(err);
        sink.onError(classified.message, classified.closeReason);
        throw err;
      }
    }) as ReadableStreamDefaultReader<Uint8Array>["read"];

    reader.cancel = (async (
      ...cancelArgs: Parameters<ReadableStreamDefaultReader<Uint8Array>["cancel"]>
    ) => {
      sink.onError("ReadableStream cancelled", "abort");
      return originalCancel(...cancelArgs);
    }) as ReadableStreamDefaultReader<Uint8Array>["cancel"];

    return reader;
  };

  Object.defineProperty(stream, "getReader", {
    configurable: true,
    writable: true,
    value: (...args: Parameters<ReadableStream<Uint8Array>["getReader"]>) => {
      const reader = originalGetReader(...(args as []));
      return wrapReader(reader as ReadableStreamDefaultReader<Uint8Array>);
    },
  });
}

/**
 * Capture fetch body bytes.
 * Prefer clone()+pump so we do not depend on the page starting to read.
 * Fall back to instance-level getReader observation on the page body.
 */
export function captureFetchResponseBody(
  response: Response,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): Response {
  if (!response.body) {
    sink.onComplete();
    return response;
  }

  try {
    const cloned = response.clone();
    if (cloned.body) {
      void pumpReadableStream(cloned.body, sink);
      return response;
    }
  } catch {
    // fall through to page-read observation
  }

  observeStreamReads(response.body, sink);

  try {
    const originalClone = response.clone.bind(response);
    Object.defineProperty(response, "clone", {
      configurable: true,
      writable: true,
      value: () => {
        const cloned = originalClone();
        if (cloned.body) {
          observeStreamReads(cloned.body, sink);
        }
        return cloned;
      },
    });
  } catch {
    // ignore
  }

  return response;
}
