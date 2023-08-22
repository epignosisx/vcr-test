import axios from 'axios';
import { join } from 'node:path';
import { VCR } from './index';
import { FileStorage } from "./file-storage";

describe('foo', () => {
  it('tests foo', async () => {
    var vcr = new VCR(new FileStorage(join(__dirname, '__cassettes__')));
    vcr.requestMasker = (req) => {
      req.headers['user-agent'] = '****';
    };
    await vcr.useCassette('first_test', async () => {
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
})