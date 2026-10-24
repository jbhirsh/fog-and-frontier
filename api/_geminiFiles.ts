// Media too big to send Gemini inline (#6): a reel's video over the 20 MB a
// request may carry goes through the Files API instead. It's uploaded in one
// resumable request, which Gemini then processes; once it's ACTIVE a request
// refers to it by URI, and it's deleted once Gemini has answered (it would
// expire after 48 hours anyway).
// https://ai.google.dev/gemini-api/docs/generate-content/video-understanding
//
// Never throws: an upload that fails says why, and the caller goes on
// without the video. A file Gemini has but can't use (still processing when
// time's up, say) is deleted then and there.

const UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const FILES_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** How long an upload may take, processing included, before it's given up. */
export const UPLOAD_TIMEOUT_MS = 45_000;
/** How often an uploaded file is checked while Gemini processes it. */
export const POLL_MS = 2000;
/** How long deleting a file may take: it's tidying, so not long. */
export const DELETE_TIMEOUT_MS = 5000;

type Fetch = typeof fetch;

export interface GeminiFile {
  /** files/<id>, for checking on it and deleting it. */
  name: string;
  /** What a request refers to it by. */
  uri: string;
  mimeType: string;
}

interface FileResource {
  name?: unknown;
  uri?: unknown;
  mimeType?: unknown;
  state?: unknown;
}

export interface UploadOptions {
  fetchImpl?: Fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function fileOf(resource: FileResource | undefined): (GeminiFile & { state: unknown }) | null {
  if (!resource) return null;
  const { name, uri, mimeType, state } = resource;
  if (typeof name !== 'string' || typeof uri !== 'string' || typeof mimeType !== 'string') return null;
  return { name, uri, mimeType, state };
}

type Uploaded = { file: GeminiFile } | { error: string };

/** Uploads `data` to Gemini's Files API, and waits until it can be used. */
export async function uploadFile(
  data: Buffer,
  mimeType: string,
  apiKey: string,
  { fetchImpl = fetch, timeoutMs = UPLOAD_TIMEOUT_MS, sleep = wait }: UploadOptions = {},
): Promise<Uploaded> {
  const made: { name?: string } = {};
  const result = await uploadAndWait(data, mimeType, apiKey, { fetchImpl, timeoutMs, sleep }, made);
  if ('error' in result && made.name) await deleteFile(made.name, apiKey, fetchImpl);
  return result;
}

async function uploadAndWait(
  data: Buffer,
  mimeType: string,
  apiKey: string,
  { fetchImpl, timeoutMs, sleep }: Required<UploadOptions>,
  made: { name?: string },
): Promise<Uploaded> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const start = await fetchImpl(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(data.length),
        'x-goog-upload-header-content-type': mimeType,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'shared-post' } }),
      signal,
    });
    await start.body?.cancel();
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!start.ok || !uploadUrl) return { error: `start HTTP ${start.status}` };

    const sent = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        'content-length': String(data.length),
        'x-goog-upload-offset': '0',
        'x-goog-upload-command': 'upload, finalize',
      },
      // A view of the bytes, not a copy: a video may be 60 MB.
      body: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      signal,
    });
    if (!sent.ok) {
      await sent.body?.cancel();
      return { error: `upload HTTP ${sent.status}` };
    }
    let file = fileOf(((await sent.json()) as { file?: FileResource }).file);
    if (!file) return { error: 'no file in the answer' };
    made.name = file.name;

    // A video is processed before it can be used.
    while (file.state !== 'ACTIVE') {
      if (file.state === 'FAILED') return { error: 'processing failed' };
      await sleep(POLL_MS);
      const checked = await fetchImpl(`${FILES_URL}/${file.name}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal,
      });
      if (!checked.ok) {
        await checked.body?.cancel();
        return { error: `check HTTP ${checked.status}` };
      }
      file = fileOf((await checked.json()) as FileResource);
      if (!file) return { error: 'no file in the answer' };
    }
    return { file: { name: file.name, uri: file.uri, mimeType: file.mimeType } };
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'TimeoutError') return { error: 'timed out' };
    return { error: err instanceof Error ? err.message : 'failed' };
  }
}

/** Deletes an uploaded file. Never throws: an undeleted file expires anyway. */
export async function deleteFile(name: string, apiKey: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(`${FILES_URL}/${name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}
