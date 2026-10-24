import crypto from "node:crypto";

const passwordCost = 64 * 1024;
const passwordBlockSize = 8;
const passwordParallelization = 1;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N: passwordCost,
    r: passwordBlockSize,
    p: passwordParallelization,
    maxmem: 128 * 1024 * 1024
  });
  return `${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPassword(password, storedHash) {
  const [saltPart, hashPart, extra] = String(storedHash).split(".");
  if (!saltPart || !hashPart || extra !== undefined) return false;
  try {
    const salt = Buffer.from(saltPart, "base64url");
    const expected = Buffer.from(hashPart, "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: passwordCost,
      r: passwordBlockSize,
      p: passwordParallelization,
      maxmem: 128 * 1024 * 1024
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSession(userId, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(now / 1000) + 60 * 60 * 12
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSession(token, secret, now = Date.now()) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.sub !== "string" || !Number.isSafeInteger(session.exp) ||
        session.exp <= Math.floor(now / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}
