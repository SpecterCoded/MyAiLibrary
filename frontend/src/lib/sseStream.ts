export type SSEPayload = {
  type: string;
  [key: string]: unknown;
};

export class StreamProtocolError extends Error {
  readonly kind: 'server' | 'interrupted' | 'malformed';
  readonly payload?: SSEPayload;

  constructor(
    message: string,
    kind: 'server' | 'interrupted' | 'malformed',
    payload?: SSEPayload,
  ) {
    super(message);
    this.name = 'StreamProtocolError';
    this.kind = kind;
    this.payload = payload;
  }
}

export type SSEStreamResult = {
  final: SSEPayload;
  done: SSEPayload;
  malformedEventCount: number;
};

function parseEventBlock(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return data.length ? data.join('\n') : null;
}

export async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: SSEPayload) => void | Promise<void>,
): Promise<SSEStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: SSEPayload | null = null;
  let donePayload: SSEPayload | null = null;
  let errorPayload: SSEPayload | null = null;
  let malformedEventCount = 0;

  const processBlock = async (block: string) => {
    const raw = parseEventBlock(block.trim());
    if (!raw) return;
    let payload: SSEPayload;
    try {
      payload = JSON.parse(raw) as SSEPayload;
    } catch {
      malformedEventCount += 1;
      return;
    }
    await onEvent(payload);
    if (payload.type === 'final') {
      if (finalPayload) {
        throw new StreamProtocolError('The stream sent more than one final event.', 'malformed', payload);
      }
      finalPayload = payload;
    } else if (payload.type === 'error') {
      errorPayload = payload;
    } else if (payload.type === 'done') {
      if (donePayload) {
        throw new StreamProtocolError('The stream sent more than one done event.', 'malformed', payload);
      }
      donePayload = payload;
    }
  };

  const drain = async (flushTrailing = false) => {
    const boundary = /\r?\n\r?\n/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(buffer)) !== null) {
      await processBlock(buffer.slice(start, match.index));
      start = match.index + match[0].length;
    }
    buffer = buffer.slice(start);
    if (flushTrailing && buffer.trim()) {
      const trailing = buffer;
      buffer = '';
      await processBlock(trailing);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    await drain();
    if (donePayload) {
      try {
        await reader.cancel();
      } catch {
        // The authoritative done event already completed the protocol.
      }
      break;
    }
  }
  buffer += decoder.decode();
  await drain(true);

  if (!donePayload) {
    throw new StreamProtocolError(
      'The connection ended before the server confirmed completion.',
      'interrupted',
      errorPayload || finalPayload || undefined,
    );
  }
  if (errorPayload) {
    const serverError = errorPayload as SSEPayload;
    throw new StreamProtocolError(
      String(serverError.message || 'Streaming request failed.'),
      'server',
      serverError,
    );
  }
  if (!finalPayload) {
    throw new StreamProtocolError(
      'The connection ended without an authoritative final answer.',
      'interrupted',
      donePayload,
    );
  }
  return { final: finalPayload, done: donePayload, malformedEventCount };
}
