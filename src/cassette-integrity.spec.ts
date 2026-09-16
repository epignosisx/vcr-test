import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { parse } from 'yaml';
import { RecordMode, VCR } from './index';
import { FileStorage } from './file-storage';
import { HttpInteraction } from './types';

/**
 * These cover the invariants the cassette files themselves have to satisfy. The interceptor
 * keeps per-request response parsers attached to a keep-alive socket for longer than the
 * cassette that created them, so responses can surface against the wrong request or the wrong
 * cassette entirely. That corruption is invisible to a test that only asserts on what the
 * HTTP client received, which is why these assert on the recorded YAML.
 */
describe('cassette integrity', () => {
  let server: Server;
  let origin: string;
  let dir: string;
  let hits: string[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === '/slow') {
        setTimeout(() => {
          const payload = JSON.stringify({ slow: true });
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) });
          res.end(payload);
        }, 300);
        return;
      }
      if (req.url === '/no-content') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === '/gz') {
        const payload = gzipSync(Buffer.from(JSON.stringify({ compressed: true })));
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': String(payload.length),
        });
        res.end(payload);
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        // Echo the request back so a mispaired request/response is detectable.
        const payload = JSON.stringify({ path: req.url, echo: Buffer.concat(chunks).toString('utf8') });
        // Send a real content-length rather than falling back to chunked, so the recorded
        // cassettes carry the framing header the fixes are about.
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        });
        res.end(payload);
      });
    });
    // Keep-alive is what lets a stale parser see a later response, so leave it on.
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://localhost:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    hits = [];
    dir = mkdtempSync(join(tmpdir(), 'vcr-integrity-'));
  });

  const read = (name: string): HttpInteraction[] =>
    parse(readFileSync(join(dir, `${name}.yaml`), 'utf8'));

  const post = (path: string, body: unknown) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json() as any);

  it('pairs each recorded request with its own response', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('pairing', async () => {
      await post('/a', { name: 'alex' });
      await post('/b', { name: 'yane' });
      await post('/c', { name: 'zoe' });
    });

    const recorded = read('pairing');
    expect(recorded).toHaveLength(3);
    for (const interaction of recorded) {
      const echoed = JSON.parse(interaction.response.body);
      expect(echoed.echo).toBe(interaction.request.body);
      expect(interaction.request.url).toBe(`${origin}${echoed.path}`);
    }
  });

  it('does not record traffic belonging to another cassette', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('first', async () => {
      await post('/first', { n: 1 });
    });
    await vcr.useCassette('second', async () => {
      await post('/second', { n: 2 });
    });

    expect(read('first').map((i) => i.request.url)).toEqual([`${origin}/first`]);
    expect(read('second').map((i) => i.request.url)).toEqual([`${origin}/second`]);
  });

  it('keeps a pass-through request out of this and later cassettes', async () => {
    const vcr = new VCR(new FileStorage(dir));
    vcr.requestPassThrough = (req) => req.url.endsWith('/secret');

    await vcr.useCassette('excluded', async () => {
      await post('/secret', { token: 'do-not-record' });
      await post('/ordinary', { n: 1 });
    });

    const plain = new VCR(new FileStorage(dir));
    await plain.useCassette('later', async () => {
      await post('/later', { n: 2 });
    });

    const everything = JSON.stringify([...read('excluded'), ...read('later')]);
    expect(everything).not.toContain('do-not-record');
    expect(read('excluded').map((i) => i.request.url)).toEqual([`${origin}/ordinary`]);
    expect(read('later').map((i) => i.request.url)).toEqual([`${origin}/later`]);
  });

  it('replays a recorded interaction only as many times as it was recorded', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('replay_count', async () => {
      await post('/once', { n: 1 });
    });
    expect(hits).toHaveLength(1);

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('replay_count', async () => {
      await post('/once', { n: 1 });
      await expect(post('/once', { n: 1 })).rejects.toThrow();
    });
    // The second call must not have reached the network either.
    expect(hits).toHaveLength(1);
  });

  it('fails loudly instead of returning a fabricated 500 when nothing matches', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('no_match', async () => {
      await post('/recorded', { n: 1 });
    });

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('no_match', async () => {
      await expect(fetch(`${origin}/never-recorded`)).rejects.toThrow();
    });
    expect(hits).toEqual(['POST /recorded']);
  });

  it('keeps interactions it replayed when saving in update mode', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('update_mode', async () => {
      await post('/kept', { n: 1 });
    });

    // `update` replays what matches and records what does not; the replayed interaction has to
    // survive the save, otherwise every run silently erodes the cassette.
    const update = new VCR(new FileStorage(dir));
    update.mode = RecordMode.update;
    await update.useCassette('update_mode', async () => {
      await post('/kept', { n: 1 });
      await post('/added', { n: 2 });
    });

    expect(read('update_mode').map((i) => i.request.url).sort()).toEqual([
      `${origin}/added`,
      `${origin}/kept`,
    ]);
    // /kept was replayed, not refetched.
    expect(hits).toEqual(['POST /kept', 'POST /added']);
  });

  it.each([
    ['too large', 1],
    ['too small', -1],
  ])('replays the whole body when the recorded content-length is %s', async (_label, skew) => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('content_length', async () => {
      await post('/cl', { n: 1 });
    });

    // A response masker that rewrites the body, or any hand-edit of the YAML, leaves the
    // recorded content-length describing a body that is no longer there.
    const recorded = read('content_length');
    const truth = Buffer.byteLength(recorded[0]!.response.body, 'utf8');
    recorded[0]!.response.headers['content-length'] = String(truth + skew);
    const { stringify } = await import('yaml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'content_length.yaml'), stringify(recorded));

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('content_length', async () => {
      const body = await post('/cl', { n: 1 });
      // Too large used to hang forever; too small used to truncate silently.
      expect(body.path).toBe('/cl');
      expect(body.echo).toBe(JSON.stringify({ n: 1 }));
    });
  }, 15000);

  it('replays a genuinely gzipped body', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('gzip_real', async () => {
      const body = await fetch(`${origin}/gz`).then((r) => r.json() as any);
      expect(body.compressed).toBe(true);
    });

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('gzip_real', async () => {
      const body = await fetch(`${origin}/gz`).then((r) => r.json() as any);
      expect(body.compressed).toBe(true);
    });
    expect(hits).toEqual(['GET /gz']);
  });

  it('replays a body the recording mislabelled as gzipped', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('gzip_mislabelled', async () => {
      await post('/plain', { n: 1 });
    });

    // What an older interceptor produced: the client had already decoded the body, but the
    // wire response's content-encoding was recorded alongside it.
    const recorded = read('gzip_mislabelled');
    const plaintext = recorded[0]!.response.body;
    recorded[0]!.response.headers['content-encoding'] = 'gzip';
    recorded[0]!.response.body = Buffer.from(plaintext, 'utf8').toString('base64');
    recorded[0]!.response.bodyEncoding = 'base64';
    const { stringify } = await import('yaml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'gzip_mislabelled.yaml'), stringify(recorded));

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('gzip_mislabelled', async () => {
      // Without the fix the client tries to inflate plaintext: "incorrect header check".
      const body = await post('/plain', { n: 1 });
      expect(body.echo).toBe(JSON.stringify({ n: 1 }));
    });
  });

  it('lets a response masker rewrite the body without minding content-length', async () => {
    const vcr = new VCR(new FileStorage(dir));
    // Deliberately a different length from what the server sends, in both directions.
    vcr.responseMasker = (res) => {
      res.body = JSON.stringify({ masked: 'x'.repeat(200) });
    };

    await vcr.useCassette('masked', async () => {
      await post('/mask', { secret: 'value' });
    });

    const recorded = read('masked');
    expect(recorded[0]!.response.body).not.toContain('secret');
    // The cassette is self-consistent on disk, so replay needs no repair.
    expect(recorded[0]!.response.headers['content-length']).toBe(
      String(Buffer.byteLength(recorded[0]!.response.body, 'utf8')),
    );

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('masked', async () => {
      const body = await post('/mask', { secret: 'value' });
      expect(body.masked).toHaveLength(200);
    });
  });

  it('gives the response masker the request, so masking can be scoped to an endpoint', async () => {
    const vcr = new VCR(new FileStorage(dir));
    vcr.requestMasker = (req) => {
      req.headers['authorization'] = 'MASKED';
    };
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    vcr.responseMasker = (res, req) => {
      seen.push({ url: req.url, auth: req.headers['authorization'] });
      // Scoped: only the sensitive endpoint's body is rewritten.
      if (new URL(req.url).pathname === '/sensitive') {
        res.body = JSON.stringify({ masked: true });
      }
    };

    await vcr.useCassette('scoped', async () => {
      await fetch(`${origin}/sensitive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer real-token' },
        body: JSON.stringify({ n: 1 }),
      }).then((r) => r.json());
      await post('/ordinary', { n: 2 });
    });

    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(['/sensitive', '/ordinary']);
    // The request arrives already masked — the same object the cassette will carry.
    expect(seen.every((s) => s.auth === undefined || s.auth === 'MASKED')).toBe(true);

    const recorded = read('scoped');
    const bySensitivity = Object.fromEntries(
      recorded.map((i) => [new URL(i.request.url).pathname, i.response.body]),
    );
    expect(JSON.parse(bySensitivity['/sensitive']!).masked).toBe(true);
    expect(bySensitivity['/ordinary']).toContain('/ordinary');
  });

  it('records and replays a 204 with no body', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('no_content', async () => {
      const res = await fetch(`${origin}/no-content`);
      expect(res.status).toBe(204);
    });

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('no_content', async () => {
      // `new Response('', { status: 204 })` throws, so this used to be unreplayable.
      const res = await fetch(`${origin}/no-content`);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });
    expect(hits).toEqual(['GET /no-content']);
  });

  it('warns rather than silently repairing a stale cassette', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const vcr = new VCR(new FileStorage(dir));
      await vcr.useCassette('stale', async () => {
        await post('/stale', { n: 1 });
      });

      const recorded = read('stale');
      recorded[0]!.response.headers['content-length'] = '99999';
      const { stringify } = await import('yaml');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'stale.yaml'), stringify(recorded));

      const replay = new VCR(new FileStorage(dir));
      replay.mode = RecordMode.none;
      await replay.useCassette('stale', async () => {
        await post('/stale', { n: 1 });
      });

      const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(messages.some((message: string) => message.includes('stale') && message.includes('content-length'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('re-records from scratch in RecordMode.all, as if the cassette had been deleted', async () => {
    const work = async () => {
      await post('/one', { n: 1 });
      await post('/two', { n: 2 });
    };

    // Baseline: seed stale content, delete the file, record fresh.
    const seed = new VCR(new FileStorage(dir));
    await seed.useCassette('baseline', async () => { await post('/stale', { n: 0 }); });
    rmSync(join(dir, 'baseline.yaml'));
    await new VCR(new FileStorage(dir)).useCassette('baseline', work);

    // Candidate: same stale seed, re-recorded with `all` rather than deleted.
    const seed2 = new VCR(new FileStorage(dir));
    await seed2.useCassette('candidate', async () => { await post('/stale', { n: 0 }); });
    hits = [];
    const all = new VCR(new FileStorage(dir));
    all.mode = RecordMode.all;
    await all.useCassette('candidate', work);

    // Nothing was replayed — every call went to the network.
    expect(hits).toEqual(['POST /one', 'POST /two']);

    const strip = (list: HttpInteraction[]) =>
      list.map((i) => ({ url: i.request.url, body: i.request.body, status: i.response.status }));
    expect(strip(read('candidate'))).toEqual(strip(read('baseline')));
    expect(JSON.stringify(read('candidate'))).not.toContain('/stale');

    // Re-recording again does not append to what is already there.
    await new VCR(new FileStorage(dir)).useCassette('noop', async () => {});
    const again = new VCR(new FileStorage(dir));
    again.mode = RecordMode.all;
    await again.useCassette('candidate', work);
    expect(read('candidate')).toHaveLength(2);
  }, 15000);

  it('waits for an in-flight request before ejecting in RecordMode.all', async () => {
    const vcr = new VCR(new FileStorage(dir));
    vcr.mode = RecordMode.all;
    await vcr.useCassette('inflight', async () => {
      // Started but not awaited: the response lands well after the action returns.
      void fetch(`${origin}/slow`).then((r) => r.text()).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(read('inflight')).toHaveLength(1);
  }, 15000);

  it('matches a cassette that still carries hop-by-hop headers', async () => {
    const vcr = new VCR(new FileStorage(dir));
    await vcr.useCassette('legacy', async () => {
      await post('/legacy', { n: 1 });
    });

    // Re-introduce what a cassette recorded before hop-by-hop stripping would contain.
    const legacy = read('legacy');
    legacy[0].request.headers['connection'] = 'keep-alive';
    const { stringify } = await import('yaml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'legacy.yaml'), stringify(legacy));

    const replay = new VCR(new FileStorage(dir));
    replay.mode = RecordMode.none;
    await replay.useCassette('legacy', async () => {
      const body = await post('/legacy', { n: 1 });
      expect(body.path).toBe('/legacy');
    });
    expect(hits).toEqual(['POST /legacy']);
  });

  afterAll(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});
