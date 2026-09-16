import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest';
import { BatchInterceptor } from '@mswjs/interceptors'
import type { RequestController } from '@mswjs/interceptors'


import { HttpInteraction, ICassetteStorage, IRequestMatcher, RecordMode, HttpRequest, HttpResponse, HttpRequestMasker, HttpResponseMasker, PassThroughHandler, BodyEncoding } from './types';

export class MatchNotFoundError extends Error {
  constructor (public readonly unmatchedHttpRequest: HttpRequest) {
    super(`Match no found for ${unmatchedHttpRequest.method} ${unmatchedHttpRequest.url}`);
  }
}

export class Cassette {
  private interceptor?: BatchInterceptor<any, any>;
  private list: HttpInteraction[] = [];
  private isNew: boolean = false;
  private inProgressCalls: number = 0;
  private usedInteractions: Set<HttpInteraction> = new Set<HttpInteraction>();
  private newInteractions: Set<HttpInteraction> = new Set<HttpInteraction>();
  /**
   * Ids of requests this cassette saw on its own "request" event and has not yet recorded a
   * response for. Consumed on first use, which rejects two kinds of bogus "response" event:
   *
   * - Ids this cassette never issued. The interceptor's emitter is process-global and its
   *   per-request response parsers stay attached to a keep-alive socket after the cassette that
   *   created them is ejected, so a response here may belong to an earlier cassette's request -
   *   including one that cassette deliberately excluded via its pass-through handler.
   * - Repeat responses for an id already recorded. Those same lingering parsers re-parse every
   *   later response on the shared socket, which pairs an earlier request with a later request's
   *   response and writes an exchange that never happened.
   */
  private readonly pendingRequestIds: Set<string> = new Set<string>();

  constructor(
    private readonly storage: ICassetteStorage,
    private readonly matcher: IRequestMatcher,
    private readonly name: string,
    private readonly mode: RecordMode,
    private readonly masker: HttpRequestMasker,
    private readonly responseMasker: HttpResponseMasker,
    private readonly passThroughHandler: PassThroughHandler | undefined,
  ) {}

  public isDone(): boolean {
    return this.inProgressCalls === 0;
  }

  public async mount(): Promise<void> {
    // `all` re-records from scratch: it is defined as "delete the cassette and record it again",
    // so it neither loads what is there nor matches against it. Skipping the load also means a
    // cassette too corrupt to parse can still be repaired by re-recording it.
    const list = this.mode === RecordMode.all ? undefined : await this.storage.load(this.name);
    this.isNew = !list;
    // Cassettes recorded before hop-by-hop headers were stripped still carry them. Normalising on
    // load puts the recorded side through the same filter as the live side, so those cassettes
    // keep matching instead of failing on a header the transport chose.
    this.list = (list ?? []).map(normalizeInteraction);

    this.interceptor = new BatchInterceptor({
      name: 'my-interceptor',
      interceptors: [
        new ClientRequestInterceptor(),
        new FetchInterceptor(),
      ],
    })

    // Enable the interception of requests.
    this.interceptor.apply();

    this.interceptor.on('request', async ({ request, requestId, controller }) => {
      this.pendingRequestIds.add(requestId);

      const isPassThrough = await this.isPassThrough(request);
      if (isPassThrough) {
        return;
      }

      try {
        if (this.mode === RecordMode.none) {
          return await this.playback(request, controller);
        }

        if (this.mode === RecordMode.once) {
          return await this.recordOnce(request, controller);
        }

        if (this.mode === RecordMode.update) {
          return await this.recordNew(request, controller);
        }

        if (this.mode === RecordMode.all) {
          // Nothing is replayed, so every request goes to the network. Count it so that eject
          // waits for the response instead of saving a cassette missing it.
          this.inProgressCalls++;
          return;
        }
      } catch (error) {
        if (error instanceof MatchNotFoundError) {
          // Letting this escape the listener would have the interceptor turn it into a 200-shaped
          // HTTP 500 whose body is the serialized error, so the caller would carry on against a
          // fake response. Erroring the request instead keeps "no recording matched" a failure.
          controller.errorWith(error);
          return;
        }
        throw error;
      }
    });

    this.interceptor.on('response', async ({ request, requestId, response, responseType }) => {
      if (response.status < 200) {
        // Informational (1xx); the final response for this request is still to come.
        return;
      }

      if (!this.pendingRequestIds.delete(requestId)) {
        return;
      }

      if (responseType === 'mock') {
        // Our own replay coming back around. Recording it would re-add an interaction that is
        // already in the cassette and decrement a call this cassette never counted as started.
        return;
      }

      const req: Request = request.clone();

      const isPassThrough = await this.isPassThrough(req);
      if (isPassThrough) {
        return;
      }
      
      const res: Response = response.clone();

      const reqBody = await consumeBody(req);
      const resBody = await consumeBody(res);
      const httpRequest = requestToHttpRequest(req, reqBody.body, reqBody.bodyEncoding);
      const httpResponse = responseToHttpResponse(res, resBody.body, resBody.bodyEncoding);

      this.masker(httpRequest);
      // Masked first, so the response masker sees the request exactly as the cassette will carry it.
      this.responseMasker(httpResponse, httpRequest);
      // Masking rewrites bodies, which leaves the recorded framing headers describing a body that
      // is no longer there. Restating them here keeps the cassette consistent on disk, so the
      // repairs in replayHeaders() are only ever needed for cassettes recorded before this.
      normalizeRecordedResponse(httpResponse);

      const newInteraction = {
        request: httpRequest,
        response: httpResponse,
      };
      this.list.push(newInteraction);
      this.newInteractions.add(newInteraction);

      this.inProgressCalls = Math.max(0, this.inProgressCalls - 1);
    });
  }

  private async recordNew(request: Request, controller: RequestController): Promise<void> {
    try {
      return await this.playback(request, controller);
    } catch (error) {
      if (error instanceof MatchNotFoundError) {
        this.inProgressCalls++;
        return;
      }
      throw error;
    }
  }

  private async recordOnce(request: Request, controller: RequestController): Promise<void> {
    if (this.isNew) {
      this.inProgressCalls++;
      return;
    }
    return this.playback(request, controller);
  }

  private async playback(request: Request, controller: RequestController): Promise<void> {
    const req = request.clone();
    const reqBody = await consumeBody(req);
    const httpRequest = requestToHttpRequest(req, reqBody.body, reqBody.bodyEncoding);
    this.masker?.(httpRequest);
    const match = this.findMatch(httpRequest);
    if (!match) {
      throw new MatchNotFoundError(httpRequest);
    }

    this.usedInteractions.add(match);

    // 204/205/304 carry no body at all - `new Response('', { status: 204 })` throws outright.
    const body: string | Uint8Array | null = NULL_BODY_STATUSES.has(match.response.status)
      ? null
      : resolveBodyEncoding(match.response) === 'base64'
        ? Buffer.from(match.response.body, 'base64')
        : match.response.body;

    controller.respondWith(new Response(body, {
      status: match.response.status,
      statusText: match.response.statusText,
      headers: replayHeaders(match.response.headers, body, (repair) => {
        console.warn(`vcr-test: cassette "${this.name}" ${repair}. Re-record it to silence this.`);
      }),
    }));
  }

  private findMatch(httpRequest: HttpRequest): HttpInteraction | undefined {
    // Only interactions that have not been replayed yet are candidates, so one recording serves
    // one replay. They stay in `this.list` rather than being spliced out, so that eject() can
    // still tell a replayed interaction apart from one this cassette never touched.
    const candidates = this.list.filter((interaction) => !this.usedInteractions.has(interaction));
    const index = this.matcher.indexOf(candidates, httpRequest);
    if (index >= 0) {
      return candidates[index];
    }
    return undefined;
  }

  private async isPassThrough(request: Request) {
    if (this.passThroughHandler) {
      const req = request.clone();
      const reqBody = await consumeBody(req);
      const httpRequest = requestToHttpRequest(req, reqBody.body, reqBody.bodyEncoding);
      return this.passThroughHandler(httpRequest);
    }
    return false;
  }

  public async eject(): Promise<void> {
    this.interceptor?.dispose();
    if (this.mode === RecordMode.none) {
      return;
    }

    if (this.mode === RecordMode.once && !this.isNew) {
      return;
    }

    if (this.mode === RecordMode.update && !this.isNew) {
      // delete unsued interactions
      this.list = this.list.filter((interaction) => this.newInteractions.has(interaction) || this.usedInteractions.has(interaction));
    }

    await this.storage.save(this.name, this.list);
  }
}

export function requestToHttpRequest(request: Request, body: string, bodyEncoding: BodyEncoding = 'utf8'): HttpRequest {
  const headers = withoutHopByHopHeaders(request.headers);

  return {
    url: request.url,
    method: request.method,
    headers,
    body,
    bodyEncoding,
  }
}

export function responseToHttpResponse(response: any, body: string, bodyEncoding: BodyEncoding = 'utf8'): HttpResponse {
  const headers = withoutHopByHopHeaders(response.headers);

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    bodyEncoding,
  }
}

type ConsumedBody = {
  body: string;
  bodyEncoding: BodyEncoding;
}

/**
 * Reads the body of a request/response and encodes it so it survives a round-trip
 * through the cassette. Text is stored verbatim for readability; anything that is not
 * losslessly representable as UTF-8 text (tarballs, images, raw gzip files, protobuf, ...)
 * is stored as base64.
 */
async function consumeBody(req: Request | Response): Promise<ConsumedBody> {
  const bytes = Buffer.from(await req.arrayBuffer());

  if (isCompressed(req.headers.get('content-encoding'))) {
    return { body: bytes.toString('base64'), bodyEncoding: 'base64' };
  }

  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    // Not valid UTF-8: decoding replaced bytes with U+FFFD and the original bytes are unrecoverable.
    return { body: bytes.toString('base64'), bodyEncoding: 'base64' };
  }

  return { body: text, bodyEncoding: 'utf8' };
}

/**
 * Resolves how a recorded body was stored. Cassettes recorded before `bodyEncoding`
 * existed only ever stored base64 for compressed bodies, so fall back to that.
 */
function resolveBodyEncoding(response: HttpResponse): BodyEncoding {
  if (response.bodyEncoding) {
    return response.bodyEncoding;
  }
  // Legacy cassettes: only gzip was ever base64 encoded.
  const contentEncoding = response.headers['content-encoding'];
  return !!contentEncoding && contentEncoding.indexOf('gzip') >= 0 ? 'base64' : 'utf8';
}

function isCompressed(contentEncoding: string | undefined | null): boolean {
  return !!contentEncoding && /\b(gzip|x-gzip|br|deflate|zstd|compress)\b/i.test(contentEncoding);
}

/**
 * Connection-management ("hop-by-hop") headers: the list is the one enumerated in RFC 2616
 * section 13.5.1, plus the non-standard but widely used `proxy-connection`; RFC 9110 section
 * 7.6.1 describes the concept. They describe a single connection rather than the message, which
 * is why a proxy has to drop them before forwarding. A cassette is a proxy across time - it
 * replays a message onto a connection that did not exist when the recording was made - so the
 * same rule applies:
 *
 * - Replaying `connection: keep-alive` makes the HTTP client pool the interceptor's mock socket.
 *   Once the cassette is ejected and the interceptor disposed that socket is orphaned, and the
 *   next cassette's request is dispatched onto it and never answered.
 * - Replaying `transfer-encoding: chunked` would send the parser looking for chunk framing that
 *   the recorded body, already de-chunked, does not have.
 * - They vary with the transport rather than the call, so matching on them makes a cassette
 *   depend on how the request happened to be sent.
 */
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
]);

/**
 * Copies header entries, dropping the hop-by-hop ones. Takes an iterable of pairs so it accepts
 * both a live `Headers` and `Object.entries()` of a recorded header record, which keeps captured
 * and replayed headers normalised by exactly the same code.
 */
function withoutHopByHopHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function normalizeInteraction(interaction: HttpInteraction): HttpInteraction {
  return {
    request: {
      ...interaction.request,
      headers: withoutHopByHopHeaders(Object.entries(interaction.request.headers)),
    },
    response: {
      ...interaction.response,
      headers: withoutHopByHopHeaders(Object.entries(interaction.response.headers)),
    },
  };
}

/** Statuses whose response is defined to have no body; `new Response` rejects one that does. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** Encodings whose payload starts with a signature we can positively identify. */
const ENCODING_SIGNATURES: ReadonlyMap<string, (head: Uint8Array) => boolean> = new Map([
  ['gzip', (h: Uint8Array) => h.length >= 2 && h[0] === 0x1f && h[1] === 0x8b],
  ['x-gzip', (h: Uint8Array) => h.length >= 2 && h[0] === 0x1f && h[1] === 0x8b],
  ['zstd', (h: Uint8Array) => h.length >= 4 && h[0] === 0x28 && h[1] === 0xb5 && h[2] === 0x2f && h[3] === 0xfd],
]);

type RepairReporter = (repair: string) => void;

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  return Object.keys(headers).find((key) => key.toLowerCase() === name);
}

function withoutHeader(headers: Record<string, string>, name: string): Record<string, string> {
  const key = findHeader(headers, name);
  if (!key) {
    return headers;
  }
  const { [key]: _removed, ...rest } = headers;
  return rest;
}

/**
 * True when the declared encoding is one we can identify and the bytes are not in it.
 *
 * `br` and raw `deflate` have no signature, and a value naming several codings is not worth
 * guessing at, so those are reported as consistent rather than second-guessed.
 */
function contradictsDeclaredEncoding(declared: string, head: Uint8Array): boolean {
  const isExpected = ENCODING_SIGNATURES.get(declared.trim().toLowerCase());
  return isExpected !== undefined && !isExpected(head);
}

function bodyBytes(response: HttpResponse): Buffer {
  return resolveBodyEncoding(response) === 'base64'
    ? Buffer.from(response.body, 'base64')
    : Buffer.from(response.body, 'utf8');
}

/**
 * Brings a freshly recorded response's framing headers back in line with its own body.
 *
 * `content-length` describes the body as it arrived, which is not the body being stored once a
 * response masker has rewritten it. `content-encoding` can likewise describe the wire response
 * while the body captured from the client is already decoded. Fixing both at record time is what
 * keeps a cassette self-consistent; replay only has to repair what older cassettes got wrong.
 */
function normalizeRecordedResponse(response: HttpResponse): void {
  const bytes = bodyBytes(response);

  const encodingKey = findHeader(response.headers, 'content-encoding');
  if (encodingKey && contradictsDeclaredEncoding(response.headers[encodingKey], bytes)) {
    delete response.headers[encodingKey];
  }

  const lengthKey = findHeader(response.headers, 'content-length');
  if (lengthKey) {
    response.headers[lengthKey] = String(bytes.length);
  }
}

/**
 * Builds the headers for a replayed response.
 *
 * Up to 0.23 of the interceptors a mocked response was handed straight back to the caller, so
 * headers describing the transport were inert on replay. From 0.42 it is serialised over a socket
 * that Node's real HTTP stack reads, so those headers are obeyed - and a cassette whose headers no
 * longer describe its own body now fails, usually without naming the header at fault. Anything
 * repaired here is reported, because the durable fix is to re-record.
 */
function replayHeaders(
  recorded: Record<string, string>,
  body: string | Uint8Array | null,
  onRepair: RepairReporter,
): Record<string, string> {
  const stripped = withoutHopByHopHeaders(Object.entries(recorded));

  const headers = body === null
    ? withoutHeader(stripped, 'content-length')
    : withAccurateContentLength(withVerifiedContentEncoding(stripped, body, onRepair), body, onRepair);

  return {
    ...headers,
    // The "connection" here is the interceptor's mock socket, which lives only as long as this
    // cassette. Letting the client pool it means a later request - to the same origin, after this
    // cassette was ejected and its interceptor disposed - gets dispatched onto a socket nobody is
    // listening on any more, and hangs forever.
    connection: 'close',
  };
}

/**
 * Drops a `content-encoding` the recorded body demonstrably is not in. Replaying it would make the
 * client try to inflate plaintext and fail with zlib's "incorrect header check", which says
 * nothing about the cassette.
 */
function withVerifiedContentEncoding(
  headers: Record<string, string>,
  body: string | Uint8Array,
  onRepair: RepairReporter,
): Record<string, string> {
  const key = findHeader(headers, 'content-encoding');
  if (!key) {
    return headers;
  }

  const declared = headers[key];
  const head = typeof body === 'string' ? Buffer.from(body.slice(0, 8), 'utf8') : body.subarray(0, 8);
  if (!contradictsDeclaredEncoding(declared, head)) {
    return headers;
  }

  onRepair(`declares "content-encoding: ${declared}" but its body is not ${declared}, so the header was dropped`);
  return withoutHeader(headers, 'content-encoding');
}

/**
 * Restates `content-length` from the body actually being replayed. Declare one byte too many and
 * the parser waits forever for a byte that never arrives; one byte too few and the body is
 * silently truncated. Only restated when the recording had the header, so chunked stays chunked.
 */
function withAccurateContentLength(
  headers: Record<string, string>,
  body: string | Uint8Array,
  onRepair: RepairReporter,
): Record<string, string> {
  const key = findHeader(headers, 'content-length');
  if (!key) {
    return headers;
  }

  const byteLength = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
  if (headers[key] === String(byteLength)) {
    return headers;
  }

  onRepair(`declares "content-length: ${headers[key]}" but its body is ${byteLength} bytes`);
  return { ...headers, [key]: String(byteLength) };
}
