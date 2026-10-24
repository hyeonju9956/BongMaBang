import test from "node:test";
import assert from "node:assert/strict";
import { createSession, hashPassword, readSession, verifyPassword } from "../auth.js";

test("password hashes verify only the matching password", () => {
  const encoded = hashPassword("correct-horse-battery-staple");
  assert.equal(verifyPassword("correct-horse-battery-staple", encoded), true);
  assert.equal(verifyPassword("different-password", encoded), false);
  assert.equal(verifyPassword("anything", "malformed"), false);
});

test("sessions are signed and expire", () => {
  const now = 1_800_000_000_000;
  const token = createSession("0123456789abcdef01234567", "test-secret-that-is-long-enough", now);
  assert.equal(readSession(token, "test-secret-that-is-long-enough", now).sub, "0123456789abcdef01234567");
  assert.equal(readSession(token, "another-test-secret-that-is-long-enough", now), null);
  assert.equal(readSession(token, "test-secret-that-is-long-enough", now + 13 * 60 * 60 * 1000), null);
});
