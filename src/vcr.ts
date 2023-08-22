import { setTimeout } from 'node:timers/promises';
import { ICassetteStorage, IRequestMatcher, RecordMode } from './types';
import { DefaultRequestMatcher } from './default-request-matcher';
import { Cassette } from './cassette';

export class VCR {

  public matcher: IRequestMatcher = new DefaultRequestMatcher();

  constructor (private readonly storage: ICassetteStorage) {}

  public async useCassette(name: string, action: () => Promise<void>) {
    var cassette = new Cassette(this.storage, this.matcher, name, RecordMode.once);
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
