import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getYouTubeVideoId } from "@/components/playback/youtube-url";
import { parseRange } from "./http-range";
import { safeNextPath } from "./next-path";
import {
  IMAGE_KINDS,
  isValidStorageKey,
  matchesSignature,
  removeStoredFiles,
  resolveStorageKey,
  saveUpload,
  UploadError,
} from "./storage/local-storage";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

describe("parseRange", () => {
  it("handles start-end, open-ended and suffix ranges", () => {
    assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  });

  it("rejects unsatisfiable or malformed ranges", () => {
    assert.equal(parseRange("bytes=1000-", 1000), null);
    assert.equal(parseRange("bytes=-", 1000), null);
    assert.equal(parseRange("items=0-1", 1000), null);
  });
});

describe("safeNextPath", () => {
  it("accepts same-site paths only", () => {
    assert.equal(safeNextPath("/watch/x?e=1"), "/watch/x?e=1");
    assert.equal(safeNextPath("//evil.example"), null);
    assert.equal(safeNextPath("https://evil.example"), null);
    assert.equal(safeNextPath("/\\evil.example"), null);
    assert.equal(safeNextPath(undefined), null);
  });
});

describe("getYouTubeVideoId", () => {
  it("extracts the id from official embed URLs only", () => {
    assert.equal(getYouTubeVideoId("https://www.youtube.com/embed/abcdefghijk"), "abcdefghijk");
    assert.equal(getYouTubeVideoId("https://evil.example/embed/abcdefghijk"), null);
    assert.equal(getYouTubeVideoId("http://www.youtube.com/embed/abcdefghijk"), null);
    assert.equal(getYouTubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), null);
    assert.equal(getYouTubeVideoId("not a url"), null);
  });
});

describe("local storage", () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "matchflix-uploads-"));
    process.env.MEDIA_UPLOAD_DIR = root;
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.MEDIA_UPLOAD_DIR;
  });

  it("accepts only generated storage keys", () => {
    assert.equal(isValidStorageKey("images/0b7c6a52-3f9e-4c1a-9a51-2e0d8f6b1c3d.png"), true);
    for (const key of [
      "../.env",
      "images/../../.env",
      "images/abc.png",
      "secret/0b7c6a52-3f9e-4c1a-9a51-2e0d8f6b1c3d.png",
      "images/0b7c6a52-3f9e-4c1a-9a51-2e0d8f6b1c3d.html",
    ]) {
      assert.equal(isValidStorageKey(key), false, key);
      assert.equal(resolveStorageKey(key), null, key);
    }
  });

  it("checks file signatures against the declared type", () => {
    assert.equal(matchesSignature("image/png", new Uint8Array(PNG_HEADER)), true);
    assert.equal(matchesSignature("image/jpeg", new Uint8Array(PNG_HEADER)), false);
    const html = new TextEncoder().encode("<html><script>");
    assert.equal(matchesSignature("image/png", html), false);
    const mp4 = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom")]);
    assert.equal(matchesSignature("video/mp4", mp4), true);
  });

  it("stores a valid upload under a generated name and removes it again", async () => {
    const body = streamOf(new Uint8Array(PNG_HEADER), new Uint8Array(100));
    const stored = await saveUpload(body, "images", IMAGE_KINDS["image/png"], 1024);
    assert.match(stored.storageKey, /^images\/[0-9a-f-]{36}\.png$/);
    assert.equal(stored.sizeInBytes, 108);
    const absolute = resolveStorageKey(stored.storageKey)!;
    assert.ok(existsSync(absolute));
    await removeStoredFiles([stored.storageKey]);
    assert.ok(!existsSync(absolute));
  });

  it("refuses oversized uploads without leaving files behind", async () => {
    const body = streamOf(new Uint8Array(PNG_HEADER), new Uint8Array(2000));
    await assert.rejects(
      saveUpload(body, "images", IMAGE_KINDS["image/png"], 1024),
      (error: unknown) => error instanceof UploadError && error.status === 413,
    );
    assert.deepEqual(readdirSync(path.join(root, "images")), []);
  });

  it("refuses content that does not match the declared type", async () => {
    const body = streamOf(new TextEncoder().encode("<html>not an image</html>"));
    await assert.rejects(
      saveUpload(body, "images", IMAGE_KINDS["image/png"], 1024),
      (error: unknown) => error instanceof UploadError && error.status === 415,
    );
    assert.deepEqual(readdirSync(path.join(root, "images")), []);
  });
});
