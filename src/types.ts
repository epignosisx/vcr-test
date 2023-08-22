
export type HttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type HttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export type HttpInteraction = {
  request: HttpRequest;
  response: HttpResponse;
}

export enum RecordMode {
  /**
   * Do not record any HTTP interactions; play them back.
   */
  none = 'none',

  /**
   * Record the HTTP interactions if the cassette has not been recorded;
   * otherwise, playback the HTTP interactions.
   */
  once = 'once',

  /**
   * Record every HTTP interactions; do not play any back.
   */
  all = 'all'
}

export interface ICassetteStorage {
  load(name: string): Promise<HttpInteraction[] | undefined>;
  save(name: string, interactions: HttpInteraction[]): Promise<void>;
}

export interface IRequestMatcher {
  indexOf(calls: HttpInteraction[], request: HttpRequest): number;
}