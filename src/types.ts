
/**
 * How a body is represented in the cassette.
 * `utf8` stores the body verbatim as text, `base64` stores the raw bytes base64 encoded.
 * When absent, `utf8` is assumed, unless the body was compressed (`content-encoding`).
 */
export type BodyEncoding = 'utf8' | 'base64';

export type HttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding?: BodyEncoding;
}

export type HttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding?: BodyEncoding;
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
   * Re-record from scratch: any existing cassette is ignored rather than loaded, every request is
   * made live, and the cassette is replaced with this run's traffic. Equivalent to deleting the
   * cassette and recording it again.
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

/**
 * A function that masks an HTTP request
 */
export type HttpRequestMasker = (httpRequest: HttpRequest) => void;

/**
 * A function that masks an HTTP response before it is recorded.
 *
 * Rewrite the body freely - `content-length` is restated from whatever the body ends up being, so
 * a masker never has to keep framing headers in step with its own edits.
 *
 * `httpRequest` is the request this response answered, so masking can be scoped to an endpoint
 * rather than applied to every body. It is passed read-only and has already been through the
 * `HttpRequestMasker`, so it is the request as it will appear in the cassette: if that masker
 * rewrites the url, branch on what survives it.
 */
export type HttpResponseMasker = (httpResponse: HttpResponse, httpRequest: Readonly<HttpRequest>) => void;

/**
 * A function that allows an HTTP request to pass through (never be recorded)
 */
export type PassThroughHandler = (httpRequest: HttpRequest) => boolean;
