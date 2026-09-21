#!/usr/bin/env python3
"""Trim data/events.json into the Worker ingest payload.

Lives as a file on purpose: this logic once sat in a Python heredoc inside
collect.yml, and the unindented heredoc body broke YAML parsing, which
silently killed the scheduled collect runs for days.
"""

import json


def main():
    d = json.load(open("data/events.json"))
    items = d.get("items") or d.get("events") or []
    if isinstance(items, dict):
        items = items.get("items") or []
    wanted = set()
    for it in items:
        for aid in (it.get("articleIds") or it.get("memberIds") or []):
            if aid:
                wanted.add(aid)
    arts = [a for a in (d.get("articles") or []) if a and a.get("id") in wanted]
    out = {
        k: d[k]
        for k in (
            "apiVersion",
            "updatedAt",
            "snapshotAt",
            "items",
            "featured",
            "sourceErrors",
            "sourceHealth",
            "budget",
            "digest",
        )
        if k in d
    }
    out["items"] = items
    out["articles"] = arts
    json.dump(
        out,
        open("data/ingest-events.json", "w"),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    print("ingest payload events", len(items), "articles", len(arts))


if __name__ == "__main__":
    main()
