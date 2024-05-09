import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest';
import { HttpInteraction, ICassetteStorage, IRequestMatcher, RecordMode, HttpRequest, HttpResponse, HttpRequestMasker } from './types';

export class MatchNotFoundError extends Error {
  constructor (public readonly unmatchedHttpRequest: HttpRequest) {
    super(`Match no found for ${unmatchedHttpRequest.method} ${unmatchedHttpRequest.url}`);
  }
}

export class Cassette {
  private interceptor?: ClientRequestInterceptor;
  private list: HttpInteraction[] = [];
  private isNew: boolean = false;
  private inProgressCalls: number = 0;

  constructor(
    private readonly storage: ICassetteStorage,
    private readonly matcher: IRequestMatcher,
    private readonly name: string,
    private readonly mode: RecordMode,
    private readonly masker: HttpRequestMasker,
  ) {}

  public isDone(): boolean {
    return this.inProgressCalls === 0;
  }

  public async mount(): Promise<void> {
    const list = await this.storage.load(this.name);
    this.isNew = !list;
    this.list = list ?? [];
    this.interceptor = new ClientRequestInterceptor();

    // Enable the interception of requests.
    this.interceptor.apply();

    this.interceptor.on('request', async ({ request, requestId }) => {
      if (this.mode === RecordMode.none) {
        return this.playback(request);
      }

      if (this.mode === RecordMode.once) {
        return this.recordOnce(request);
      }

      throw new Error('Unknown mode: ' + this.mode);
    });

    this.interceptor.on('response', async ({ response, request }) => {
      const req = request.clone();
      const res: any = response.clone();

      const reqBody = isGzipped(req.headers) ? Buffer.from(await req.arrayBuffer()).toString('base64') : await req.text();
      const resBody = isGzipped(res.headers) ? Buffer.from(await res.arrayBuffer()).toString('base64') : await res.text();
      const httpRequest = requestToHttpRequest(req, reqBody);
      const httpResponse = responseToHttpResponse(res, resBody);

      this.masker(httpRequest);

      this.list.push({
        request: httpRequest,
        response: httpResponse,
      });

      this.inProgressCalls = Math.max(0, this.inProgressCalls - 1);
    });
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
    const httpRequest = requestToHttpRequest(req, await req.text());
    this.masker(httpRequest);
    const match = this.findMatch(httpRequest);
    if (!match) {
      throw new MatchNotFoundError(httpRequest);
    }

    request.respondWith(new Response(match.response.body, {
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

  public async eject(): Promise<void> {
    this.interceptor?.dispose();
    if (this.mode === RecordMode.none) {
      return;
    }

    if (this.mode === RecordMode.once && !this.isNew) {
      return;
    }

    await this.storage.save(this.name, this.list);
  }
}

export function requestToHttpRequest(request: any, body: string): HttpRequest {
  var headers: Record<string, string> = {};
  for (const [key, value] of request.headers) {
    headers[key] = value;
  }

  return {
    url: request.url,
    method: request.method,
    headers,
    body,
  }
}

export function responseToHttpResponse(response: any, body: string): HttpResponse {
  var headers: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    headers[key] = value;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  }
}

function isGzipped(headers: Map<string, string>): boolean {
  const header = headers.get('content-encoding');
  return !!header && header.indexOf('gzip') >= 0;
}