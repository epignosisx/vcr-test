import axios from 'axios';
import { join } from 'node:path';
import { VCR } from './index';
import { FileStorage } from "./file-storage";
import * as fs from "node:fs";

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

  it('does not record blacklisted host', async () => {
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));
    vcr.requestMasker = (req) => {
      req.headers['user-agent'] = '****';
    };
    await vcr.useCassette('blacklistedHost', async () => {
      await axios.get('https://httpbin.dev/get');

      await axios.get('https://httpbin.org/gzip', {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });
    }, ['httpbin.org']);

    const recordFile = join(__dirname, '__cassettes__', 'blacklistedHost.yaml');
    const fileExists = fs.existsSync(recordFile);
    //expect that file has not the content of the blacklisted host
    const fileContent = fs.readFileSync(recordFile, 'utf-8');
    expect(fileContent).not.toContain('httpbin.org');
    expect(fileExists).toBe(true);
    fs.rmSync(recordFile);
  });
})
