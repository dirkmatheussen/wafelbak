"""Flask entrypoint for the Wafelbak site (gunicorn: main:app)."""

from contextlib import closing
from datetime import datetime, timezone
import hashlib
import hmac
import io
import mimetypes
import os
from pathlib import Path
import re
import secrets
import time
import uuid
import wave

from flask import Flask, Response, jsonify, request, send_file
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
MAX_PARTICIPANTS = 100
MAX_RECORDINGS_PER_PARTICIPANT = 3
AUDIO_ROUTE = re.compile(r"^/api/recordings/([a-f0-9]{32})$")
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
ARRIVAL_TIME = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]")
AUTH_ERROR = "E-mailadres of wachtwoord is onjuist."
REGISTER_ERROR = "Inschrijving mislukt. Controleer je gegevens."
REGISTER_FULL = "Inschrijvingen zijn vol (maximum 100)."
UPLOAD_LIMIT = "Je hebt al het maximum van 3 opnames gedeeld."
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
        raise RuntimeError(
            "DATABASE_URL is verplicht. Zet die op je Postgres-connectiestring "
            "(Cursor Apps voorziet die automatisch)."
        )
    return url


def connect(url=None):
    return psycopg.connect(
        url or database_url(), row_factory=dict_row, autocommit=True
    )


def initialize(url=None):
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
        raise RequestError(
            415, f"Dit is geen geldig geluidsfragment van maximaal {MAX_SECONDS} seconden."
        ) from error


def serialize_recording(item):
    return {
        "id": item["id"],
        "nickname": item["nickname"],
        "created_at": item["created_at"],
        "duration": float(item["duration"]),
        "own": bool(item["own"]),
    }


def use_secure_cookie():
    return (
        os.environ.get("SECURE_COOKIE") == "1"
        or bool(os.environ.get("PORT"))
        or request.is_secure
    )


def json_error(error):
    response = jsonify({"error": error.message})
    response.status_code = error.status
    response.headers["Cache-Control"] = "no-store"
    return response


def session_cookie(response, token):
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_SECONDS,
        path="/",
        httponly=True,
        samesite="Strict",
        secure=use_secure_cookie(),
    )
    return response


def current_participant(db):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    now = int(time.time())
    participant = db.execute(
        """SELECT id, nickname, session, TRUE AS primary_session FROM participants
           WHERE session = %s AND expires_at > %s""",
        (token, now),
    ).fetchone()
    if participant:
        return participant
    return db.execute(
        """SELECT p.id, p.nickname, s.session, FALSE AS primary_session
           FROM login_sessions AS s JOIN participants AS p ON p.id = s.participant_id
           WHERE s.session = %s AND s.expires_at > %s""",
        (token, now),
    ).fetchone()


def guard_mutating_origin():
    if request.method in ("POST", "DELETE") and request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise RequestError(403, "Open eerst de Wafelbak-site.")


def create_app():
    application = Flask(__name__)
    if os.environ.get("DATABASE_URL"):
        initialize()
    elif os.environ.get("PORT"):
        raise RuntimeError("DATABASE_URL is verplicht in productie.")

    @application.errorhandler(RequestError)
    def handle_request_error(error):
        return json_error(error)

    @application.get("/api/session")
    def api_session():
        with closing(connect()) as db:
            participant = current_participant(db)
            response = jsonify(
                {"nickname": participant["nickname"] if participant else None}
            )
            response.headers["Cache-Control"] = "no-store"
            return response

    @application.post("/api/register")
    def api_register():
        guard_mutating_origin()
        with closing(connect()) as db:
            participant = current_participant(db)
            if participant:
                response = jsonify({"nickname": participant["nickname"]})
                response.headers["Cache-Control"] = "no-store"
                return response

            data = request.get_json(silent=True)
            name, email, nickname, password, count, party_size, arrival_time = (
                registration_fields(data)
            )
            token = secrets.token_urlsafe(32)
            password_hash = hash_password(password)
            with db.transaction():
                total = db.execute(
                    "SELECT COUNT(*) AS total FROM participants"
                ).fetchone()["total"]
                if total >= MAX_PARTICIPANTS:
                    raise RequestError(403, REGISTER_FULL)
                if db.execute(
                    "SELECT 1 FROM participants WHERE email = %s", (email,)
                ).fetchone():
                    raise RequestError(400, REGISTER_ERROR)
                db.execute(
                    """INSERT INTO participants
                           (session, expires_at, name, email, nickname, password_hash,
                            waffle_count, party_size, arrival_time, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        token,
                        int(time.time()) + SESSION_SECONDS,
                        name,
                        email,
                        nickname,
                        password_hash,
                        count,
                        party_size,
                        arrival_time,
                        timestamp(),
                    ),
                )
            response = jsonify({"nickname": nickname})
            response.status_code = 201
            response.headers["Cache-Control"] = "no-store"
            return session_cookie(response, token)

    @application.post("/api/login")
    def api_login():
        guard_mutating_origin()
        body = request.get_json(silent=True) or {}
        email = body.get("email")
        email = email.strip().lower() if isinstance(email, str) else ""
        password = body.get("password")
        password = password if isinstance(password, str) else ""
        if len(email) > 254 or not EMAIL.fullmatch(email) or not password:
            raise RequestError(400, AUTH_ERROR)

        with closing(connect()) as db:
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
                    """INSERT INTO login_sessions (session, participant_id, expires_at)
                       VALUES (%s, %s, %s)""",
                    (session, participant["id"], now + SESSION_SECONDS),
                )
            response = jsonify({"nickname": participant["nickname"]})
            response.headers["Cache-Control"] = "no-store"
            return session_cookie(response, session)

    @application.get("/api/recordings")
    def api_recordings_list():
        with closing(connect()) as db:
            participant = current_participant(db)
            if not participant:
                raise RequestError(401, "Schrijf je eerst in.")
            offset = request.args.get("offset", "0")
            if not re.fullmatch(r"\d{1,7}", offset):
                offset = "0"
            owner = (
                participant["id"],
                bool(participant["primary_session"]),
                participant["session"],
            )
            items = db.execute(
                """SELECT r.id, p.nickname, r.created_at, r.duration,
                          (r.participant_id = %s AND (%s OR r.creator_session = %s)) AS own
                   FROM recordings AS r JOIN participants AS p ON p.id = r.participant_id
                   ORDER BY r.created_at DESC, r.id DESC LIMIT 25 OFFSET %s""",
                (*owner, int(offset)),
            ).fetchall()
            response = jsonify({"items": [serialize_recording(item) for item in items]})
            response.headers["Cache-Control"] = "no-store"
            return response

    @application.post("/api/recordings")
    def api_recordings_create():
        guard_mutating_origin()
        if request.mimetype != "audio/wav":
            raise RequestError(415, "Dit bestandstype wordt niet ondersteund.")
        data = request.get_data(cache=False)
        if not data:
            raise RequestError(400, "De aanvraag bevat geen gegevens.")
        if len(data) > MAX_AUDIO_BYTES:
            raise RequestError(413, "Dit bestand is te groot.")
        duration = audio_duration(data)
        recording_id = uuid.uuid4().hex
        with closing(connect()) as db:
            participant = current_participant(db)
            if not participant:
                raise RequestError(401, "Schrijf je eerst in.")
            with db.transaction():
                owned = db.execute(
                    "SELECT COUNT(*) AS total FROM recordings WHERE participant_id = %s",
                    (participant["id"],),
                ).fetchone()["total"]
                if owned >= MAX_RECORDINGS_PER_PARTICIPANT:
                    raise RequestError(403, UPLOAD_LIMIT)
                db.execute(
                    """INSERT INTO recordings
                           (id, participant_id, created_at, duration, audio, creator_session)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (
                        recording_id,
                        participant["id"],
                        timestamp(),
                        duration,
                        data,
                        participant["session"],
                    ),
                )
            response = jsonify({"id": recording_id})
            response.status_code = 201
            response.headers["Cache-Control"] = "no-store"
            return response

    @application.route("/api/recordings/<recording_id>", methods=["GET", "HEAD", "DELETE"])
    def api_recording_item(recording_id):
        if not re.fullmatch(r"[a-f0-9]{32}", recording_id):
            raise RequestError(404, "Deze pagina bestaat niet.")
        if request.method == "DELETE":
            guard_mutating_origin()
        with closing(connect()) as db:
            participant = current_participant(db)
            if not participant:
                raise RequestError(401, "Schrijf je eerst in.")
            if request.method == "DELETE":
                owner = (
                    participant["id"],
                    bool(participant["primary_session"]),
                    participant["session"],
                )
                with db.transaction():
                    result = db.execute(
                        """DELETE FROM recordings
                           WHERE id = %s AND participant_id = %s
                             AND (%s OR creator_session = %s)""",
                        (recording_id, *owner),
                    )
                    if result.rowcount == 0:
                        raise RequestError(
                            404, "Deze opname is niet beschikbaar om te verwijderen."
                        )
                response = jsonify({})
                response.headers["Cache-Control"] = "no-store"
                return response

            row = db.execute(
                "SELECT audio FROM recordings WHERE id = %s", (recording_id,)
            ).fetchone()
            if not row:
                raise RequestError(404, "Deze opname bestaat niet meer.")
            audio = bytes(row["audio"])
            return Response(
                audio if request.method == "GET" else b"",
                status=200,
                mimetype="audio/wav",
                headers={
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "private, no-store",
                    "Content-Length": str(len(audio)),
                },
            )

    @application.get("/")
    def home():
        return send_public("index.html")

    @application.get("/<path:path>")
    def public_file(path):
        return send_public(path)

    return application


def send_public(path):
    static = (ROOT / path).resolve()
    public = static in (ROOT / "index.html", ROOT / "styles.css") or any(
        static.is_relative_to(ROOT / folder) for folder in ("assets", "src")
    )
    if not public or not static.is_file():
        raise RequestError(404, "Deze pagina bestaat niet.")
    content_type = mimetypes.guess_type(static.name)[0] or "application/octet-stream"
    if static.suffix == ".js":
        content_type = "text/javascript"
    response = send_file(static, mimetype=content_type)
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = "microphone=(self)"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


app = create_app()


def run():
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    port = int(os.environ.get("PORT", "4173"))
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit(
            "DATABASE_URL is verplicht. Zet die op je Postgres-connectiestring "
            "(Cursor Apps voorziet die automatisch)."
        )
    initialize()
    print(f"Wafelbak: http://{host}:{port}", flush=True)
    app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    run()
