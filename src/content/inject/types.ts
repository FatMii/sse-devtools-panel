import type {
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
  StreamReconnectPayload,
  StreamStartPayload,
} from "../../shared/types";

export type PostStart = (p: StreamStartPayload) => void;
export type PostChunk = (p: StreamChunkPayload) => void;
export type PostEnd = (p: StreamEndPayload) => void;
export type PostError = (p: StreamErrorPayload) => void;
export type PostReconnect = (p: StreamReconnectPayload) => void;
export type PostDiscard = (requestId: string) => void;
