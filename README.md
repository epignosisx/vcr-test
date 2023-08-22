# vcr-test

Record your test suite's HTTP interactions and replay them during future test runs for fast, deterministic, accurate tests.

## Installation

```bash
npm install vcr-test --save-dev
```

## Usage
The first time the test runs, it should make live HTTP calls. vcr-test will take care of recording the HTTP traffic and storing it. Future test runs replay the recorded traffic.

```js
import { join } from 'node:path';
import { VCR, FileStorage } from 'vcr-test';
import { api } from './my-api'


describe('some suite', () => {
  it('some test', async () => {
    // Configure VCR
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));

    await vcr.useCassette('cassette_name', async () => {
      const result = await api.myAwesomeApiCall();
      expect(result).toBeDefined();
    });
  })
})
```

## Extensibility

### Storage
