import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { validateEpisode } from "../validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const inputPath = path.join(projectRoot, "data", "episodes.json");
const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "bongmabang";

if (!uri) throw new Error("MONGODB_URI 환경 변수가 필요합니다.");

const client = new MongoClient(uri);
try {
  const episodes = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (!Array.isArray(episodes)) throw new Error("data/episodes.json 최상위 값은 배열이어야 합니다.");
  const normalized = episodes.map(validateEpisode);
  await client.connect();
  const database = client.db(databaseName);
  const collection = database.collection("episodes");
  const existing = await collection.countDocuments();
  if (existing) {
    throw new Error(`DB에 이미 에피소드 ${existing}개가 있습니다. 기존 데이터를 덮어쓰지 않았습니다.`);
  }
  if (normalized.length) {
    await collection.insertMany(normalized.map((episode, order) => ({ ...episode, order, version: 1 })));
  }
  await database.collection("settings").updateOne(
    { _id: "episodes" },
    { $set: { orderVersion: 0 } },
    { upsert: true }
  );
  console.log(`${normalized.length}개 에피소드를 ${databaseName}.episodes로 가져왔습니다.`);
} finally {
  await client.close();
}
