import { HttpInteraction, HttpRequest, IRequestMatcher } from './types';

export class DefaultRequestMatcher implements IRequestMatcher {
  public compareHeaders: boolean = true;
  public compareBody: boolean = true;
  public readonly ignoreHeaders: Set<string> = new Set<string>();

  public indexOf(calls: HttpInteraction[], request: HttpRequest): number {
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (!this.urlEqual(call.request, request))
        continue;

      if (!this.methodEqual(call.request, request))
        continue;

      if (this.compareHeaders && !this.headersEqual(call.request, request))
        continue;

      if (this.compareBody && !this.bodiesEqual(call.request, request))
        continue;

      return i;
    }

    return -1;
  }

  public bodiesEqual(recorded: HttpRequest, request: HttpRequest) {
    return recorded.body == request.body;
  }

  public headersEqual(recorded: HttpRequest, request: HttpRequest) {
    // Compare recorded headers against request headers
    for (const recordedHeader in recorded.headers) {
      if (this.ignoreHeaders.has(recordedHeader))
        continue;

      if (!request.headers[recordedHeader])
        return false;

      if (recorded.headers[recordedHeader] !== request.headers[recordedHeader])
        return false;
    }

    // Check for headers not present in recorded request
    for (const header in request.headers) {
      if (this.ignoreHeaders.has(header))
        continue;

      if (!recorded.headers[header])
        return false;
    }

    return true;
  }

  public urlEqual(recorded: HttpRequest, request: HttpRequest) {
    return recorded.url === request.url;
  }

  public methodEqual(recorded: HttpRequest, request: HttpRequest) {
    return recorded.method === request.method;
  }
}
