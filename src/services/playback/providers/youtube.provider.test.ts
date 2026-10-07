import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  isAcceptable,
  parseAllowedChannelIds,
  parseDurationMinutes,
  youtubeProvider,
  type MatchRule,
  type YoutubeVideo,
} from "./youtube.provider";

const CHANNEL = "UCabcdefghijklmnopqrstuv"; // 24 chars, test-only fake id
const OTHER_CHANNEL = "UCzzzzzzzzzzzzzzzzzzzzzz";

function video(overrides: Partial<YoutubeVideo> = {}): YoutubeVideo {
  return {
    id: "abcdefghijk",
    snippet: { title: "Detour (1945) filme completo", channelId: CHANNEL, liveBroadcastContent: "none" },
    contentDetails: { duration: "PT1H7M" },
    status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
    ...overrides,
  };
}

const RULE: MatchRule = { titles: ["detour"], markers: [], minMinutes: 50 };
const ALLOWED = new Set([CHANNEL]);

describe("parseAllowedChannelIds", () => {
  it("keeps only well-formed channel ids", () => {
    const ids = parseAllowedChannelIds(` ${CHANNEL}, not-a-channel ,,UCshort`);
    assert.deepEqual([...ids], [CHANNEL]);
  });

  it("is empty for an unset variable", () => {
    assert.equal(parseAllowedChannelIds(undefined).size, 0);
  });
});

describe("parseDurationMinutes", () => {
  it("parses ISO 8601 durations", () => {
    assert.equal(parseDurationMinutes("PT1H32M"), 92);
    assert.equal(parseDurationMinutes("PT45S"), 0.75);
    assert.equal(parseDurationMinutes("P1DT1M"), 1441);
  });

  it("returns null for garbage", () => {
    assert.equal(parseDurationMinutes("1h30"), null);
    assert.equal(parseDurationMinutes(undefined), null);
  });
});

describe("isAcceptable", () => {
  it("accepts a full, embeddable, public video from an allowed channel", () => {
    assert.equal(isAcceptable(video(), RULE, ALLOWED), true);
  });

  const rejections: [string, YoutubeVideo][] = [
    ["channel not in the allowlist", video({ snippet: { ...video().snippet, channelId: OTHER_CHANNEL } })],
    ["not embeddable", video({ status: { ...video().status, embeddable: false } })],
    ["private", video({ status: { ...video().status, privacyStatus: "unlisted" } })],
    ["still processing", video({ status: { ...video().status, uploadStatus: "uploaded" } })],
    ["a live broadcast", video({ snippet: { ...video().snippet, liveBroadcastContent: "live" } })],
    ["a trailer (too short)", video({ contentDetails: { duration: "PT2M30S" } })],
    ["blocked in Brazil", video({ contentDetails: { duration: "PT1H7M", regionRestriction: { blocked: ["BR"] } } })],
    ["only allowed elsewhere", video({ contentDetails: { duration: "PT1H7M", regionRestriction: { allowed: ["US"] } } })],
    ["about another title", video({ snippet: { ...video().snippet, title: "Outro filme qualquer" } })],
    ["a malformed id", video({ id: "bad id" })],
  ];
  for (const [reason, candidate] of rejections) {
    it(`rejects a video that is ${reason}`, () => {
      assert.equal(isAcceptable(candidate, RULE, ALLOWED), false);
    });
  }

  it("matches whole words only", () => {
    const rule: MatchRule = { titles: ["up"], markers: [], minMinutes: 1 };
    assert.equal(isAcceptable(video({ snippet: { ...video().snippet, title: "Group therapy" } }), rule, ALLOWED), false);
  });

  it("requires an episode marker for episodes", () => {
    const rule: MatchRule = { titles: ["detour"], markers: ["s01e02"], minMinutes: 10 };
    assert.equal(isAcceptable(video(), rule, ALLOWED), false);
    const episode = video({ snippet: { ...video().snippet, title: "Detour S01E02" } });
    assert.equal(isAcceptable(episode, rule, ALLOWED), true);
  });
});

describe("youtubeProvider", () => {
  const context = { tmdbId: 20367, title: "Detour", year: 1945, runtimeMinutes: 67 };
  let fetchMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch", async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) {
        return Response.json({ items: [{ id: { videoId: "abcdefghijk" } }] });
      }
      return Response.json({ items: [video()] });
    });
  });

  afterEach(() => {
    fetchMock.mock.restore();
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_ALLOWED_CHANNEL_IDS;
  });

  it("is off without an API key (no request made)", async () => {
    process.env.YOUTUBE_ALLOWED_CHANNEL_IDS = CHANNEL;
    assert.equal(await youtubeProvider.getMovieSource(context), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("is off with an empty allowlist (no request made)", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    assert.equal(await youtubeProvider.getMovieSource(context), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("returns the official embed URL for an accepted video", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_ALLOWED_CHANNEL_IDS = CHANNEL;
    const source = await youtubeProvider.getMovieSource(context);
    assert.equal(source?.url, "https://www.youtube.com/embed/abcdefghijk");
    assert.equal(source?.type, "iframe");
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it("returns null when the only candidate is rejected", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_ALLOWED_CHANNEL_IDS = OTHER_CHANNEL;
    assert.equal(await youtubeProvider.getMovieSource(context), null);
  });

  it("swallows API errors and returns null", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_ALLOWED_CHANNEL_IDS = CHANNEL;
    fetchMock.mock.mockImplementation(async () =>
      Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 }),
    );
    const warn = mock.method(console, "warn", () => {});
    assert.equal(await youtubeProvider.getMovieSource(context), null);
    warn.mock.restore();
  });
});
