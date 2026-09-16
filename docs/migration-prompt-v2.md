# Migration prompt: vcr-test 1.x → 2.x

> Give this file to a coding agent working in a repository that depends on `vcr-test`.
> It is written as instructions to that agent, not as prose documentation for a human.

You are migrating a codebase from `vcr-test` 1.x to 2.x. Work through the tasks in order. Each
task states what changed, how to find affected code, what to do, and how to confirm it worked.

2.x exists because `vcr-test` upgraded `@mswjs/interceptors` from 0.23 to 0.42. In 0.23 a replayed
response was handed straight back to the caller. In 0.42 it is serialised over a socket that
Node's real HTTP stack parses. Headers that used to be decorative are now obeyed, and requests now
carry the headers that actually go on the wire. Most of what follows falls out of that one change.

## Before you start

Establish these facts and write them down. Several decisions below depend on them.

1. **Can the project re-record cassettes?** Look for a README, a comment at the top of the test
   files, or a `VCR_MODE` reference. Recording makes real network calls and often needs
   credentials (API keys, bearer tokens, account ids).
   **If recording needs secrets you do not have, you cannot re-record. Stop and ask the human.**
   Do not invent credentials and do not skip a task by deleting the test.
2. **Is response masking configured?** Search for a class extending `FileStorage`, or any
   `save(`/`load(` override. Masking that lives there is a 1.x workaround; Task 5 moves it.
3. **How many cassettes are there, and are they committed?** `git ls-files '*.yaml' | grep -i cassette`

Run the test suite once and save the output before changing anything. You need the baseline to
tell a pre-existing failure from one you caused.

## Task 1 — Node version and dependency

**2.x requires Node 22 or newer.** `@mswjs/interceptors` moved its floor from `>=18` to `>=22`
between the two versions, and `vcr-test` 2.x declares `engines: { "node": ">=22" }` to match.

Check what the project runs on — `.nvmrc`, `engines` in its own `package.json`, the `node-version`
in CI workflows, and any Docker base image. **If it is on Node 18 or 20, stop and tell the human:
this upgrade requires bumping Node first, which is a bigger decision than a library upgrade.** Do
not proceed on the assumption that it will probably work.

`@mswjs/interceptors` is a **runtime dependency** of `vcr-test`, not a peer dependency. Consumers
do not need to declare it.

- If the consuming project pins `@mswjs/interceptors` in its own `package.json` **only** because
  `vcr-test` needed it, remove that pin — a stale pin to 0.23 will break 2.x.
- If the project uses `@mswjs/interceptors` directly for its own reasons, leave it, but make sure
  the resolved version is 0.42.x so both sides share one instance.
- Verify: `npm ls @mswjs/interceptors` shows a single 0.42.x entry, and `node -v` reports 22 or
  newer.

## Task 2 — One recording now serves exactly one replay

**This is the most likely thing to break the suite. Check it first.**

In 1.x a single recorded interaction could be replayed an unlimited number of times. In 2.x each
recorded interaction is consumed by one replay; a second identical call finds no match.

Measured against the published packages, replaying in `RecordMode.none` with no network available
to fall back on:

| cassette contents | calls made | 1.4.2 | 2.x |
| --- | --- | --- | --- |
| 1 interaction | 5 | 5 succeed | 1 succeeds, 4 reject |
| 2 interactions | 3 | 3 succeed | 2 succeed, 1 rejects |

So in 2.x, **N recorded interactions serve exactly N replays**. In 1.x the count was unbounded: a
replayed interaction was re-added to the pool, so one recording answered every identical call.

**Detect:** failures where the *first* assertion in a test passes and a later identical call fails.
The rejected request carries the reason on its `cause` chain, not in its message — the message is
just `fetch failed`:

```
fetch failed  <-  Match no found for GET http://localhost:3000/a
```

Print `error.cause` when diagnosing; `error.message` alone will not tell you it was a cassette
miss. Also look for tests that loop, retry, or call the same endpoint more than once inside one
`useCassette`.

**Fix:** the cassette must contain one recorded interaction per call the test makes.

- If you can re-record, re-record that cassette and confirm the interaction count matches the
  number of calls the test makes.
- If you cannot re-record, duplicate the existing interaction inside the cassette YAML as many
  times as the test calls it. This is legitimate — it is what recording would have produced.
- Do **not** work around this by making the matcher looser.

**Verify:** the test passes, and the number of `- request:` entries in the cassette equals the
number of HTTP calls the test makes.

## Task 3 — Cassettes recorded by 1.x may no longer match

2.x records the request headers that are actually sent. `DefaultRequestMatcher` compares header
sets in both directions, so a cassette missing those headers will not match a live request.

Measured for a native `fetch` GET, same request, both versions:

| | recorded request headers |
| --- | --- |
| 1.4.2 | *(none)* |
| 2.x | `accept`, `accept-encoding`, `accept-language`, `host`, `sec-fetch-mode`, `user-agent` |

- **Cassettes of `fetch` traffic recorded by 1.x will not match.** This is the common case.
- **Cassettes of `http.ClientRequest` / axios-default traffic generally still match.** 1.x already
  recorded those headers, and the one addition (`connection`) is stripped by 2.x as a hop-by-hop
  header. Verified against real 1.x cassettes.

**Detect:** a rejected request whose cause is `Match no found for <METHOD> <URL>` on the *first*
call of a test (as opposed to Task 2, which bites on a later call).

**Fix, in order of preference:**

1. **Re-record the cassette.** Correct and durable. Requires Task 0 to have said yes.
2. **Ignore the transport headers** when re-recording is impossible:

   ```ts
   const matcher = new DefaultRequestMatcher();
   matcher.ignoreHeaders.add('accept');
   matcher.ignoreHeaders.add('accept-encoding');
   matcher.ignoreHeaders.add('accept-language');
   matcher.ignoreHeaders.add('host');
   matcher.ignoreHeaders.add('sec-fetch-mode');
   matcher.ignoreHeaders.add('user-agent');
   matcher.ignoreHeaders.add('content-length');
   vcr.matcher = matcher;
   ```

   Add only the headers you need. Never reach for `matcher.compareHeaders = false` to make this go
   away — that disables header matching entirely and will hide genuine mismatches, including
   requests going to the wrong endpoint with the right URL.

You no longer need `ignoreHeaders.add('connection')` or any other hop-by-hop header
(`keep-alive`, `transfer-encoding`, `proxy-connection`, `te`, `trailer`, `upgrade`,
`proxy-authenticate`, `proxy-authorization`). 2.x strips those from both sides before matching.
Existing entries are harmless; remove them for tidiness only.

## Task 4 — Remove workarounds that 2.x makes unnecessary

Search the project for these and delete them.

**204 / 205 / 304 handling.** In 1.x, replaying a recorded 204 threw
`Response constructor: Invalid response status code 204`, so projects patched it in a storage
subclass, usually by blanking the body on load. 2.x replays these statuses correctly. Verified:
1.x throws, 2.x returns 204. Remove the workaround.

```ts
// DELETE — 2.x handles null-body statuses itself
const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);
```

**Hand-maintained `content-length`.** Any code recomputing `content-length` after editing a body
can go. 2.x restates it at record time, after masking, and again on replay.

**Body-rewriting inside `FileStorage`.** See Task 5.

Leave alone anything in a storage subclass that is genuinely about persistence — pretty-printing,
alternate file layouts, a different serialisation format.

## Task 5 — Move response masking to `vcr.responseMasker`

1.x had no hook for masking response bodies, so projects overrode `FileStorage.save`. 2.x adds
`vcr.responseMasker`, which runs at record time before the interaction is stored.

**Detect:** a `FileStorage` subclass whose `save` mutates `interaction.response.body`.

**Before:**

```ts
class MaskingStorage extends FileStorage {
  override save(name: string, interactions: HttpInteraction[]): Promise<void> {
    for (const int of interactions) {
      const body = JSON.parse(int.response.body);
      body.accessToken = 'masked';
      int.response.body = JSON.stringify(body);
    }
    return super.save(name, interactions);
  }
}
```

**After:**

```ts
vcr.responseMasker = (res) => {
  const body = JSON.parse(res.body);
  body.accessToken = 'masked';
  res.body = JSON.stringify(body);
};
```

Rewrite the body freely. `content-length` is restated from whatever the body ends up being, so a
masker never has to keep framing headers in step with its own edits. Guard against non-JSON bodies
the same way the original code did — a masker that throws will fail the recording.

The masker's second parameter is the request the response answered, so masking that only applied
to certain endpoints in the old `save` loop stays scoped:

```ts
vcr.responseMasker = (res, req) => {
  if (new URL(req.url).pathname.startsWith('/accounts/')) {
    maskAccountPii(res);
  }
};
```

That request is read-only and has already been through `requestMasker`, so it is the request as
the cassette will carry it. If your request masker rewrites the url, branch on what survives it —
a check against a real account id or token will never match.

If the subclass did masking **and** something persistence-related, split it: masking moves to
`responseMasker`, the rest stays in the subclass.

## Task 6 — Response headers seen by tests have changed

A replayed response is no longer byte-identical in its headers to the recording.

| header | 2.x behaviour on replay | why |
| --- | --- | --- |
| `connection` | always `close` | the mock socket dies with the cassette; letting a client pool it hangs the next request to that origin |
| hop-by-hop headers | removed | connection-scoped, not part of the message |
| `content-length` | restated from the replayed body | a stale value hangs the parser (too large) or truncates the body (too small) |
| `content-encoding` | dropped when the body is provably not in that encoding | otherwise the client tries to inflate plaintext and fails with `incorrect header check` |

`content-encoding` is only second-guessed for encodings with a recognisable signature (`gzip`,
`x-gzip`, `zstd`). `br`, raw `deflate`, and multi-coding values are left untouched.

**Detect:** `rg "headers\.get\(['\"](connection|content-length|content-encoding|keep-alive)" --glob '*.spec.*' --glob '*.test.*'`

**Fix:** assertions on those specific headers are asserting on transport framing, not on
application behaviour. Delete them, or re-target them at something meaningful. Do not try to
restore the recorded values.

## Task 7 — Act on the new warnings

2.x prints a warning when it repairs a cassette at replay time:

```
vcr-test: cassette "guest_account_loyalty_history" declares "content-length: 646"
  but its body is 645 bytes. Re-record it to silence this.
```

These are not noise. Each one means a committed cassette's headers no longer describe its own
body — usually because a 1.x-era masker rewrote the body without updating the header. The replay
still succeeds; the warning is telling you the cassette is stale.

**Fix:** re-record the named cassette. Cassettes recorded by 2.x are self-consistent and will not
warn. If you cannot re-record, leave it — the repair is safe, and the warning is accurate.

Collect every distinct warning from a full test run and report them to the human, grouped by
cassette. Do not suppress them.

## Verification

Run all of these before reporting the migration complete.

1. `node -v` → 22 or newer; `npm ls @mswjs/interceptors` → one entry, 0.42.x.
2. Full test suite passes.
3. **Run the suite twice in a row** without re-recording. A suite that passes once and fails or
   hangs the second time means cassettes are being mutated between runs.
4. **Compare interaction counts before and after.** For every cassette, the number of
   `- request:` entries should be unchanged from `git HEAD` unless you deliberately re-recorded
   or duplicated an entry in Task 2. An unexplained increase means something is recording when it
   should be replaying.

   ```sh
   for f in $(git ls-files '*.yaml' | grep -i cassette); do
     printf '%-60s HEAD=%s now=%s\n' "$f" \
       "$(git show "HEAD:$f" | grep -c '^- request:')" "$(grep -c '^- request:' "$f")"
   done
   ```
5. No test was deleted, skipped, or had assertions weakened to make it pass. If you could not fix
   one, leave it failing and say so.
6. Report every replay warning from Task 7.

## Do not

- **Do not delete or bulk-regenerate cassettes** to make failures go away. Re-record a specific
  cassette only when a task calls for it and the human has confirmed recording is possible.
- **Do not set `compareHeaders = false` or `compareBody = false`** as a migration fix. Both hide
  real mismatches.
- **Do not hand-edit `content-length`, `content-encoding`, or `connection`** in a cassette. 2.x
  derives all three. Editing them is at best a no-op and at worst masks a genuine problem.
- **Do not commit a re-recorded cassette without checking what is in it.** Recording captures real
  traffic. Confirm masking is configured and actually applied — read the diff for tokens, cookies,
  names, emails, account numbers — before staging. If you find credentials in a cassette you were
  about to commit, stop and tell the human.
- **Do not weaken an assertion** to make a test pass. If a test now fails for a reason no task
  here explains, report it rather than accommodating it.

## Known limitations in 2.x

Report these if you hit them; do not attempt to work around them silently.

- **A connection pooled before the interceptor is applied can bypass interception.** If a `fetch`
  to some origin happens before the first `useCassette`, the next request to that origin may
  escape the interceptor and hit the real network — even in `RecordMode.none`. This originates in
  `@mswjs/interceptors`, not `vcr-test`. If you see an unexpected real network call, check whether
  something warms that origin during test setup.

## Change reference

| change | breaking | task |
| --- | --- | --- |
| One recording serves one replay (was: unlimited) | yes | 2 |
| Request records full wire headers; 1.x `fetch` cassettes stop matching | yes | 3 |
| Hop-by-hop headers stripped from cassettes and from matching | no | 3 |
| `connection: close` forced on replayed responses | if asserted | 6 |
| `content-length` restated on record and replay | if asserted | 6 |
| Contradicted `content-encoding` dropped on replay | if asserted | 6 |
| 204 / 205 / 304 replay correctly (1.x threw) | no — a fix | 4 |
| `vcr.responseMasker` added, receiving `(response, request)` | no — additive | 5 |
| Warnings printed when a stale cassette is repaired | no | 7 |
| Unmatched request rejects with `MatchNotFoundError` as cause | no — unchanged from 1.x | — |
| `RecordMode.update` cassette contents | no — unchanged from 1.x | — |
| `RecordMode.all` re-records from scratch (1.x appended to the cassette every run) | no — a fix | — |
