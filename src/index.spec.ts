import axios from 'axios';
import { join } from 'node:path';
import { VCR } from './index';
import { FileStorage } from "./file-storage";

describe('cassette', () => {
  it('records multiple HTTP calls', async () => {
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));
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

  it('records the same HTTP call multiple times', async () => {
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));
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
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));
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