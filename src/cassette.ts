import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest';
import { BatchInterceptor } from '@mswjs/interceptors'


import { HttpInteraction, ICassetteStorage, IRequestMatcher, RecordMode, HttpRequest, HttpResponse, HttpRequestMasker, PassThroughHandler, BodyEncoding } from './types';
import assert from 'node:assert';

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
  private readonly allRequests: Map<string, Request> = new Map<string, Request>();

  constructor(
    private readonly storage: ICassetteStorage,
    private readonly matcher: IRequestMatcher,
    private readonly name: string,
    private readonly mode: RecordMode,
    private readonly masker: HttpRequestMasker,
    private readonly passThroughHandler: PassThroughHandler | undefined,
  ) {}

  public isDone(): boolean {
    return this.inProgressCalls === 0;
  }

  public async mount(): Promise<void> {
    const list = await this.storage.load(this.name);
    this.isNew = !list;
    this.list = list ?? [];

    this.interceptor = new BatchInterceptor({
      name: 'my-interceptor',
      interceptors: [
        new ClientRequestInterceptor(),
        new FetchInterceptor(),
      ],
    })

    // Enable the interception of requests.
    this.interceptor.apply();

    this.interceptor.on('request', async ({ request, requestId }) => {
      this.allRequests.set(requestId, request.clone());
      
      const isPassThrough = await this.isPassThrough(request);
      if (isPassThrough) {
        return;
      }

      if (this.mode === RecordMode.none) {
        return this.playback(request);
      }

      if (this.mode === RecordMode.once) {
        return this.recordOnce(request);
      }

      if (this.mode === RecordMode.update) {
        return this.recordNew(request);
      }
    });

    this.interceptor.on('response', async ({ response, requestId }) => {
      const req: Request | undefined = this.allRequests.get(requestId);
      assert.ok(req, `Request with id ${requestId} not found in allRequests map`);

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

      const newInteraction = {
        request: httpRequest,
        response: httpResponse,
      };
      this.list.push(newInteraction);
      this.newInteractions.add(newInteraction);

      this.inProgressCalls = Math.max(0, this.inProgressCalls - 1);
    });
  }

  private async recordNew(request: any): Promise<void> {
    try {
      return await this.playback(request);
    } catch (error) {
      if (error instanceof MatchNotFoundError) {
        this.inProgressCalls++;
        return;
      }
      throw error;
    }
  }

  private async recordOnce(request: any): Promise<void> {
    if (this.isNew) {
      this.inProgressCalls++;
      return;
    }
    return this.playback(request);
  }

  private async playback(request: any): Promise<void> {
    const req = request.clone();
    const reqBody = await consumeBody(req);
    const httpRequest = requestToHttpRequest(req, reqBody.body, reqBody.bodyEncoding);
    this.masker?.(httpRequest);
    const match = this.findMatch(httpRequest);
    if (!match) {
      throw new MatchNotFoundError(httpRequest);
    }

    this.usedInteractions.add(match);

    const body: string | Uint8Array = resolveBodyEncoding(match.response) === 'base64'
      ? Buffer.from(match.response.body, 'base64')
      : match.response.body;

    request.respondWith(new Response(body, {
      status: match.response.status,
      statusText: match.response.statusText,
      headers: match.response.headers,
    }));
  }

  private findMatch(httpRequest: HttpRequest): HttpInteraction | undefined {
    const index = this.matcher.indexOf(this.list, httpRequest);
    if (index >= 0) {
      const [match] = this.list.splice(index, 1);
      return match;
    }
    return undefined;
  }

  private async isPassThrough(request: any) {
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
  var headers: Record<string, string> = {};
  for (const [key, value] of request.headers) {
    headers[key] = value;
  }

  return {
    url: request.url,
    method: request.method,
    headers,
    body,
    bodyEncoding,
  }
}

export function responseToHttpResponse(response: any, body: string, bodyEncoding: BodyEncoding = 'utf8'): HttpResponse {
  var headers: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    headers[key] = value;
  }

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
