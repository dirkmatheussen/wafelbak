"""Local runner for the Wafelbak Flask app (production uses gunicorn main:app)."""

from main import run

if __name__ == "__main__":
    run()
