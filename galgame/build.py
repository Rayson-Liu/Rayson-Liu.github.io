#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build script: assemble src/ template + js modules + story.json into single index.html"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
JS = SRC / "js"
OUT = ROOT / "index.html"
MODELS_DIR = ROOT / "models"

MODEL_MAP = {"girl": "yui", "main-boy": "you", "npcboy": "saku"}


def build_models():
    """Convert src/models/*.vrm|glb into models/<role>.js base64 scripts (file:// compatible)."""
    src_dir = SRC / "models"
    tags = []
    if not src_dir.exists():
        return tags
    MODELS_DIR.mkdir(exist_ok=True)
    for src_name, role in MODEL_MAP.items():
        f = src_dir / (src_name + ".glb")
        if not f.exists():
            f = src_dir / (src_name + ".vrm")
        if not f.exists():
            print(f"model {src_name} missing, fallback for role {role}")
            continue
        b64 = base64.b64encode(f.read_bytes()).decode("ascii")
        out = MODELS_DIR / (role + ".js")
        out.write_text(
            'window.__MODEL_B64__ = window.__MODEL_B64__ || {};\n'
            'window.__MODEL_B64__["' + role + '"] = "' + b64 + '";\n',
            encoding="utf-8",
        )
        print(f"model {f.name} -> {out.name} ({len(b64) / 1048576:.1f} MB b64)")
        tags.append(f'<script src="models/{role}.js"></script>')
    return tags


def load_story():
    with open(ROOT / "story.json", encoding="utf-8") as f:
        return json.load(f)


def check_cond(expr):
    base = {"yui", "trust", "courage", "true", "false", "f"}
    tok = re.findall(r"[A-Za-z_]\w*|&&|\|\||>=|<=|==|!=|[!().><]|\d+", expr)
    prev_dot = False
    for t in tok:
        if t in {"&&", "||", "!", "(", ")", ">=", "<=", "==", "!=", ">", "<", "."}:
            prev_dot = t == "."
            continue
        if t.isdigit():
            prev_dot = False
            continue
        if t in base or prev_dot:
            prev_dot = False
            continue
        return f"token '{t}' not allowed"
    return None


def validate(story):
    errors = []
    nodes = story.get("nodes", {})
    locs = story.get("locs", {})
    hotspots = story.get("hotspots", {})
    chapter_ids = [c["id"] for c in story["meta"]["chapters"]]
    valid_locs = set(locs.keys())
    valid_chars = set(story.get("chars", {}).keys())

    for nid, n in nodes.items():
        if not isinstance(n, dict):
            errors.append(f"node {nid}: not an object")
            continue
        if "text" not in n and "if" not in n and "ending" not in n:
            errors.append(f"node {nid}: missing text")
            continue
        if n.get("loc") and n["loc"] not in valid_locs:
            errors.append(f"node {nid}: unknown loc {n['loc']}")
        if "speaker" in n and n["speaker"] not in valid_chars:
            errors.append(f"node {nid}: unknown speaker {n['speaker']}")
        if n.get("chap") and n["chap"] not in chapter_ids:
            errors.append(f"node {nid}: unknown chap {n['chap']}")
        if n.get("if"):
            m = check_cond(n["if"])
            if m:
                errors.append(f"node {nid}: bad condition {n['if']} ({m})")
        if n.get("next") and n["next"] not in nodes:
            errors.append(f"node {nid}: next -> {n['next']} missing")
        if n.get("yes") and n["yes"] not in nodes:
            errors.append(f"node {nid}: yes -> {n['yes']} missing")
        if n.get("no") and n["no"] not in nodes:
            errors.append(f"node {nid}: no -> {n['no']} missing")
        for i, c in enumerate(n.get("choices", [])):
            if "next" not in c or c["next"] not in nodes:
                errors.append(f"node {nid} choice {i}: bad next")
            if "t" not in c:
                errors.append(f"node {nid} choice {i}: missing text")
    for nid, n in nodes.items():
        if set(n.keys()) == set() and "text" not in n:
            errors.append(f"node {nid}: empty")
    for hid, h in hotspots.items():
        if h["loc"] not in valid_locs:
            errors.append(f"hotspot {hid}: unknown loc {h['loc']}")
        if h["story"] not in nodes:
            errors.append(f"hotspot {hid}: story {h['story']} missing")
        for c in h.get("chaps", []):
            if c not in chapter_ids:
                errors.append(f"hotspot {hid}: bad chap {c}")
    if story["meta"]["start"] not in nodes:
        errors.append(f"start node {story['meta']['start']} missing")
    return errors


def escape_json(o):
    return json.dumps(o, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")


def main():
    story = load_story()
    errs = validate(story)
    if errs:
        print("STORY VALIDATION FAILED:")
        for e in errs[:40]:
            print(" -", e)
        sys.exit(1)
    print(f"story OK: {len(story['nodes'])} nodes, {len(story['hotspots'])} hotspots, {len(story['chars'])} chars")

    template = (SRC / "template.html").read_text(encoding="utf-8")
    model_tags = build_models()
    if model_tags:
        template = template.replace("<!--__MODELS__-->", "\n  ".join(model_tags))
    js_files = sorted(JS.glob("*.js"))
    parts = []
    for jf in js_files:
        parts.append(f"/* ==== {jf.name} ==== */")
        parts.append(jf.read_text(encoding="utf-8"))
    bundle = "\n".join(parts).replace(
        "const STORY = __STORY__;",
        "const STORY = " + escape_json(story) + ";"
    )
    if "const STORY =" not in bundle:
        print("ERROR: story placeholder not found in bundle")
        sys.exit(1)
    index_html = template.replace("/*__BUNDLE__*/", bundle)
    if "/*__BUNDLE__*/" in index_html:
        print("ERROR: bundle placeholder not replaced")
        sys.exit(1)
    OUT.write_text(index_html, encoding="utf-8")
    print(f"built {OUT} ({len(index_html) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()