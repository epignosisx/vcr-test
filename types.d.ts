declare class Response {
  constructor (body: string | Readable, opts: any) {}
  public headers: Map<string, string>;
  public clone() : Response;
  public text(): Promise<string>;
  public arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Request {
  public url: string;
  public method: string;
  public headers: Map<string, string>;
  public clone() : Request;
  public text(): Promise<string>;
  public arrayBuffer(): Promise<ArrayBuffer>;
}