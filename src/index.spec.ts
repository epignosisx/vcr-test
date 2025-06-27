import axios from 'axios';
import { join } from 'node:path';
import { RecordMode, VCR } from './index';
import { FileStorage } from "./file-storage";
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

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

  describe('fetch', () => {
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

    it('can record gzip from S3 as base64', async () => {
      var vcr = new VCR(new FileStorage(CASSETTES_DIR));
      await vcr.useCassette('fetch_gzipped_data_stored_as_base64_from_s3', async () => {
        const res = await fetch('https://crates.io/api/v1/crates/serde/1.0.219/download', {
          headers: {
            'User-Agent': 'UnitTests; raynos2@gmail.com',
          }
        })
        const body = await res.arrayBuffer()
        console.log(body)

        const utf8Text = new TextDecoder().decode(body)
        console.log(utf8Text.slice(0, 100))

        const base64 = Buffer.from(body).toString('base64')
        console.log(base64.slice(0, 100))

        expect(base64.slice(0, 10)).toEqual('H4sICAAAAA')
        expect(base64.slice(-10)).toEqual('+W2QBgCAA=')
      })
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
});