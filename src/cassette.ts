import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest';
import { HttpInteraction, ICassetteStorage, IRequestMatcher, RecordMode, HttpRequest, HttpResponse } from './types';

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
    private readonly mode: RecordMode
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

    this.interceptor.on('request', async (request, requestId) => {
      this.inProgressCalls++;
      if (this.mode === RecordMode.none) {
        return this.playback(request);
      }

      if (this.mode === RecordMode.once) {
        return this.recordOnce(request);
      }
    });

    this.interceptor.on('response', async (response, request) => {
      if (this.mode === RecordMode.none) {
        throw new Error('Impossible');
      }

      const req = request.clone();
      const res = response.clone();
      const httpRequest = requestToHttpRequest(req, await req.text());
      const httpResponse = responseToHttpResponse(res, await res.text());

      this.list.push({
        request: httpRequest,
        response: httpResponse,
      });

      this.inProgressCalls--;
    });
  }

  private async recordOnce(request: any): Promise<void> {
    if (this.isNew) {
      return;
    }
    return this.playback(request);
  }

  private async playback(request: any): Promise<void> {
    const req = request.clone();
    const httpRequest = requestToHttpRequest(req, await req.text());
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
    await this.storage.save(this.name, this.list);
    this.interceptor?.dispose();
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