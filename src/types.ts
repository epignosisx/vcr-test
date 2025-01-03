
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
   * Records new HTTP interactions, plays back the recorded ones, deletes the rest.
   */
  update = 'update',

  /**
   * Record every HTTP interactions; do not play any back.
   */
  all = 'all'
}

/**
 * Cassette storage
 */
export interface ICassetteStorage {
  /**
   * Loads a cassette from storage or undefined if not found.
   * @param {string} name cassette name
   * @returns {Promise<HttpInteraction[] | undefined>}
   */
  load(name: string): Promise<HttpInteraction[] | undefined>;

  /**
   * Saves HTTP traffic to a cassette with the specified name
   * @param {string} name cassette name
   * @param {HttpInteraction[]} interactions HTTP traffic
   * @returns {Promise<void>}
   */
  save(name: string, interactions: HttpInteraction[]): Promise<void>;
}

/**
 * Matches an app request against a list of HTTP interactions previously recorded
 */
export interface IRequestMatcher {
  /**
   * Finds the index of the recorded HTTP interaction that matches a given request
   * @param {HttpInteraction[]} calls recorded HTTP interactions
   * @param {HttpRequest} request app request
   * @returns {number} the index of the match or -1 if not found
   */
  indexOf(calls: HttpInteraction[], request: HttpRequest): number;
}

export type HttpRequestMasker = (httpRequest: HttpRequest) => void;