# docker-counter-app

A small counter API built to learn Docker, Redis, and Nginx **as isolated concepts, then combined** — before revisiting my production project ([`lnk`](#)) with actual understanding of every moving part.

## Stack
- Node.js + Express — simple counter API (`/increment`, `/count`)
- Redis — shared, atomic counter storage across replicas
- Nginx — reverse proxy + load balancing across 3 app replicas
- Docker Compose — orchestrates all services

## Architecture

```
Client → Nginx (:80, round robin) → counter-app (x3 replicas) → Redis (shared state)
```

## Run it

```bash
docker-compose up -d --build
```

Then hit:
```
http://localhost/increment
http://localhost/count
```

## Why this exists

Built incrementally in isolated phases — Docker alone (images, layers, volumes, networking) → Redis alone (persistence, atomic ops) → Nginx alone (reverse proxy, load balancing) → combined. Full concept-level notes (the "why" behind each decision) are in [`docker-redis-nginx-notes.md`](./docker-redis-nginx-notes.md).