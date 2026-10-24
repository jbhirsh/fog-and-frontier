import { describe, expect, it, vi } from 'vitest';
import {
  DELETE_TIMEOUT_MS,
  POLL_MS,
  UPLOAD_TIMEOUT_MS,
  deleteFile,
  uploadFile,
} from './_geminiFiles.js';

const UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const SESSION_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=xyz';
const FILE_URL = 'https://generativelanguage.googleapis.com/v1beta/files/abc';
const VIDEO = Buffer.from('a 17.7 MB reel, say');

const file = (state: string) => ({
  name: 'files/abc',
  uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
  mimeType: 'video/mp4',
  state,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const started = (status = 200, url: string | null = SESSION_URL) =>
  new Response('{}', { status, headers: url ? { 'x-goog-upload-url': url } : {} });

type Call = { url: string; init: RequestInit };

/** A fetch answering each call in turn, noting what it was asked. */
function scripted(...answers: (Response | Error | DOMException)[]) {
  const calls: Call[] = [];
  const impl = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (!answer) return Promise.reject(new Error(`unexpected ${url}`));
    return answer instanceof Response ? Promise.resolve(answer) : Promise.reject(answer);
  });
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

describe('uploadFile', () => {
  it('uploads in one resumable request, then waits until Gemini has processed it', async () => {
    const { fetchImpl, calls } = scripted(
      started(),
      json({ file: file('PROCESSING') }),
      json(file('PROCESSING')),
      json(file('ACTIVE')),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const result = await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl, sleep });
    expect(result).toEqual({
      file: {
        name: 'files/abc',
        uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
        mimeType: 'video/mp4',
      },
    });

    const [start, upload, check] = calls;
    expect(start.url).toBe(UPLOAD_URL);
    expect(start.init.method).toBe('POST');
    expect(start.init.headers).toEqual({
      'x-goog-api-key': 'key',
      'x-goog-upload-protocol': 'resumable',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(VIDEO.length),
      'x-goog-upload-header-content-type': 'video/mp4',
      'content-type': 'application/json',
    });
    expect(JSON.parse(start.init.body as string)).toEqual({
      file: { display_name: 'shared-post' },
    });

    expect(upload.url).toBe(SESSION_URL);
    expect(upload.init.method).toBe('POST');
    expect(upload.init.headers).toEqual({
      'content-length': String(VIDEO.length),
      'x-goog-upload-offset': '0',
      'x-goog-upload-command': 'upload, finalize',
    });
    expect(Buffer.from(upload.init.body as Uint8Array).equals(VIDEO)).toBe(true);

    expect(check.url).toBe(FILE_URL);
    expect(check.init.headers).toEqual({ 'x-goog-api-key': 'key' });
    expect(calls).toHaveLength(4);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(POLL_MS);
    // One time limit for the whole upload.
    for (const call of calls) expect(call.init.signal).toBe(start.init.signal);
    expect(start.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('waits between checks on its own clock when not given one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { fetchImpl, calls } = scripted(
        started(),
        json({ file: file('PROCESSING') }),
        json(file('ACTIVE')),
      );
      const result = uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl });
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ file: { name: 'files/abc' } });
      expect(calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a file Gemini processed straight away', async () => {
    const { fetchImpl, calls } = scripted(started(), json({ file: file('ACTIVE') }));
    const sleep = vi.fn(() => Promise.resolve());
    expect(await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl, sleep })).toMatchObject({
      file: { name: 'files/abc' },
    });
    expect(calls).toHaveLength(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('says why an upload failed', async () => {
    const sleep = () => Promise.resolve();
    const cases: [(Response | Error | DOMException)[], string][] = [
      [[started(403, null)], 'start HTTP 403'],
      [[started(200, null)], 'start HTTP 200'],
      [[started(500)], 'start HTTP 500'],
      [[started(), json({}, 413)], 'upload HTTP 413'],
      [[started(), json({ nothing: true })], 'no file in the answer'],
      [[started(), json({ file: { name: 'files/abc' } })], 'no file in the answer'],
      [[started(), json({ file: { ...file('ACTIVE'), name: 7 } })], 'no file in the answer'],
      [[started(), json({ file: { ...file('ACTIVE'), uri: null } })], 'no file in the answer'],
      [
        [started(), json({ file: { ...file('ACTIVE'), mimeType: undefined } })],
        'no file in the answer',
      ],
      // Answers with no body to let go of.
      [[new Response(null, { status: 403 })], 'start HTTP 403'],
      [[started(), new Response(null, { status: 413 })], 'upload HTTP 413'],
      [
        [started(), json({ file: file('PROCESSING') }), new Response(null, { status: 404 })],
        'check HTTP 404',
      ],
      [[started(), json({ file: file('FAILED') })], 'processing failed'],
      [[started(), json({ file: file('PROCESSING') }), json({}, 404)], 'check HTTP 404'],
      [[started(), json({ file: file('PROCESSING') }), json({ oops: 1 })], 'no file in the answer'],
      [[started(), json({ file: file('PROCESSING') }), json(file('FAILED'))], 'processing failed'],
      [[new DOMException('slow', 'TimeoutError')], 'timed out'],
      [[new Error('socket hang up')], 'socket hang up'],
    ];
    for (const [answers, error] of cases) {
      const { fetchImpl } = scripted(...answers);
      expect(await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl, sleep })).toEqual({ error });
    }
    const odd = vi.fn(() => Promise.reject(JSON.parse('null') as Error)) as unknown as typeof fetch;
    expect(await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl: odd, sleep })).toEqual({
      error: 'failed',
    });
  });

  it('deletes a file Gemini has but can’t use, whatever went wrong after the upload', async () => {
    const sleep = () => Promise.resolve();
    const afterUpload: [(Response | Error | DOMException)[], string][] = [
      [[json({ file: file('FAILED') })], 'processing failed'],
      [[json({ file: file('PROCESSING') }), json({}, 404)], 'check HTTP 404'],
      [[json({ file: file('PROCESSING') }), json({ oops: 1 })], 'no file in the answer'],
      [[json({ file: file('PROCESSING') }), new DOMException('slow', 'TimeoutError')], 'timed out'],
    ];
    for (const [answers, error] of afterUpload) {
      const { fetchImpl, calls } = scripted(
        started(),
        ...answers,
        new Response(null, { status: 200 }),
      );
      expect(await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl, sleep })).toEqual({ error });
      const last = calls[calls.length - 1];
      expect(last.url).toBe(FILE_URL);
      expect(last.init.method).toBe('DELETE');
      expect(last.init.headers).toEqual({ 'x-goog-api-key': 'key' });
    }
    // Before Gemini names a file there's nothing to delete.
    const early = scripted(started(), json({}, 413));
    await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl: early.fetchImpl, sleep });
    expect(early.calls.some((c) => c.init.method === 'DELETE')).toBe(false);
  });

  it('sends the bytes as they are, without copying them', async () => {
    const { fetchImpl, calls } = scripted(started(), json({ file: file('ACTIVE') }));
    await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl });
    expect((calls[1].init.body as Uint8Array).buffer).toBe(VIDEO.buffer);
  });

  it('gives up once its time is up, however long Gemini keeps processing', async () => {
    const answers = [started(), json({ file: file('PROCESSING') })];
    let checks = 0;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      const next = answers.shift();
      if (next) return Promise.resolve(next);
      checks++;
      // The shared time limit has passed by the third check.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      if (checks === 3) return Promise.reject(new DOMException('late', 'TimeoutError'));
      return Promise.resolve(json(file('PROCESSING')));
    }) as unknown as typeof fetch;
    const result = await uploadFile(VIDEO, 'video/mp4', 'key', {
      fetchImpl,
      sleep: () => Promise.resolve(),
      timeoutMs: 1,
    });
    expect(result).toEqual({ error: 'timed out' });
    expect(UPLOAD_TIMEOUT_MS).toBe(45_000);
    expect(POLL_MS).toBe(2000);
  });

  it('lets go of every answer it doesn’t read', async () => {
    const tracked = () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(1));
        },
        cancel() {
          cancelled = true;
        },
      });
      return { cancelled: () => cancelled, body };
    };
    const start = tracked();
    const upload = tracked();
    const { fetchImpl } = scripted(
      new Response(start.body, { headers: { 'x-goog-upload-url': SESSION_URL } }),
      new Response(upload.body, { status: 500 }),
    );
    await uploadFile(VIDEO, 'video/mp4', 'key', { fetchImpl });
    expect([start.cancelled(), upload.cancelled()]).toEqual([true, true]);

    const check = tracked();
    const second = scripted(
      started(),
      json({ file: file('PROCESSING') }),
      new Response(check.body, { status: 503 }),
    );
    await uploadFile(VIDEO, 'video/mp4', 'key', {
      fetchImpl: second.fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(check.cancelled()).toBe(true);
  });
});

describe('deleteFile', () => {
  it('deletes an uploaded file', async () => {
    const { fetchImpl, calls } = scripted(new Response(null, { status: 200 }));
    expect(await deleteFile('files/abc', 'key', fetchImpl)).toBe(true);
    expect(calls[0].url).toBe(FILE_URL);
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.headers).toEqual({ 'x-goog-api-key': 'key' });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(DELETE_TIMEOUT_MS).toBe(5000);
  });

  it('says so when it couldn’t, and never throws', async () => {
    expect(await deleteFile('files/abc', 'key', scripted(json({}, 404)).fetchImpl)).toBe(false);
    expect(await deleteFile('files/abc', 'key', scripted(new Error('reset')).fetchImpl)).toBe(
      false,
    );
  });
});
