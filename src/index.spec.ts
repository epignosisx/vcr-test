import axios from 'axios';
import { join } from 'node:path';
import { RecordMode, VCR } from './index';
import { FileStorage } from "./file-storage";
import { unlink } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';

const CASSETTES_DIR = join(__dirname, '__cassettes__');

describe('cassette', () => {
  describe('ClientRequest', () => {
    it('records multiple HTTP calls', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('client_request_multiple_http_calls', async () => {
        await axios.post('https://httpbin.org/post', JSON.stringify({name: 'alex'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
  
        await axios.post('https://httpbin.org/post', JSON.stringify({name: 'yane'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
      });
    }, 5000000);

    it('records gzipped data as base64', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('client_request_gzipped_data_stored_as_base64', async () => {
        await axios.get('https://httpbin.org/gzip', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
      });
    }, 5000000);

    it('does not record when request is marked as pass-through', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestPassThrough = (req) => {
        return req.url === 'https://httpbin.org/put';
      };
      await vcr.useCassette('client_request_pass_through_calls', async () => {
        await axios.put('https://httpbin.org/put', JSON.stringify({name: 'alex'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });

        await axios.post('https://httpbin.org/post', JSON.stringify({name: 'john'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
      });
    }, 5000000);

    it('records new calls', async () => {
      const cassette = join(CASSETTES_DIR, 'client_request_new_calls.yaml');
      if (existsSync(cassette)) {
        await unlink(cassette);
      }

      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.mode = RecordMode.once;
      await vcr.useCassette('client_request_new_calls', async () => {
        const { data: body } = await axios.post('https://httpbin.org/post', JSON.stringify({name: 'alex'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });

        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex"}"`);
      });

      vcr.mode = RecordMode.update;
      await vcr.useCassette('client_request_new_calls', async () => {
        const { data: body} = await axios.post('https://httpbin.org/post', JSON.stringify({name: 'alex-update'}), {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
        
        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex-update"}"`);
      });
    }, 5000000);
  });

  describe('axios fetch', () => {
    it('records the same HTTP call multiple times', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('fetch_same_http_call_multiple_times', async () => {
        await axios.post('https://httpbin.org/post', JSON.stringify({ name: 'alex' }), {
          adapter: 'fetch',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
  
        await axios.post('https://httpbin.org/post', JSON.stringify({ name: 'alex' }), {
          adapter: 'fetch',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
      });
    }, 5000000);
  
    it('records gzipped data as base64', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('fetch_gzipped_data_stored_as_base64', async () => {
        await axios.get('https://httpbin.org/gzip', {
          adapter: 'fetch',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });
      });
    }, 5000000);

    it('does not record when request is marked as pass-through', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestPassThrough = (req) => {
        return req.url === 'https://httpbin.org/put';
      };
      await vcr.useCassette('fetch_pass_through_calls', async () => {
        await fetch('https://httpbin.org/put', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'PUT',
          body: JSON.stringify({name: 'alex'})
        });

        await axios.post('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex'})
        });
      });
    }, 5000000);

    it('records new calls', async () => {
      const cassette = join(CASSETTES_DIR, 'fetch_new_calls.yaml');
      if (existsSync(cassette)) {
        await unlink(cassette);
      }

      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.mode = RecordMode.once;
      await vcr.useCassette('fetch_new_calls', async () => {
        const body: any = await fetch('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex'})
        }).then(res => res.json());

        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex"}"`);
      });

      vcr.mode = RecordMode.update;
      await vcr.useCassette('fetch_new_calls', async () => {
        const body: any = await fetch('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex-update'})
        }).then(res => res.json());

        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex-update"}"`);
      });
    }, 5000000);
  });

  describe('native fetch', () => {
    it('records the same HTTP call multiple times', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('native_fetch_same_http_call_multiple_times', async () => {
        const res1 = await fetch('https://httpbin.org/post', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ name: 'alex' })
        });

        const data1 = await res1.json();
        expect(data1).toBeDefined();
  
        const res2 = await fetch('https://httpbin.org/post', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ name: 'alex' })
        });

        const data2 = await res2.json();
        expect(data2).toBeDefined();
      });
    }, 5000000);
  
    it('records gzipped data as base64', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestMasker = (req) => {
        req.headers['user-agent'] = '****';
      };
      await vcr.useCassette('native_fetch_gzipped_data_stored_as_base64', async () => {
        const res =  await fetch('https://httpbin.org/gzip', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        });

        const data = await res.json();
        expect(data).toBeDefined();
      });
    }, 5000000);

    it('does not record when request is marked as pass-through', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.requestPassThrough = (req) => {
        return req.url === 'https://httpbin.org/put';
      };
      await vcr.useCassette('native_fetch_pass_through_calls', async () => {
        await fetch('https://httpbin.org/put', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'PUT',
          body: JSON.stringify({name: 'alex'})
        });

        await fetch('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex'})
        });
      });
    }, 5000000);

    it('records new calls', async () => {
      const cassette = join(CASSETTES_DIR, 'fetch_new_calls.yaml');
      if (existsSync(cassette)) {
        await unlink(cassette);
      }

      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.mode = RecordMode.once;
      await vcr.useCassette('native_fetch_new_calls', async () => {
        const body: any = await fetch('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex'})
        }).then(res => res.json());

        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex"}"`);
      });

      vcr.mode = RecordMode.update;
      await vcr.useCassette('fetch_new_calls', async () => {
        const body: any = await fetch('https://httpbin.org/post', {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({name: 'alex-update'})
        }).then(res => res.json());

        expect(body.data).toMatchInlineSnapshot(`"{"name":"alex-update"}"`);
      });
    }, 5000000);
  });

  describe('disposable', () => {
    it('supports await using pattern', async () => {
      const vcr = new VCR(new FileStorage(CASSETTES_DIR));
      await using _cassette = await vcr.useCassette('disposable_test');

      const res = await fetch('https://httpbin.org/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ name: 'disposable' }),
      });
      const data: any = await res.json();
      expect(data.data).toMatchInlineSnapshot(`"{"name":"disposable"}"`);
    }, 5000000);
  });

  describe('binary bodies', () => {
    // Raw bytes at rest (e.g. a tarball on S3) arrive with a binary content-type but no
    // content-encoding, so they must be base64 encoded to survive the cassette round-trip.
    const TARBALL = gzipSync(Buffer.from('the quick brown fox jumps over the lazy dog'));
    let server: Server;
    let origin: string;

    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': String(TARBALL.length),
        });
        res.end(TARBALL);
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      origin = `http://localhost:${(server.address() as any).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('replays raw bytes byte-for-byte', async () => {
      const cassette = join(CASSETTES_DIR, 'raw_bytes.yaml');
      if (existsSync(cassette)) {
        await unlink(cassette);
      }

      const vcr = new VCR(new FileStorage(CASSETTES_DIR));
      vcr.mode = RecordMode.once;
      await vcr.useCassette('raw_bytes', async () => {
        const res = await fetch(`${origin}/archive.tar.gz`);
        const recorded = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        expect(recorded.equals(TARBALL)).toBe(true);
      });

      vcr.mode = RecordMode.none;
      await vcr.useCassette('raw_bytes', async () => {
        const res = await fetch(`${origin}/archive.tar.gz`);
        const replayed = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        expect(replayed.equals(TARBALL)).toBe(true);
        expect(gunzipSync(replayed).toString()).toBe('the quick brown fox jumps over the lazy dog');
      });
    }, 5000000);
  });
});