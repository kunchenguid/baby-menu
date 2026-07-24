#!/usr/bin/env python3
"""Validate the effective entitlements emitted by macOS codesign."""

import argparse
import plistlib
from pathlib import Path

ALLOWED_ENTITLEMENTS = {"com.apple.security.cs.allow-jit"}
JIT_ENTITLEMENT = "com.apple.security.cs.allow-jit"


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("entitlements_path")
    parser.add_argument("code_object")
    parser.add_argument("--architecture", default="")
    parser.add_argument("--require-jit", action="store_true")
    args = parser.parse_args()

    architecture = args.architecture or "default architecture"
    subject = f"{args.code_object} ({architecture})"
    try:
        data = Path(args.entitlements_path).read_bytes()
    except OSError as error:
        fail(f"Could not read entitlements for {subject}: {error}")

    if data == b"":
        # codesign exits successfully and writes no bytes when a code object has
        # no effective entitlements. Electron frameworks use this exact shape.
        entitlements: object = {}
    else:
        try:
            entitlements = plistlib.loads(data)
        except Exception as error:
            fail(f"Malformed entitlements for {subject}: {error}")

    if not isinstance(entitlements, dict) or any(
        not isinstance(key, str) for key in entitlements
    ):
        fail(f"Invalid entitlements for {subject}: expected a string-keyed dictionary")

    unexpected = sorted(set(entitlements) - ALLOWED_ENTITLEMENTS)
    if unexpected:
        fail(f"Unexpected entitlements for {subject}: {', '.join(unexpected)}")

    if JIT_ENTITLEMENT in entitlements and entitlements[JIT_ENTITLEMENT] is not True:
        fail(f"{JIT_ENTITLEMENT} must be true for {subject}")

    if args.require_jit and entitlements.get(JIT_ENTITLEMENT) is not True:
        fail(f"Missing required {JIT_ENTITLEMENT} entitlement for {subject}")


if __name__ == "__main__":
    main()
