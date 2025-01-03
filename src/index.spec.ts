import axios from 'axios';
import { join } from 'node:path';
import { RecordMode, VCR } from './index';
import { FileStorage } from "./file-storage";
import { unlink } from 'node:fs/promises';

describe('cassette', () => {
  const CASSETTES_DIR = join(__dirname, '__cassettes__');
  it('records multiple HTTP calls', async () => {
    var vcr = new VCR(new FileStorage(CASSETTES_DIR));
    vcr.requestMasker = (req) => {
      req.headers['user-agent'] = '****';
    };
    await vcr.useCassette('multiple_http_calls', async () => {
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

  it('does not record when request is marked as pass-through', async () => {
    var vcr = new VCR(new FileStorage(CASSETTES_DIR));
    vcr.requestPassThrough = (req) => {
      return req.url === 'https://httpbin.org/put';
    };
    await vcr.useCassette('pass_through_calls', async () => {
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
    await unlink(join(CASSETTES_DIR, 'new_calls.yaml'));
    var vcr = new VCR(new FileStorage(CASSETTES_DIR));
    vcr.mode = RecordMode.once;
    await vcr.useCassette('new_calls', async () => {
      const { data: body } = await axios.post('https://httpbin.org/post', JSON.stringify({name: 'alex'}), {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });

      expect(body.data).toMatchInlineSnapshot(`"{"name":"alex"}"`);
    });

    vcr.mode = RecordMode.update;
    await vcr.useCassette('new_calls', async () => {
      const { data: body} = await axios.post('https://httpbin.org/post', JSON.stringify({name: 'alex-update'}), {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });
      
      expect(body.data).toMatchInlineSnapshot(`"{"name":"alex-update"}"`);
    });
  }, 5000000);

  it('records the same HTTP call multiple times', async () => {
    var vcr = new VCR(new FileStorage(CASSETTES_DIR));
    vcr.requestMasker = (req) => {
      req.headers['user-agent'] = '****';
    };
    await vcr.useCassette('same_http_call_multiple_times', async () => {
      await axios.post('https://httpbin.org/post', JSON.stringify({ name: 'alex' }), {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });

      await axios.post('https://httpbin.org/post', JSON.stringify({ name: 'alex' }), {
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
    await vcr.useCassette('gzipped_data_stored_as_base64', async () => {
      await axios.get('https://httpbin.org/gzip', {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });
    });
  });
})