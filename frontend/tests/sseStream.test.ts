import { describe, expect, it } from 'vitest';
import { consumeSSEStream, StreamProtocolError } from '../src/lib/sseStream';

function fragmentedBody(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)));
      controller.close();
    },
  });
}

describe('consumeSSEStream', () => {
  it('handles fragmented JSON, CRLF, malformed data, and a trailing event', async () => {
    const seen: string[] = [];
    const result = await consumeSSEStream(
      fragmentedBody([
        'data: {"type":"tok',
        'en","content":"A"}\r\n\r\n',
        'data: {malformed}\r\n\r\n',
        'data: {"type":"final","answer":"Answer"}\r\n\r\n',
        'data: {"type":"done","completion_status":"complete"}',
      ]),
      (event) => seen.push(event.type),
    );
    expect(seen).toEqual(['token', 'final', 'done']);
    expect(result.final.answer).toBe('Answer');
    expect(result.malformedEventCount).toBe(1);
  });

  it('rejects streams missing final or done instead of silently succeeding', async () => {
    await expect(
      consumeSSEStream(
        fragmentedBody(['data: {"type":"token","content":"partial"}\n\n']),
        () => undefined,
      ),
    ).rejects.toMatchObject<Partial<StreamProtocolError>>({ kind: 'interrupted' });
  });

  it('accepts the error then done failure contract', async () => {
    await expect(
      consumeSSEStream(
        fragmentedBody([
          'data: {"type":"error","message":"failed"}\n\n',
          'data: {"type":"done","completion_status":"interrupted"}\n\n',
        ]),
        () => undefined,
      ),
    ).rejects.toMatchObject<Partial<StreamProtocolError>>({ kind: 'server' });
  });

  it('stops reading after the authoritative done event', async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(encoder.encode(
            'data: {"type":"final","answer":"Complete"}\n\n'
            + 'data: {"type":"done","completion_status":"complete"}\n\n',
          ));
          return;
        }
        controller.error(new Error('transport cleanup failed after done'));
      },
    });

    const result = await consumeSSEStream(body, () => undefined);
    expect(result.final.answer).toBe('Complete');
    expect(result.done.completion_status).toBe('complete');
  });
});
