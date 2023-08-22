declare class Response {
  constructor (body: string, opts: any) {}
  public clone() : Response;
  public text(): Promise<string>;
}