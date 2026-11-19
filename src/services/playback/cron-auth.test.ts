import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAuthorizedCronRequest, readBearerToken } from "./cron-auth";

describe("readBearerToken", () => {
  it("extracts the token of a Bearer header", () => {
    assert.equal(readBearerToken("Bearer abc123"), "abc123");
    assert.equal(readBearerToken("bearer abc123"), "abc123");
    assert.equal(readBearerToken("Bearer   abc123  "), "abc123");
  });

  it("rejects other shapes", () => {
    assert.equal(readBearerToken(null), null);
    assert.equal(readBearerToken(undefined), null);
    assert.equal(readBearerToken(""), null);
    assert.equal(readBearerToken("abc123"), null);
    assert.equal(readBearerToken("Basic abc123"), null);
    assert.equal(readBearerToken("Bearer"), null);
    assert.equal(readBearerToken("Bearer a b"), null);
  });
});

describe("isAuthorizedCronRequest", () => {
  const SECRET = "s3cr3t-value-with-enough-length";

  it("accepts the exact secret", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
  });

  it("rejects a wrong secret, a prefix and a longer value", () => {
    assert.equal(isAuthorizedCronRequest("Bearer wrong", SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET), false);
  });

  it("rejects a missing or malformed header", () => {
    assert.equal(isAuthorizedCronRequest(null, SECRET), false);
    assert.equal(isAuthorizedCronRequest(SECRET, SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Token ${SECRET}`, SECRET), false);
  });

  it("never authorizes when the secret is not configured", () => {
    assert.equal(isAuthorizedCronRequest("Bearer anything", undefined), false);
    assert.equal(isAuthorizedCronRequest("Bearer anything", ""), false);
    assert.equal(isAuthorizedCronRequest("Bearer anything", "   "), false);
    assert.equal(isAuthorizedCronRequest("Bearer ", ""), false);
  });
});
