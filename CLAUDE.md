# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

vcr-test is an npm library that records HTTP interactions during tests and replays them in future runs (like Ruby's VCR). It intercepts HTTP calls via `@mswjs/interceptors` (both `ClientRequest` and `fetch`), stores them as YAML cassettes, and replays matched requests.

## Commands

- **Run tests:** `npm test` (runs vitest with coverage, no watch mode)
- **Run a single test:** `npx vitest -t "test name pattern"`
- **Build:** `npm run build` (runs `tsc`, outputs to `dist/`)

## Architecture

The library has a small surface area with a clear layered design:

- **`VCR`** (`vcr.ts`) — Public entry point. Holds configuration (record mode, matcher, masker, pass-through handler) and orchestrates cassette lifecycle via `useCassette()`. Supports `VCR_MODE` env var override.
- **`Cassette`** (`cassette.ts`) — Core engine. Mounts `@mswjs/interceptors` (`BatchInterceptor` with `ClientRequestInterceptor` + `FetchInterceptor`), handles request/response interception, and implements the four record modes (`once`, `none`, `update`, `all`). Manages match tracking, gzip/base64 body handling, and cassette save logic on eject.
- **`DefaultRequestMatcher`** (`default-request-matcher.ts`) — Matches requests by URL, method, headers, and body. Configurable via `compareHeaders`, `compareBody`, and `ignoreHeaders`.
- **`FileStorage`** (`file-storage.ts`) — Persists cassettes as YAML files. Sanitizes filenames. Both storage and matcher are interface-based (`ICassetteStorage`, `IRequestMatcher`) for extensibility.
- **`types.ts`** — All shared types, interfaces, and enums (`HttpRequest`, `HttpResponse`, `HttpInteraction`, `RecordMode`, etc.).
- **`index.ts`** — Barrel exports.

The test file (`index.spec.ts`) contains all tests and uses cassettes stored in `src/__cassettes__/`.

## Key Details

- TypeScript compiled to CommonJS targeting ES2021.
- Tests use vitest.
- Cassettes are YAML files in `src/__cassettes__/`. When tests run in record mode, they make real HTTP calls and save responses there.
- Gzipped response bodies are stored as base64 in cassettes and reconstructed as `Readable` streams during playback.
