# AquaSight / Ya Xian Zhi

T1: event model + classify heuristics (no network).

## Local

```bash
npm test
```

Requires Node 20+.

## Config

Copy `.env.example` to `.env`. Put `BARK_KEY` only in env or GitHub Secret. Do not commit it.

## Classify (T1)

- `breaking`: hot-search rank<=3; or hot-search rank<=10 and title hits a strong event word; or a tech source title hits both a lab word and a strong event word; or the same title appears in both the hot-search family and the tech family.
- otherwise `normal`.

Schema: `schema/events.schema.json`. Example: `schema/events.example.json`.
