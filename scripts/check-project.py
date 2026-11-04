#!/usr/bin/env python3
"""Portable publication checks: human-sized source, no secrets or device history."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE = {".swift", ".java", ".mjs", ".py", ".sh"}
SKIP = {
    ".git",
    "node_modules",
    ".gradle",
    "__pycache__",
    "build",
    "build-device",
    "build-test",
    "dist",
}
BANNED_SUFFIX = {
    ".p12",
    ".p8",
    ".jks",
    ".keystore",
    ".mobileprovision",
    ".sqlite",
    ".db",
    ".ipa",
    ".apk",
    ".zip",
}
# Fixtures use explicit synthetic values. These patterns detect actual credential containers.
PATTERNS = [
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    r'oauth_token\s*=\s*[\'"][^\'"]+',
    r"AKIA[0-9A-Z]{16}",
    r"gh[pousr]_[A-Za-z0-9]{30,}",
    r"/Users/[a-zA-Z0-9_.-]+/",
]
errors = []
count = 0
for path in ROOT.rglob("*"):
    parts = path.relative_to(ROOT).parts
    if not path.is_file() or any(p in SKIP or p.startswith("build-") for p in parts):
        continue
    if "server/public/downloads" in path.as_posix() or path.suffix in BANNED_SUFFIX:
        continue  # Local build/download products; tracked products are checked below.
    if path.suffix in CODE:
        count += 1
        lines = path.read_text().splitlines()
        if len(lines) > 500:
            errors.append(
                f"{path.relative_to(ROOT)}: {len(lines)} lines; split by responsibility"
            )
    if path.suffix in CODE | {
        ".md",
        ".json",
        ".yml",
        ".yaml",
        ".xml",
        ".gradle",
        ".properties",
    }:
        text = path.read_text()
        for pattern in PATTERNS:
            if re.search(pattern, text):
                errors.append(
                    f"{path.relative_to(ROOT)}: private data pattern detected"
                )
        if path.suffix == ".md" and "/downloads/" not in str(path):
            for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", text):
                if (
                    "://" not in target
                    and not target.startswith("mailto:")
                    and not (path.parent / target).exists()
                ):
                    errors.append(
                        f"{path.relative_to(ROOT)}: missing link target {target}"
                    )
result = subprocess.run(
    ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
)
for name in result.stdout.decode().split("\0"):
    if not name:
        continue
    p = Path(name)
    if p.suffix in BANNED_SUFFIX or p.name == ".env" or "/secrets/" in "/" + name:
        errors.append(name + ": private/generated artifact is tracked")
for required in [
    "LICENSE",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
]:
    if not (ROOT / required).exists():
        errors.append("Missing " + required)
if errors:
    sys.exit("\n".join(errors))
print(f"Publication checks passed; {count} source files, each <=500 lines")
