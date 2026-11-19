import {
  isAdapterFailure,
  type AdapterFailure,
  type ResolvedAsset,
} from "../adapter.types";

/** Shared helpers of the server adapter tests (never imported by production code). */

export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export function fakeFetch(
  handler: (call: FakeCall) => Response | Promise<Response>,
): { impl: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: FakeCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    };

    calls.push(call);
    return handler(call);
  }) as typeof fetch;

  return { impl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

export function signal(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

/** The asset of a successful answer; throws (failing the test) on a refusal. */
export function expectAsset(result: ResolvedAsset | AdapterFailure): ResolvedAsset {
  if (isAdapterFailure(result)) {
    throw new Error(`expected an asset, got failure: ${result.reason}`);
  }

  return result;
}

/** The reason of a refusal; throws (failing the test) on a success. */
export function expectFailure(result: unknown): string {
  if (typeof result === "object" && result !== null && "reason" in result) {
    return String((result as AdapterFailure).reason);
  }

  throw new Error("expected a failure");
}

/** The search params of a recorded URL. */
export function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}
