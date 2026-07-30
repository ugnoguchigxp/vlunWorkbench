import hashlib
import pickle
import random
import subprocess

import requests
from markupsafe import Markup


def vulnerable(value, cursor):
    # ruleid: vuln-workbench.python.command-injection
    subprocess.run(value, shell=True)
    # ruleid: vuln-workbench.python.command-injection
    subprocess.call(value, shell=True)
    # ruleid: vuln-workbench.python.sql-injection
    cursor.execute(f"SELECT * FROM users WHERE id = {value}")
    # ruleid: vuln-workbench.python.sql-injection
    cursor.execute("DELETE FROM users WHERE id = %s" % value)
    # ruleid: vuln-workbench.python.template-xss
    Markup(value)
    # ruleid: vuln-workbench.python.template-xss
    return Markup(value)


def unsafe_io(value):
    # ruleid: vuln-workbench.python.ssrf-requests
    requests.get(value)
    # ruleid: vuln-workbench.python.ssrf-requests
    requests.post(value)
    # ruleid: vuln-workbench.python.path-traversal-open
    open(value)
    # ruleid: vuln-workbench.python.path-traversal-open
    open(value, "rb")
    # ruleid: vuln-workbench.python.unsafe-pickle
    pickle.loads(value)
    # ruleid: vuln-workbench.python.unsafe-pickle
    pickle.load(value)
    # ruleid: vuln-workbench.python.weak-hash
    hashlib.md5()
    # ruleid: vuln-workbench.python.weak-hash
    hashlib.sha1()
    # ruleid: vuln-workbench.python.weak-random
    random.random()
    # ruleid: vuln-workbench.python.weak-random
    return random.randint(1, 10)


def fixed(cursor):
    # ok: vuln-workbench.python.command-injection
    subprocess.run(["/usr/bin/id", "-u"], shell=False)
    # ok: vuln-workbench.python.command-injection
    subprocess.run(["/usr/bin/date"])
    # ok: vuln-workbench.python.sql-injection
    cursor.execute("SELECT * FROM users WHERE id = ?", (1,))
    # ok: vuln-workbench.python.sql-injection
    cursor.execute("SELECT 1")
    # ok: vuln-workbench.python.template-xss
    return "<b>safe</b>"
    # ok: vuln-workbench.python.template-xss
    safe = "plain text"
    # ok: vuln-workbench.python.ssrf-requests
    requests.get("https://example.invalid/health")
    # ok: vuln-workbench.python.ssrf-requests
    requests.post("/api/jobs")
    # ok: vuln-workbench.python.path-traversal-open
    open("settings.json")
    # ok: vuln-workbench.python.path-traversal-open
    open("settings.json", "rb")
    # ok: vuln-workbench.python.unsafe-pickle
    import json
    json.loads("{}")
    # ok: vuln-workbench.python.unsafe-pickle
    json.load(open("settings.json"))
    # ok: vuln-workbench.python.weak-hash
    hashlib.sha256()
    # ok: vuln-workbench.python.weak-hash
    hashlib.sha512()
    # ok: vuln-workbench.python.weak-random
    import secrets
    secrets.token_urlsafe(32)
    # ok: vuln-workbench.python.weak-random
    secrets.randbelow(10)
