"""Serve the Wafelbak site and its shared practice recordings on Postgres."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import unquote, urlsplit
import uuid
import wave

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
COOKIE = "wafelbak_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
MAX_SECONDS = 20
MAX_AUDIO_BYTES = 3 * 1024 * 1024
PASSWORD_MIN = 8
PASSWORD_MAX = 128
PBKDF2_ROUNDS = 260000
AUDIO_ROUTE = re.compile(r"/api/recordings/([a-f0-9]{32})")
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
ARRIVAL_TIME = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]")
AUTH_ERROR = "E-mailadres of wachtwoord is onjuist."
REGISTER_ERROR = "Inschrijving mislukt. Controleer je gegevens."
# Fixed dummy hash so failed logins still pay the PBKDF2 cost.
DUMMY_PASSWORD_HASH = (
    "pbkdf2_sha256$260000$"
    "00000000000000000000000000000000$"
    "0000000000000000000000000000000000000000000000000000000000000000"
)


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def database_url(value=None):
    url = value or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "DATABASE_URL is verplicht. Zet die op je Postgres-connectiestring "
            "(Cursor Apps voorziet die automatisch)."
        )
    return url


def connect(url):
    # Autocommit so read queries don't leave an open transaction that would
    # roll back nested write blocks when the request connection closes.
    return psycopg.connect(url, row_factory=dict_row, autocommit=True)


def initialize(url):
    with closing(connect(url)) as db:
        with db.transaction():
            for path in MIGRATIONS:
                db.execute(path.read_text(encoding="utf-8"))


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(rounds)
        )
        return hmac.compare_digest(actual, expected)
    except (AttributeError, TypeError, ValueError):
        return False


def password_field(data):
    password = data.get("password")
    password = password if isinstance(password, str) else ""
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        raise RequestError(
            400,
            f"Kies een wachtwoord van {PASSWORD_MIN} tot {PASSWORD_MAX} tekens.",
        )
    return password


def registration_fields(data):
    if not isinstance(data, dict):
        raise RequestError(400, "Vul het inschrijfformulier in.")

    values = {}
    for key, label, limit in [
        ("name", "naam", 120), ("email", "e-mailadres", 254), ("nickname", "roepnaam", 40)
    ]:
        value = data.get(key)
        value = value.strip() if isinstance(value, str) else ""
        if not value or len(value) > limit:
            raise RequestError(400, f"Vul een geldige {label} in (maximaal {limit} tekens).")
        values[key] = value

    if not EMAIL.fullmatch(values["email"]):
        raise RequestError(400, "Geef een geldig e-mailadres.")
    password = password_field(data)
    if data.get("consent") is not True:
        raise RequestError(400, "Geef toestemming voor het delen van je opnames.")
    count = data.get("waffleCount")
    if count is not None and (type(count) is not int or not 0 <= count <= 999):
        raise RequestError(400, "Geef een aantal wafels tussen 0 en 999 op.")
    party_size = data.get("partySize")
    if party_size is not None and (type(party_size) is not int or not 1 <= party_size <= 999):
        raise RequestError(400, "Geef een aantal personen tussen 1 en 999 op.")
    arrival_time = data.get("arrivalTime")
    if arrival_time is not None and (
        not isinstance(arrival_time, str) or not ARRIVAL_TIME.fullmatch(arrival_time)
    ):
        raise RequestError(400, "Vul een geldig aankomstuur in.")
    return (
        values["name"],
        values["email"].lower(),
        values["nickname"],
        password,
        count,
        party_size,
        arrival_time,
    )


def audio_duration(data):
    try:
        with wave.open(io.BytesIO(data)) as audio:
            rate = audio.getframerate()
            frames = audio.getnframes()
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or not 8000 <= rate <= 48000
                or not 0 < frames <= rate * MAX_SECONDS
                or len(audio.readframes(frames)) != frames * 2
            ):
                raise ValueError
            return round(frames / rate, 2)
    except (wave.Error, EOFError, ValueError) as error:
        raise RequestError(415, f"Dit is geen geldig geluidsfragment van maximaal {MAX_SECONDS} seconden.") from error


def serialize_recording(item):
    return {
        "id": item["id"],
        "nickname": item["nickname"],
        "created_at": item["created_at"],
        "duration": float(item["duration"]),
        "own": bool(item["own"]),
    }


class WafelbakHandler(BaseHTTPRequestHandler):
    def send_payload(self, status, content_type, payload, **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for name, value in headers.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def send_json(self, status, data, **headers):
        self.send_payload(
            status, "application/json; charset=utf-8", json.dumps(data).encode(),
            Cache_Control="no-store", **headers,
        )

    def read_payload(self, limit, content_type):
        if self.headers.get_content_type() != content_type:
            raise RequestError(415, "Dit bestandstype wordt niet ondersteund.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size <= 0:
            raise RequestError(400, "De aanvraag bevat geen gegevens.")
        if size > limit:
            raise RequestError(413, "Dit bestand is te groot.")
        data = self.rfile.read(size)
        if len(data) != size:
            raise RequestError(400, "De aanvraag is onvolledig.")
        return data

    def participant(self, db):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        session = cookies.get(COOKIE)
        if not session:
            return None
        now = int(time.time())
        participant = db.execute(
            """SELECT id, nickname, session, TRUE AS primary_session FROM participants
               WHERE session = %s AND expires_at > %s""",
            (session.value, now),
        ).fetchone()
        if participant:
            return participant
        return db.execute(
            """SELECT p.id, p.nickname, s.session, FALSE AS primary_session
               FROM login_sessions AS s JOIN participants AS p ON p.id = s.participant_id
               WHERE s.session = %s AND s.expires_at > %s""",
            (session.value, now),
        ).fetchone()

    def json_body(self):
        try:
            data = json.loads(self.read_payload(8192, "application/json"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RequestError(400, "De aanvraag is onleesbaar.") from error
        if not isinstance(data, dict):
            raise RequestError(400, "De aanvraag is onvolledig.")
        return data

    def send_session(self, status, nickname, token):
        cookie = SimpleCookie()
        cookie[COOKIE] = token
        cookie[COOKIE]["path"] = "/"
        cookie[COOKIE]["max-age"] = SESSION_SECONDS
        cookie[COOKIE]["httponly"] = True
        cookie[COOKIE]["samesite"] = "Strict"
        cookie[COOKIE]["secure"] = self.server.secure_cookie
        self.send_json(status, {"nickname": nickname}, Set_Cookie=cookie[COOKIE].OutputString())

    def register(self, db, participant):
        if participant:
            self.send_json(200, {"nickname": participant["nickname"]})
            return

        name, email, nickname, password, count, party_size, arrival_time = registration_fields(
            self.json_body()
        )
        token = secrets.token_urlsafe(32)
        password_hash = hash_password(password)
        with db.transaction():
            if db.execute("SELECT 1 FROM participants WHERE email = %s", (email,)).fetchone():
                # Same generic copy as other registration failures: no email oracle.
                raise RequestError(400, REGISTER_ERROR)
            db.execute(
                """INSERT INTO participants
                       (session, expires_at, name, email, nickname, password_hash,
                        waffle_count, party_size, arrival_time, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    token, int(time.time()) + SESSION_SECONDS, name, email, nickname,
                    password_hash, count, party_size, arrival_time, timestamp(),
                ),
            )
        self.send_session(201, nickname, token)

    def login(self, db):
        body = self.json_body()
        email = body.get("email")
        email = email.strip().lower() if isinstance(email, str) else ""
        password = body.get("password")
        password = password if isinstance(password, str) else ""
        if len(email) > 254 or not EMAIL.fullmatch(email) or not password:
            raise RequestError(400, AUTH_ERROR)

        participant = db.execute(
            """SELECT id, nickname, password_hash FROM participants
               WHERE email = %s ORDER BY id DESC LIMIT 1""",
            (email,),
        ).fetchone()
        stored = participant["password_hash"] if participant else DUMMY_PASSWORD_HASH
        if not verify_password(password, stored) or not participant:
            raise RequestError(401, AUTH_ERROR)

        now = int(time.time())
        session = secrets.token_urlsafe(32)
        with db.transaction():
            db.execute("DELETE FROM login_sessions WHERE expires_at <= %s", (now,))
            db.execute(
                "INSERT INTO login_sessions (session, participant_id, expires_at) VALUES (%s, %s, %s)",
                (session, participant["id"], now + SESSION_SECONDS),
            )
        self.send_session(200, participant["nickname"], session)

    def recordings(self, db, participant, path, offset):
        match = AUDIO_ROUTE.fullmatch(path)
        # Email-only sign-in grants playback and recording, not control of earlier uploads.
        owner = (participant["id"], bool(participant["primary_session"]), participant["session"])
        if path == "/api/recordings" and self.command == "GET":
            items = db.execute(
                """SELECT r.id, p.nickname, r.created_at, r.duration,
                          (r.participant_id = %s AND (%s OR r.creator_session = %s)) AS own
                   FROM recordings AS r JOIN participants AS p ON p.id = r.participant_id
                   ORDER BY r.created_at DESC, r.id DESC LIMIT 25 OFFSET %s""",
                (*owner, offset),
            ).fetchall()
            self.send_json(200, {"items": [serialize_recording(item) for item in items]})
        elif path == "/api/recordings" and self.command == "POST":
            data = self.read_payload(MAX_AUDIO_BYTES, "audio/wav")
            duration = audio_duration(data)
            recording_id = uuid.uuid4().hex
            with db.transaction():
                db.execute(
                    """INSERT INTO recordings (id, participant_id, created_at, duration, audio, creator_session)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (recording_id, participant["id"], timestamp(), duration, data, participant["session"]),
                )
            self.send_json(201, {"id": recording_id})
        elif match and self.command in ("GET", "HEAD"):
            row = db.execute("SELECT audio FROM recordings WHERE id = %s", (match[1],)).fetchone()
            if not row:
                raise RequestError(404, "Deze opname bestaat niet meer.")
            self.send_audio(bytes(row["audio"]))
        elif match and self.command == "DELETE":
            with db.transaction():
                result = db.execute(
                    """DELETE FROM recordings
                       WHERE id = %s AND participant_id = %s AND (%s OR creator_session = %s)""",
                    (match[1], *owner),
                )
                if result.rowcount == 0:
                    raise RequestError(404, "Deze opname is niet beschikbaar om te verwijderen.")
            self.send_json(200, {})
        else:
            raise RequestError(404, "Deze pagina bestaat niet.")

    def send_audio(self, audio):
        size = len(audio)
        headers = {"Accept_Ranges": "bytes", "Cache_Control": "private, no-store"}
        range_header = self.headers.get("Range")
        if not range_header:
            self.send_payload(200, "audio/wav", audio, **headers)
            return

        match = re.fullmatch(r"bytes=(\d{0,12})-(\d{0,12})", range_header)
        if match and match[1]:
            start = int(match[1])
            end = min(int(match[2]), size - 1) if match[2] else size - 1
        elif match and match[2]:
            start, end = max(0, size - int(match[2])), size - 1
        else:
            start, end = size, size - 1

        if start > end:
            self.send_payload(416, "audio/wav", b"", Content_Range=f"bytes */{size}", **headers)
            return
        self.send_payload(
            206, "audio/wav", audio[start:end + 1], Content_Range=f"bytes {start}-{end}/{size}", **headers
        )

    def static_file(self, path):
        if self.command not in ("GET", "HEAD"):
            raise RequestError(405, "Deze aanvraag wordt niet ondersteund.")
        path = "/index.html" if path == "/" else path
        static = (ROOT / path.lstrip("/")).resolve()
        public = static in (ROOT / "index.html", ROOT / "styles.css") or any(
            static.is_relative_to(ROOT / folder) for folder in ("assets", "src")
        )
        if not public or not static.is_file():
            raise RequestError(404, "Deze pagina bestaat niet.")
        content_type = mimetypes.guess_type(static.name)[0] or "application/octet-stream"
        if static.suffix == ".js":
            content_type = "text/javascript"
        self.send_payload(
            200, content_type, static.read_bytes(), Cache_Control="no-cache",
            Permissions_Policy="microphone=(self)",
        )

    def handle_request(self):
        url = urlsplit(self.path)
        path = unquote(url.path)
        try:
            if not path.startswith("/api/"):
                self.static_file(path)
                return

            if self.command in ("POST", "DELETE") and self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise RequestError(403, "Open eerst de Wafelbak-site.")
            with closing(connect(self.server.database_url)) as db:
                participant = self.participant(db)
                if path == "/api/session" and self.command == "GET":
                    self.send_json(200, {"nickname": participant["nickname"] if participant else None})
                elif path == "/api/register" and self.command == "POST":
                    self.register(db, participant)
                elif path == "/api/login" and self.command == "POST":
                    self.login(db)
                elif not participant:
                    raise RequestError(401, "Schrijf je eerst in.")
                else:
                    offset = int(url.query[7:]) if re.fullmatch(r"offset=\d{1,7}", url.query) else 0
                    self.recordings(db, participant, path, offset)
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})

    do_GET = do_HEAD = do_POST = do_DELETE = handle_request


if __name__ == "__main__":
    default_port = int(os.environ.get("PORT", "4173"))
    default_host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=default_port)
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres URL (default: DATABASE_URL environment variable)",
    )
    parser.add_argument("--secure-cookie", action="store_true", help="use behind HTTPS")
    args = parser.parse_args()
    url = database_url(args.database_url)
    initialize(url)
    with ThreadingHTTPServer((args.host, args.port), WafelbakHandler) as server:
        server.database_url = url
        server.secure_cookie = args.secure_cookie or bool(os.environ.get("PORT"))
        print(f"Wafelbak: http://{args.host}:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
