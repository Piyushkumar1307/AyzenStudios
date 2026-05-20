#!/usr/bin/env python3
import os
import re
import sys

STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
issues = []
for name in sorted(os.listdir(STATIC)):
    if not name.endswith(".html"):
        continue
    path = os.path.join(STATIC, name)
    t = open(path, encoding="utf-8").read()
    if "runtime-config.js" not in t:
        issues.append(f"{name}: missing spooky scripts")
    for m in re.finditer(r'(?:await\s+)?fetch\s*\(\s*["`](/api/)', t):
        before = t[max(0, m.start() - 12) : m.start()]
        if "apiUrl" not in before:
            issues.append(f"{name}: unwrapped fetch near: {t[m.start() : m.start() + 50]!r}")

if issues:
    for i in issues:
        print(i)
    sys.exit(1)
print("All HTML API fetches use apiUrl()")
