import { setTimeout } from 'node:timers/promises';
import { HttpRequestMasker, ICassetteStorage, IRequestMatcher, RecordMode } from './types';
import { DefaultRequestMatcher } from './default-request-matcher';
import { Cassette } from './cassette';

const ENV_TO_RECORD_MODE: Record<string, RecordMode> = {
  [RecordMode.none]: RecordMode.none,
  [RecordMode.once]: RecordMode.once,
  [RecordMode.all]: RecordMode.all,
} as const;

export class VCR {

  public matcher: IRequestMatcher = new DefaultRequestMatcher();
  public requestMasker: HttpRequestMasker = () => {};

  constructor (private readonly storage: ICassetteStorage) {}

  public async useCassette(name: string, action: () => Promise<void>, hostsBlacklist: string[] = []): Promise<void> {
    const mode = ENV_TO_RECORD_MODE[process.env.VCR_MODE ?? RecordMode.once] ?? RecordMode.once
    var cassette = new Cassette(this.storage, this.matcher, name, mode, this.requestMasker, hostsBlacklist);
    await cassette.mount();
    try {
      await action();
      let waited = 0;
      while (!cassette.isDone() && waited < 10_000) {
        waited += 50;
        await setTimeout(50);
      }
    } finally {
      await cassette.eject();
    }
  }
}
