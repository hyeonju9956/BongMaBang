import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import { MongoClient, ObjectId } from "mongodb";
import { createSession, hashPassword, readSession, verifyPassword } from "./auth.js";
import { toExportEpisode, ValidationError, validateEpisode } from "./validation.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "bongmabang";
const sessionSecret = process.env.SESSION_SECRET;
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",").map(origin => origin.trim()).filter(Boolean);

if (!mongoUri) throw new Error("MONGODB_URI 환경 변수가 필요합니다.");
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET은 32자 이상의 임의 문자열이어야 합니다.");
}
if (sessionSecret.startsWith("replace-with-")) {
  throw new Error("SESSION_SECRET 예시값을 강한 임의 비밀값으로 바꿔 주세요.");
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD.startsWith("replace-with-")) {
  throw new Error("최초 관리자 생성을 위해 ADMIN_USERNAME과 ADMIN_PASSWORD가 필요합니다.");
}
if (process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("ADMIN_PASSWORD는 12자 이상이어야 합니다.");
}

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
let episodes;
let settings;
let users;
let changeRequests;
const loginAttempts = new Map();

app.disable("x-powered-by");
app.use(helmet());
app.use((request, response, next) => {
  const origin = request.get("origin");
  const sameOrigin = origin && origin === `${request.protocol}://${request.get("host")}`;
  if (origin && (sameOrigin || allowedOrigins.includes(origin))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  } else if (origin) {
    return response.status(403).json({ error: "이 웹사이트에서의 요청은 허용되지 않습니다." });
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb", strict: true }));

function publicUser(user) {
  return {
    id: user._id.toHexString(),
    username: user.username,
    role: user.role
  };
}

function readEpisode(document) {
  return {
    id: document._id.toHexString(),
    order: document.order,
    version: document.version,
    era: document.era,
    title: document.title,
    who: document.who,
    text: document.text,
    ...(document.bright ? { bright: true } : {})
  };
}

function readChangeRequest(document) {
  return {
    id: document._id.toHexString(),
    action: document.action,
    episodeId: document.episodeId || null,
    baseVersion: document.baseVersion ?? null,
    orderVersion: document.orderVersion ?? null,
    payload: document.payload || null,
    ids: document.ids || null,
    before: document.before || null,
    status: document.status,
    createdAt: document.createdAt,
    submittedBy: document.submittedBy,
    decidedAt: document.decidedAt || null,
    decidedBy: document.decidedBy || null,
    reason: document.reason || null
  };
}

function requireAuth(request, response, next) {
  const bearer = request.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const session = readSession(bearer, sessionSecret);
  if (!session || !ObjectId.isValid(session.sub)) {
    return response.status(401).json({ error: "로그인이 필요하거나 세션이 만료됐습니다." });
  }
  users.findOne({ _id: new ObjectId(session.sub), active: true })
    .then(user => {
      if (!user) return response.status(401).json({ error: "사용할 수 없는 계정입니다." });
      request.user = user;
      next();
    })
    .catch(next);
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ error: "이 작업을 수행할 권한이 없습니다." });
    }
    next();
  };
}

function limitLogin(request, response, next) {
  const key = request.ip;
  const now = Date.now();
  const previous = loginAttempts.get(key);
  if (previous && previous.resetAt > now && previous.count >= 10) {
    response.setHeader("Retry-After", String(Math.ceil((previous.resetAt - now) / 1000)));
    return response.status(429).json({ error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
  }
  const state = previous && previous.resetAt > now
    ? previous
    : { count: 0, resetAt: now + 15 * 60 * 1000 };
  state.count += 1;
  loginAttempts.set(key, state);
  next();
}

function validateCredentials(input) {
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  const errors = {};
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    errors.username = "아이디는 영문·숫자와 _ . -를 사용해 3~32자로 입력해 주세요.";
  }
  if (password.length < 12 || password.length > 256) {
    errors.password = "비밀번호는 12~256자로 입력해 주세요.";
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { username, password };
}

async function withTransaction(operation) {
  const session = mongo.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

async function orderVersion(session) {
  const state = await settings.findOne({ _id: "episodes" }, { session });
  return state?.orderVersion ?? 0;
}

function requireVersion(request, response) {
  const value = request.get("if-match")?.replaceAll('"', "");
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    response.status(428).json({ error: "최신 버전 확인을 위해 If-Match 헤더가 필요합니다." });
    return null;
  }
  return version;
}

function objectId(value, response) {
  if (!ObjectId.isValid(value)) {
    response.status(400).json({ error: "에피소드 ID 형식이 올바르지 않습니다." });
    return null;
  }
  return new ObjectId(value);
}

async function writeEpisodeOrder(ids, session) {
  if (!ids.length) return;
  const saveOrders = orderForIndex => episodes.bulkWrite(ids.map((id, index) => ({
    updateOne: {
      filter: { _id: new ObjectId(id) },
      update: { $set: { order: orderForIndex(index) } }
    }
  })), { session });
  await saveOrders(index => -(index + 1));
  await saveOrders(index => index);
}

async function compactOrders(session) {
  const documents = await episodes.find({}, { session }).sort({ order: 1, _id: 1 }).toArray();
  await writeEpisodeOrder(documents.map(document => document._id.toHexString()), session);
  await settings.updateOne({ _id: "episodes" }, { $inc: { orderVersion: 1 } }, { session });
}

function validateChangeRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError({ request: "객체 형식이어야 합니다." });
  }
  const action = input.action;
  if (!["create", "update", "delete", "reorder"].includes(action)) {
    throw new ValidationError({ action: "create, update, delete, reorder 중 하나여야 합니다." });
  }
  if (action === "create") return { action, payload: validateEpisode(input.payload) };
  if (action === "update" || action === "delete") {
    if (typeof input.episodeId !== "string" || !ObjectId.isValid(input.episodeId)) {
      throw new ValidationError({ episodeId: "올바른 에피소드 ID가 필요합니다." });
    }
    if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1) {
      throw new ValidationError({ baseVersion: "유효한 에피소드 버전이 필요합니다." });
    }
    return {
      action,
      episodeId: input.episodeId,
      baseVersion: input.baseVersion,
      ...(action === "update" ? { payload: validateEpisode(input.payload) } : {})
    };
  }
  if (!Number.isSafeInteger(input.orderVersion) || input.orderVersion < 0) {
    throw new ValidationError({ orderVersion: "유효한 순서 버전이 필요합니다." });
  }
  if (!Array.isArray(input.ids) || input.ids.some(id => typeof id !== "string" || !ObjectId.isValid(id)) ||
      new Set(input.ids).size !== input.ids.length) {
    throw new ValidationError({ ids: "중복 없는 에피소드 ID 배열이어야 합니다." });
  }
  return { action, orderVersion: input.orderVersion, ids: input.ids };
}

async function applyChangeRequest(change, approver) {
  return withTransaction(async session => {
    const requestId = new ObjectId(change.id);
    const currentRequest = await changeRequests.findOne(
      { _id: requestId, status: "pending" },
      { session }
    );
    if (!currentRequest) return { conflict: "요청이 이미 처리됐습니다." };

    if (currentRequest.action === "create") {
      const last = await episodes.find({}, { session }).sort({ order: -1 }).limit(1).next();
      const document = {
        ...currentRequest.payload,
        order: (last?.order ?? -1) + 1,
        version: 1
      };
      await episodes.insertOne(document, { session });
      await settings.updateOne({ _id: "episodes" }, { $inc: { orderVersion: 1 } }, { session });
    } else if (currentRequest.action === "update") {
      const result = await episodes.updateOne(
        { _id: new ObjectId(currentRequest.episodeId), version: currentRequest.baseVersion },
        { $set: currentRequest.payload, $inc: { version: 1 } },
        { session }
      );
      if (!result.matchedCount) return { conflict: "대상 에피소드가 변경 또는 삭제됐습니다. 요청을 거절해 주세요." };
    } else if (currentRequest.action === "delete") {
      const result = await episodes.deleteOne(
        { _id: new ObjectId(currentRequest.episodeId), version: currentRequest.baseVersion },
        { session }
      );
      if (!result.deletedCount) return { conflict: "대상 에피소드가 변경 또는 삭제됐습니다. 요청을 거절해 주세요." };
      await compactOrders(session);
    } else {
      const currentVersion = await orderVersion(session);
      if (currentVersion !== currentRequest.orderVersion) {
        return { conflict: "에피소드 순서가 이미 변경됐습니다. 요청을 거절해 주세요." };
      }
      const documents = await episodes.find({}, { session, projection: { _id: 1 } }).toArray();
      const currentIds = new Set(documents.map(document => document._id.toHexString()));
      if (currentIds.size !== currentRequest.ids.length ||
          currentRequest.ids.some(id => !currentIds.has(id))) {
        return { conflict: "현재 에피소드 목록이 요청 당시와 다릅니다. 요청을 거절해 주세요." };
      }
      await writeEpisodeOrder(currentRequest.ids, session);
      await settings.updateOne({ _id: "episodes" }, { $inc: { orderVersion: 1 } }, { session });
    }

    const updated = await changeRequests.updateOne(
      { _id: requestId, status: "pending" },
      {
        $set: {
          status: "approved",
          decidedAt: new Date(),
          decidedBy: approver.username
        }
      },
      { session }
    );
    if (!updated.modifiedCount) return { conflict: "요청이 이미 처리됐습니다." };
    return { conflict: null };
  });
}

app.get("/api/health", async (_request, response, next) => {
  try {
    await mongo.db(databaseName).command({ ping: 1 });
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", limitLogin, async (request, response, next) => {
  try {
    const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const user = await users.findOne({ username, active: true });
    const verified = user && verifyPassword(password, user.passwordHash);
    if (!verified) return response.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    loginAttempts.delete(request.ip);
    response.json({
      token: createSession(user._id.toHexString(), sessionSecret),
      user: publicUser(user),
      expiresIn: 43200
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.post("/api/auth/logout", requireAuth, (_request, response) => response.sendStatus(204));

app.get("/api/episodes", async (_request, response, next) => {
  try {
    const [documents, state] = await Promise.all([
      episodes.find({}).sort({ order: 1, _id: 1 }).toArray(),
      settings.findOne({ _id: "episodes" })
    ]);
    response.json({
      episodes: documents.map(readEpisode),
      orderVersion: state?.orderVersion ?? 0
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/export", async (_request, response, next) => {
  try {
    const documents = await episodes.find({}).sort({ order: 1, _id: 1 }).toArray();
    const contents = `${JSON.stringify(documents.map(toExportEpisode), null, 2)}\n`;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="episodes.json"');
    response.send(contents);
  } catch (error) {
    next(error);
  }
});

app.get("/api/requests/mine", requireAuth, async (request, response, next) => {
  try {
    const documents = await changeRequests.find({ submittedById: request.user._id })
      .sort({ createdAt: -1 }).limit(100).toArray();
    response.json({ requests: documents.map(readChangeRequest) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/requests", requireAuth, requireRole("user"), async (request, response, next) => {
  try {
    const change = validateChangeRequest(request.body);
    let before = null;
    if (change.action === "update" || change.action === "delete") {
      const current = await episodes.findOne(
        { _id: new ObjectId(change.episodeId), version: change.baseVersion },
        { projection: { _id: 1, era: 1, title: 1, text: 1, who: 1, bright: 1 } }
      );
      if (!current) return response.status(409).json({ error: "대상 에피소드가 변경됐습니다. 새로고침해 주세요." });
      before = {
        era: current.era,
        title: current.title,
        text: current.text,
        who: current.who,
        ...(current.bright ? { bright: true } : {})
      };
    }
    if (change.action === "reorder") {
      if (change.orderVersion !== await orderVersion()) {
        return response.status(409).json({ error: "에피소드 순서가 변경됐습니다. 새로고침해 주세요." });
      }
      const current = await episodes.find({}).sort({ order: 1, _id: 1 }).project({ _id: 1, title: 1, era: 1 }).toArray();
      before = current.map(episode => ({
        id: episode._id.toHexString(),
        title: episode.title,
        era: episode.era
      }));
    }
    const now = new Date();
    const document = {
      ...change,
      ...(before ? { before } : {}),
      status: "pending",
      submittedById: request.user._id,
      submittedBy: request.user.username,
      createdAt: now
    };
    const result = await changeRequests.insertOne(document);
    response.status(201).json({
      request: readChangeRequest({ ...document, _id: result.insertedId })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/requests", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const status = request.query.status === "all" ? null : "pending";
    const filter = status ? { status } : {};
    const documents = await changeRequests.find(filter).sort({ createdAt: 1 }).limit(500).toArray();
    response.json({ requests: documents.map(readChangeRequest) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/requests/:id/approve", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      return response.status(400).json({ error: "요청 ID 형식이 올바르지 않습니다." });
    }
    const change = await changeRequests.findOne({ _id: new ObjectId(request.params.id) });
    if (!change) return response.status(404).json({ error: "요청을 찾을 수 없습니다." });
    const result = await applyChangeRequest(change, request.user);
    if (result.conflict) return response.status(409).json({ error: result.conflict });
    response.json({ status: "approved" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/requests/:id/reject", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      return response.status(400).json({ error: "요청 ID 형식이 올바르지 않습니다." });
    }
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim().slice(0, 500) : "";
    const result = await changeRequests.updateOne(
      { _id: new ObjectId(request.params.id), status: "pending" },
      {
        $set: {
          status: "rejected",
          decidedAt: new Date(),
          decidedBy: request.user.username,
          ...(reason ? { reason } : {})
        }
      }
    );
    if (!result.modifiedCount) {
      return response.status(409).json({ error: "이미 처리됐거나 존재하지 않는 요청입니다." });
    }
    response.json({ status: "rejected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const credentials = validateCredentials(request.body);
    const document = {
      ...credentials,
      passwordHash: hashPassword(credentials.password),
      role: "user",
      active: true,
      createdAt: new Date(),
      createdBy: request.user.username
    };
    delete document.password;
    try {
      const result = await users.insertOne(document);
      response.status(201).json({
        user: publicUser({ ...document, _id: result.insertedId })
      });
    } catch (error) {
      if (error.code === 11000) return response.status(409).json({ error: "이미 사용 중인 아이디입니다." });
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", requireAuth, requireRole("admin"), async (_request, response, next) => {
  try {
    const documents = await users.find({}, { projection: { passwordHash: 0 } })
      .sort({ username: 1 }).toArray();
    response.json({
      users: documents.map(user => ({ ...publicUser(user), active: user.active }))
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) {
      return response.status(400).json({ error: "사용자 ID 형식이 올바르지 않습니다." });
    }
    const active = request.body?.active;
    if (typeof active !== "boolean") {
      throw new ValidationError({ active: "true 또는 false여야 합니다." });
    }
    const id = new ObjectId(request.params.id);
    if (!active && id.equals(request.user._id)) {
      return response.status(400).json({ error: "현재 로그인한 관리자 계정은 비활성화할 수 없습니다." });
    }
    const user = await users.findOneAndUpdate(
      { _id: id, role: "user" },
      { $set: { active } },
      { returnDocument: "after", projection: { passwordHash: 0 } }
    );
    if (!user) return response.status(404).json({ error: "일반 사용자 계정을 찾을 수 없습니다." });
    response.json({ user: { ...publicUser(user), active: user.active } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/episodes", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const episode = validateEpisode(request.body);
    const created = await withTransaction(async session => {
      const last = await episodes.find({}, { session }).sort({ order: -1 }).limit(1).next();
      const document = { ...episode, order: (last?.order ?? -1) + 1, version: 1 };
      const result = await episodes.insertOne(document, { session });
      await settings.updateOne({ _id: "episodes" }, { $inc: { orderVersion: 1 } }, { session });
      const state = await settings.findOne({ _id: "episodes" }, { session });
      return { episode: { ...document, _id: result.insertedId }, orderVersion: state.orderVersion };
    });
    response.status(201).json({ episode: readEpisode(created.episode), orderVersion: created.orderVersion });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/episodes/:id", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const id = objectId(request.params.id, response);
    if (!id) return;
    const version = requireVersion(request, response);
    if (version === null) return;
    const update = validateEpisode(request.body);
    const result = await episodes.findOneAndUpdate(
      { _id: id, version },
      { $set: update, $inc: { version: 1 } },
      { returnDocument: "after" }
    );
    if (!result) {
      const exists = await episodes.findOne({ _id: id }, { projection: { _id: 1 } });
      return response.status(exists ? 409 : 404).json({
        error: exists ? "다른 편집자가 먼저 수정했습니다. 최신 데이터를 다시 불러와 주세요." : "에피소드를 찾을 수 없습니다."
      });
    }
    response.json({ episode: readEpisode(result) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/episodes/:id", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const id = objectId(request.params.id, response);
    if (!id) return;
    const version = requireVersion(request, response);
    if (version === null) return;
    const result = await withTransaction(async session => {
      const deleted = await episodes.deleteOne({ _id: id, version }, { session });
      if (!deleted.deletedCount) return { deleted: false };
      await compactOrders(session);
      return { deleted: true, orderVersion: await orderVersion(session) };
    });
    if (!result.deleted) {
      const exists = await episodes.findOne({ _id: id }, { projection: { _id: 1 } });
      return response.status(exists ? 409 : 404).json({
        error: exists ? "다른 편집자가 먼저 수정했습니다. 최신 데이터를 다시 불러와 주세요." : "에피소드를 찾을 수 없습니다."
      });
    }
    response.json({ orderVersion: result.orderVersion });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/episodes/reorder", requireAuth, requireRole("admin"), async (request, response, next) => {
  try {
    const expectedVersion = Number(request.get("if-match")?.replaceAll('"', ""));
    const ids = request.body?.ids;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return response.status(428).json({ error: "최신 순서 확인을 위해 If-Match 헤더가 필요합니다." });
    }
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !ObjectId.isValid(id)) ||
        new Set(ids).size !== ids.length) {
      return response.status(400).json({ error: "ids는 중복 없는 에피소드 ID 배열이어야 합니다." });
    }
    const result = await withTransaction(async session => {
      const currentVersion = await orderVersion(session);
      if (currentVersion !== expectedVersion) return { conflict: true };
      const documents = await episodes.find({}, { session, projection: { _id: 1 } }).toArray();
      const currentIds = new Set(documents.map(document => document._id.toHexString()));
      if (ids.length !== currentIds.size || ids.some(id => !currentIds.has(id))) {
        return { invalid: true };
      }
      await writeEpisodeOrder(ids, session);
      await settings.updateOne({ _id: "episodes" }, { $inc: { orderVersion: 1 } }, { session });
      return { conflict: false };
    });
    if (result.conflict) return response.status(409).json({ error: "순서가 변경됐습니다. 목록을 새로고침해 주세요." });
    if (result.invalid) return response.status(400).json({ error: "모든 에피소드를 빠짐없이 한 번씩 지정해야 합니다." });
    response.json({ orderVersion: expectedVersion + 1 });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof ValidationError) {
    return response.status(422).json({ error: error.message, fields: error.fields });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "JSON 요청 본문을 읽을 수 없습니다." });
  }
  if (error.code === 20 || error.codeName === "IllegalOperation") {
    return response.status(503).json({ error: "승인·삭제·순서 변경에는 MongoDB replica set이 필요합니다." });
  }
  console.error(error);
  response.status(500).json({ error: "서버에서 요청을 처리하지 못했습니다." });
});

async function start() {
  await mongo.connect();
  const database = mongo.db(databaseName);
  episodes = database.collection("episodes");
  settings = database.collection("settings");
  users = database.collection("users");
  changeRequests = database.collection("changeRequests");
  await Promise.all([
    episodes.createIndex({ order: 1 }),
    users.createIndex({ username: 1 }, { unique: true }),
    changeRequests.createIndex({ status: 1, createdAt: 1 }),
    changeRequests.createIndex({ submittedById: 1, createdAt: -1 }),
    settings.updateOne({ _id: "episodes" }, { $setOnInsert: { orderVersion: 0 } }, { upsert: true })
  ]);

  const adminUsername = process.env.ADMIN_USERNAME.trim();
  const existingAdmin = await users.findOne({ username: adminUsername });
  if (!existingAdmin) {
    await users.insertOne({
      username: adminUsername,
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD),
      role: "admin",
      active: true,
      createdAt: new Date(),
      createdBy: "bootstrap"
    });
    console.log(`Initial administrator account created: ${adminUsername}`);
  } else if (existingAdmin.role !== "admin") {
    throw new Error("ADMIN_USERNAME이 이미 일반 사용자 계정으로 사용 중입니다.");
  }

  app.listen(port, () => console.log(`BongMaBang API listening on port ${port}`));
}

start().catch(async error => {
  console.error("API startup failed:", error.message);
  await mongo.close();
  process.exitCode = 1;
});
