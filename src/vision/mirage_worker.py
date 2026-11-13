#!/usr/bin/env python3
"""Persistent Cactus Mirage bridge for the HeLa Cytosol MCP server."""

import base64
import binascii
import json
import os
import sys


MAX_IMAGE_BYTES = max(1024, int(os.environ.get("HELA_CYTOSOL_MIRAGE_MAX_IMAGE_BYTES", 12 * 1024 * 1024)))


def emit(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


try:
    import cactus
except Exception as error:
    emit({"type": "startup_error", "error": f"Unable to import cactus-compute[vision]: {error}"})
    raise SystemExit(1)


emit({"type": "ready"})
vision = None


def get_vision():
    global vision
    if vision is None:
        weights = os.environ.get("CACTUS_MIRAGE_WEIGHTS")
        vision = cactus.Mirage(weights=weights) if weights else cactus.Mirage()
    return vision


def describe(request, image):
    options = {}
    mapping = {
        "sections": "sections",
        "fields": "fields",
        "language": "language",
        "maskFormat": "mask_format",
        "conf": "conf",
        "textConf": "text_conf",
        "maxObjects": "max_objects",
        "maxTextLines": "max_text_lines",
        "maxTokens": "max_tokens",
    }
    for source, target in mapping.items():
        if request.get(source) is not None:
            options[target] = request[source]
    return get_vision().describe(image, **options)


def extract(request, image):
    schema = request.get("schema")
    if not isinstance(schema, dict) or not schema:
        raise ValueError("Mirage extract requires a non-empty schema object")
    return get_vision().extract(image, schema)


for line in sys.stdin:
    try:
        request = json.loads(line)
        raw = base64.b64decode(request.get("image", ""), validate=True)
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Invalid or oversized image payload")
        operation = request.get("operation", "describe")
        if operation == "describe":
            result = describe(request, raw)
        elif operation == "extract":
            result = extract(request, raw)
        else:
            raise ValueError(f"Unsupported Mirage operation: {operation}")
        emit({"type": "response", "id": request.get("id"), "ok": True, "result": result})
    except (ValueError, binascii.Error, json.JSONDecodeError) as error:
        emit({"type": "response", "id": locals().get("request", {}).get("id"), "ok": False, "error": str(error)})
    except Exception as error:
        emit({"type": "response", "id": locals().get("request", {}).get("id"), "ok": False, "error": f"{type(error).__name__}: {error}"})
