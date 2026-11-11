import {
  createHash,
  pbkdf2,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import { sql, withTransaction } from "./db.mjs";

const pbkdf2Async = promisify(pbkdf2);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const COOKIE = "wafelbak_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_SECONDS = 20;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_JSON_BYTES = 8192;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const PBKDF2_ROUNDS = 260000;
const MAX_PARTICIPANTS = 100;
const MAX_RECORDINGS_PER_PARTICIPANT = 3;
const REGISTER_LIMIT = 3;
const REGISTER_WINDOW = 3600;
const REGISTER_DAY_LIMIT = 6;
const REGISTER_DAY_WINDOW = 24 * 3600;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW = 900;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ARRIVAL_TIME = /(?:1[5-9]|2[0-3]):[0-5][0-9]/;
const AUTH_ERROR = "E-mailadres of wachtwoord is onjuist.";
const REGISTER_FULL = "Inschrijvingen zijn vol (maximum 100).";
const UPLOAD_LIMIT = "Je hebt al het maximum van 3 opnames gedeeld.";
const RATE_LIMIT_ERROR = "Te veel pogingen. Probeer later opnieuw.";
const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$260000$00000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000";

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  if (forwarded) {
    // Proxies append the real client at the end; the first entry is client-controlled.
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const candidate = parts.at(-1) || "unknown";
    return candidate.slice(0, 64);
  }
  return String(req.socket?.remoteAddress || "unknown").slice(0, 64);
}

function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await pbkdf2Async(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  return `pbkdf2_sha256$${PBKDF2_ROUNDS}$${salt.toString("hex")}$${digest.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, rounds, saltHex, digestHex] = String(stored).split("$", 4);
    if (algorithm !== "pbkdf2_sha256") return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(digestHex, "hex");
    const actual = await pbkdf2Async(
      password,
      salt,
      Number(rounds),
      expected.length,
      "sha256",
    );
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function passwordField(data) {
  const password = typeof data.password === "string" ? data.password : "";
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new RequestError(
      400,
      `Kies een wachtwoord van ${PASSWORD_MIN} tot ${PASSWORD_MAX} tekens.`,
    );
  }
  return password;
}

function registrationFields(data) {
  if (!data || typeof data !== "object") {
    throw new RequestError(400, "Vul het inschrijfformulier in.");
  }
  const values = {};
  for (const [key, label, limit] of [
    ["name", "naam", 120],
    ["email", "e-mailadres", 254],
    ["nickname", "roepnaam", 40],
  ]) {
    const value = typeof data[key] === "string" ? data[key].trim() : "";
    if (!value || value.length > limit) {
      throw new RequestError(
        400,
        `Vul een geldige ${label} in (maximaal ${limit} tekens).`,
      );
    }
    values[key] = value;
  }
  if (!EMAIL.test(values.email)) {
    throw new RequestError(400, "Geef een geldig e-mailadres.");
  }
  const password = passwordField(data);
  if (data.consent !== true) {
    throw new RequestError(400, "Geef toestemming voor het delen van je opnames.");
  }
  const count = data.waffleCount;
  if (count != null && !(Number.isInteger(count) && count >= 0 && count <= 999)) {
    throw new RequestError(400, "Geef een aantal wafels tussen 0 en 999 op.");
  }
  const partySize = data.partySize;
  if (
    partySize != null &&
    !(Number.isInteger(partySize) && partySize >= 1 && partySize <= 999)
  ) {
    throw new RequestError(400, "Geef een aantal personen tussen 1 en 999 op.");
  }
  const arrivalTime = data.arrivalTime;
  if (
    arrivalTime != null &&
    !(typeof arrivalTime === "string" && ARRIVAL_TIME.test(arrivalTime))
  ) {
    throw new RequestError(400, "Kies een aankomstuur vanaf 15:00.");
  }
  return {
    name: values.name,
    email: values.email.toLowerCase(),
    nickname: values.nickname,
    password,
    count,
    partySize,
    arrivalTime,
  };
}

function parseWavDuration(data) {
  if (data.length < 44) {
    throw new RequestError(
      415,
      `Dit is geen geldig geluidsfragment van maximaal ${MAX_SECONDS} seconden.`,
    );
  }
  const riff = data.toString("ascii", 0, 4);
  const wave = data.toString("ascii", 8, 12);
  const fmt = data.toString("ascii", 12, 16);
  if (riff !== "RIFF" || wave !== "WAVE" || fmt !== "fmt ") {
    throw new RequestError(
      415,
      `Dit is geen geldig geluidsfragment van maximaal ${MAX_SECONDS} seconden.`,
    );
  }
  const audioFormat = data.readUInt16LE(20);
  const channels = data.readUInt16LE(22);
  const sampleRate = data.readUInt32LE(24);
  const bitsPerSample = data.readUInt16LE(34);
  let offset = 12;
  let dataSize = null;
  while (offset + 8 <= data.length) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (
    audioFormat !== 1 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    sampleRate < 8000 ||
    sampleRate > 48000 ||
    dataSize == null ||
    dataSize <= 0 ||
    dataSize > sampleRate * 2 * MAX_SECONDS ||
    dataSize % 2 !== 0
  ) {
    throw new RequestError(
      415,
      `Dit is geen geldig geluidsfragment van maximaal ${MAX_SECONDS} seconden.`,
    );
  }
  return Math.round((dataSize / 2 / sampleRate) * 100) / 100;
}

function serializeRecording(item) {
  return {
    id: item.id,
    nickname: item.nickname,
    created_at: item.created_at,
    duration: Number(item.duration),
    own: Boolean(item.own),
  };
}

function useSecureCookie(req) {
  // Only mark cookies Secure on real HTTPS. A bare PORT value is not enough:
  // local http://127.0.0.1:$PORT must still store the session cookie.
  return (
    process.env.SECURE_COOKIE === "1" ||
    Boolean(req.secure) ||
    req.headers["x-forwarded-proto"] === "https"
  );
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey.trim() === name) {
      return decodeURIComponent(rest.join("=").trim());
    }
  }
  return null;
}

function setSessionCookie(res, req, token) {
  const secure = useSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`,
  );
}

function clearSessionCookie(res, req) {
  const secure = useSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`,
  );
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function declaredContentLength(req, limit) {
  const raw = req.headers["content-length"];
  if (raw == null) {
    // HTTP/2 and some hosts omit Content-Length; still enforce the cap while reading.
    return null;
  }
  const size = Number(raw);
  if (!Number.isInteger(size)) {
    throw new RequestError(400, "Ongeldige Content-Length.");
  }
  if (size <= 0) {
    throw new RequestError(400, "De aanvraag bevat geen gegevens.");
  }
  if (size > limit) {
    throw new RequestError(413, "Dit bestand is te groot.");
  }
  return size;
}

async function readRawBody(req, limit) {
  declaredContentLength(req, limit);

  // Some hosts pre-buffer the body (e.g. serverless adapters).
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) {
      throw new RequestError(413, "Dit bestand is te groot.");
    }
    if (req.body.length === 0) {
      throw new RequestError(400, "De aanvraag bevat geen gegevens.");
    }
    return req.body;
  }
  if (typeof req.body === "string") {
    const buffered = Buffer.from(req.body);
    if (buffered.length > limit) {
      throw new RequestError(413, "Dit bestand is te groot.");
    }
    if (buffered.length === 0) {
      throw new RequestError(400, "De aanvraag bevat geen gegevens.");
    }
    return buffered;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw new RequestError(413, "Dit bestand is te groot.");
    }
    chunks.push(chunk);
  }
  if (total <= 0) {
    throw new RequestError(400, "De aanvraag bevat geen gegevens.");
  }
  return Buffer.concat(chunks, total);
}

async function readJson(req, limit = MAX_JSON_BYTES) {
  const raw = await readRawBody(req, limit);
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("application/json")) {
    throw new RequestError(415, "Dit bestandstype wordt niet ondersteund.");
  }
  let data;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new RequestError(400, "De aanvraag is onleesbaar.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RequestError(400, "De aanvraag is onleesbaar.");
  }
  return data;
}

function guardMutatingOrigin(req) {
  if (
    ["POST", "DELETE"].includes(req.method) &&
    req.headers["sec-fetch-site"] === "cross-site"
  ) {
    throw new RequestError(403, "Open eerst de Wafelbak-site.");
  }
}

async function hitRateLimit(tx, bucket, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  // Drop expired buckets so the table cannot grow forever from login:email:* keys.
  await tx.query(
    "DELETE FROM rate_limits WHERE window_start < $1",
    [
      now -
        Math.max(REGISTER_WINDOW, REGISTER_DAY_WINDOW, LOGIN_WINDOW) * 2,
    ],
  );
  const rows = await tx.query(
    "SELECT count, window_start FROM rate_limits WHERE bucket = $1 FOR UPDATE",
    [bucket],
  );
  const row = rows[0];
  if (!row || now - Number(row.window_start) >= windowSeconds) {
    await tx.query(
      `INSERT INTO rate_limits (bucket, count, window_start)
       VALUES ($1, 1, $2)
       ON CONFLICT (bucket) DO UPDATE
       SET count = 1, window_start = EXCLUDED.window_start`,
      [bucket, now],
    );
    return;
  }
  if (Number(row.count) >= limit) {
    throw new RequestError(429, RATE_LIMIT_ERROR);
  }
  await tx.query("UPDATE rate_limits SET count = count + 1 WHERE bucket = $1", [
    bucket,
  ]);
}

/** Commit rate-limit increments in their own transaction so later auth failures cannot roll them back. */
async function enforceRateLimit(bucket, limit, windowSeconds) {
  await withTransaction(async (tx) => {
    await hitRateLimit(tx, bucket, limit, windowSeconds);
  });
}

function isHoneypotTriggered(data) {
  const bait = data?.website;
  return typeof bait === "string" && bait.trim() !== "";
}

async function currentParticipant(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const digest = tokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  const primary = (
    await sql(
      `SELECT id, nickname, session, TRUE AS primary_session FROM participants
       WHERE session = $1 AND expires_at > $2`,
      [digest, now],
    )
  )[0];
  if (primary) return primary;
  return (
    await sql(
      `SELECT p.id, p.nickname, s.session, FALSE AS primary_session
       FROM login_sessions AS s JOIN participants AS p ON p.id = s.participant_id
       WHERE s.session = $1 AND s.expires_at > $2`,
      [digest, now],
    )
  )[0] || null;
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

async function handleSession(req, res) {
  const participant = await currentParticipant(req);
  json(res, 200, { nickname: participant ? participant.nickname : null });
}

async function handleRegister(req, res) {
  guardMutatingOrigin(req);
  const data = await readJson(req);
  const existing = await currentParticipant(req);
  if (existing) {
    json(res, 200, { ok: true, nickname: existing.nickname });
    return;
  }

  const ip = clientIp(req);
  // Rate-limit before any PBKDF2 work so floods cannot burn the event loop.
  await enforceRateLimit(
    `register:ip:${ip}`,
    REGISTER_LIMIT,
    REGISTER_WINDOW,
  );
  await enforceRateLimit(
    `register:ip-day:${ip}`,
    REGISTER_DAY_LIMIT,
    REGISTER_DAY_WINDOW,
  );

  // Honeypot: same opaque success + decoy cookie, no account created.
  if (isHoneypotTriggered(data)) {
    setSessionCookie(res, req, newToken());
    json(res, 200, { ok: true });
    return;
  }

  const fields = registrationFields(data);
  let sessionToken = null;

  await withTransaction(async (tx) => {
    const total = Number(
      (await tx.query("SELECT COUNT(*)::int AS total FROM participants"))[0]
        .total,
    );
    if (total >= MAX_PARTICIPANTS) {
      throw new RequestError(403, REGISTER_FULL);
    }
    const found = (
      await tx.query(
        `SELECT id, nickname, password_hash FROM participants
         WHERE email = $1 ORDER BY id DESC LIMIT 1`,
        [fields.email],
      )
    )[0];
    if (!found) {
      // Hash only after rate limits and only for a new address.
      const passwordHash = await hashPassword(fields.password);
      const token = newToken();
      const digest = tokenHash(token);
      await tx.query(
        `INSERT INTO participants
           (session, expires_at, name, email, nickname, password_hash,
            waffle_count, party_size, arrival_time, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          digest,
          Math.floor(Date.now() / 1000) + SESSION_SECONDS,
          fields.name,
          fields.email,
          fields.nickname,
          passwordHash,
          fields.count,
          fields.partySize,
          fields.arrivalTime,
          timestamp(),
        ],
      );
      sessionToken = token;
      return;
    }

    // Existing email + correct password → silent login (no enumeration).
    if (await verifyPassword(fields.password, found.password_hash)) {
      const token = newToken();
      const digest = tokenHash(token);
      const now = Math.floor(Date.now() / 1000);
      await tx.query("DELETE FROM login_sessions WHERE expires_at <= $1", [now]);
      await tx.query(
        `INSERT INTO login_sessions (session, participant_id, expires_at)
         VALUES ($1, $2, $3)`,
        [digest, found.id, now + SESSION_SECONDS],
      );
      sessionToken = token;
    }
  });

  // Always Set-Cookie so new vs existing emails look the same on the wire.
  setSessionCookie(res, req, sessionToken || newToken());
  json(res, 200, { ok: true });
}

async function handleLogin(req, res) {
  guardMutatingOrigin(req);
  const body = await readJson(req);
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (email.length > 254 || !EMAIL.test(email) || !password) {
    throw new RequestError(400, AUTH_ERROR);
  }

  // Commit attempt counters before password checks so 401 cannot undo them.
  await enforceRateLimit(
    `login:ip:${clientIp(req)}`,
    LOGIN_LIMIT,
    LOGIN_WINDOW,
  );
  await enforceRateLimit(
    `login:email:${email}`,
    LOGIN_LIMIT,
    LOGIN_WINDOW,
  );

  let nickname;
  let token;
  await withTransaction(async (tx) => {
    const participant = (
      await tx.query(
        `SELECT id, nickname, password_hash FROM participants
         WHERE email = $1 ORDER BY id DESC LIMIT 1`,
        [email],
      )
    )[0];
    const stored = participant?.password_hash || DUMMY_PASSWORD_HASH;
    if (!(await verifyPassword(password, stored)) || !participant) {
      throw new RequestError(401, AUTH_ERROR);
    }
    const now = Math.floor(Date.now() / 1000);
    token = newToken();
    const digest = tokenHash(token);
    await tx.query("DELETE FROM login_sessions WHERE expires_at <= $1", [now]);
    await tx.query(
      `INSERT INTO login_sessions (session, participant_id, expires_at)
       VALUES ($1, $2, $3)`,
      [digest, participant.id, now + SESSION_SECONDS],
    );
    nickname = participant.nickname;
  });

  setSessionCookie(res, req, token);
  json(res, 200, { nickname });
}

async function handleDeleteAccount(req, res) {
  guardMutatingOrigin(req);
  const participant = await currentParticipant(req);
  if (!participant) {
    throw new RequestError(401, "Schrijf je eerst in.");
  }
  await sql("DELETE FROM participants WHERE id = $1", [participant.id]);
  clearSessionCookie(res, req);
  json(res, 200, { ok: true });
}

async function handleRecordingsList(req, res) {
  const participant = await currentParticipant(req);
  if (!participant) {
    throw new RequestError(401, "Schrijf je eerst in.");
  }
  const url = new URL(req.url, "http://localhost");
  let offset = url.searchParams.get("offset") || "0";
  if (!/^\d{1,7}$/.test(offset)) offset = "0";
  const items = await sql(
    `SELECT r.id, p.nickname, r.created_at, r.duration,
            (r.participant_id = $1 AND ($2 OR r.creator_session = $3)) AS own
     FROM recordings AS r JOIN participants AS p ON p.id = r.participant_id
     ORDER BY r.created_at DESC, r.id DESC LIMIT 25 OFFSET $4`,
    [
      participant.id,
      Boolean(participant.primary_session),
      participant.session,
      Number(offset),
    ],
  );
  json(res, 200, { items: items.map(serializeRecording) });
}

async function handleRecordingsCreate(req, res) {
  guardMutatingOrigin(req);
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("audio/wav")) {
    throw new RequestError(415, "Dit bestandstype wordt niet ondersteund.");
  }
  const participant = await currentParticipant(req);
  if (!participant) {
    throw new RequestError(401, "Schrijf je eerst in.");
  }
  const data = await readRawBody(req, MAX_AUDIO_BYTES);
  if (!data.length) {
    throw new RequestError(400, "De aanvraag bevat geen gegevens.");
  }
  const duration = parseWavDuration(data);
  const recordingId = randomBytes(16).toString("hex");

  await withTransaction(async (tx) => {
    await tx.query("SELECT id FROM participants WHERE id = $1 FOR UPDATE", [
      participant.id,
    ]);
    const owned = Number(
      (
        await tx.query(
          "SELECT COUNT(*)::int AS total FROM recordings WHERE participant_id = $1",
          [participant.id],
        )
      )[0].total,
    );
    if (owned >= MAX_RECORDINGS_PER_PARTICIPANT) {
      throw new RequestError(403, UPLOAD_LIMIT);
    }
    await tx.query(
      `INSERT INTO recordings
         (id, participant_id, created_at, duration, audio, creator_session)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        recordingId,
        participant.id,
        timestamp(),
        duration,
        data,
        participant.session,
      ],
    );
  });

  json(res, 201, { id: recordingId });
}

async function handleRecordingItem(req, res, recordingId) {
  if (!/^[a-f0-9]{32}$/.test(recordingId)) {
    throw new RequestError(404, "Deze pagina bestaat niet.");
  }
  if (req.method === "DELETE") {
    guardMutatingOrigin(req);
  }
  const participant = await currentParticipant(req);
  if (!participant) {
    throw new RequestError(401, "Schrijf je eerst in.");
  }

  if (req.method === "DELETE") {
    const result = await withTransaction(async (tx) => {
      return tx.query(
        `DELETE FROM recordings
         WHERE id = $1 AND participant_id = $2
           AND ($3 OR creator_session = $4)
         RETURNING id`,
        [
          recordingId,
          participant.id,
          Boolean(participant.primary_session),
          participant.session,
        ],
      );
    });
    if (result.length === 0) {
      throw new RequestError(
        404,
        "Deze opname is niet beschikbaar om te verwijderen.",
      );
    }
    json(res, 200, {});
    return;
  }

  const row = (
    await sql("SELECT audio FROM recordings WHERE id = $1", [recordingId])
  )[0];
  if (!row) {
    throw new RequestError(404, "Deze opname bestaat niet meer.");
  }
  const audio = Buffer.isBuffer(row.audio)
    ? row.audio
    : Buffer.from(row.audio);
  res.statusCode = 200;
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", String(audio.length));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(audio);
}

function publicPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  if (!clean || clean === "index.html") {
    return path.join(PUBLIC, "index.html");
  }
  const candidate = path.resolve(PUBLIC, clean);
  const allowed =
    candidate === path.join(PUBLIC, "index.html") ||
    candidate === path.join(PUBLIC, "styles.css") ||
    candidate.startsWith(path.join(PUBLIC, "assets") + path.sep) ||
    candidate.startsWith(path.join(PUBLIC, "src") + path.sep);
  if (!allowed || !candidate.startsWith(PUBLIC + path.sep)) return null;
  return candidate;
}

function sendPublic(res, filePath) {
  let data;
  try {
    data = readFileSync(filePath);
  } catch {
    throw new RequestError(404, "Deze pagina bestaat niet.");
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  };
  res.statusCode = 200;
  res.setHeader("Content-Type", types[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Permissions-Policy", "microphone=(self)");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.end(data);
}

async function dispatchApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  try {
    if (pathname === "/api/session" && req.method === "GET") {
      await handleSession(req, res);
      return;
    }
    if (pathname === "/api/register" && req.method === "POST") {
      await handleRegister(req, res);
      return;
    }
    if (pathname === "/api/login" && req.method === "POST") {
      await handleLogin(req, res);
      return;
    }
    if (pathname === "/api/account" && req.method === "DELETE") {
      await handleDeleteAccount(req, res);
      return;
    }
    if (pathname === "/api/recordings" && req.method === "GET") {
      await handleRecordingsList(req, res);
      return;
    }
    if (pathname === "/api/recordings" && req.method === "POST") {
      await handleRecordingsCreate(req, res);
      return;
    }
    const match = pathname.match(/^\/api\/recordings\/([a-f0-9]{32})$/);
    if (match && ["GET", "HEAD", "DELETE"].includes(req.method)) {
      await handleRecordingItem(req, res, match[1]);
      return;
    }
    throw new RequestError(404, "Deze pagina bestaat niet.");
  } catch (error) {
    if (error instanceof RequestError) {
      json(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    json(res, 500, { error: "Er ging iets mis. Probeer opnieuw." });
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    if (req.url.startsWith("/api/")) {
      dispatchApi(req, res).catch(next);
      return;
    }
    next();
  });

  app.get("/", (_req, res) => {
    try {
      sendPublic(res, path.join(PUBLIC, "index.html"));
    } catch (error) {
      if (error instanceof RequestError) {
        json(res, error.status, { error: error.message });
        return;
      }
      throw error;
    }
  });

  app.get(/.*/, (req, res) => {
    try {
      const filePath = publicPath(req.path);
      if (!filePath) {
        throw new RequestError(404, "Deze pagina bestaat niet.");
      }
      sendPublic(res, filePath);
    } catch (error) {
      if (error instanceof RequestError) {
        json(res, error.status, { error: error.message });
        return;
      }
      throw error;
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (!res.headersSent) {
      json(res, 500, { error: "Er ging iets mis. Probeer opnieuw." });
    }
  });

  return app;
}

export { dispatchApi, MAX_AUDIO_BYTES };
