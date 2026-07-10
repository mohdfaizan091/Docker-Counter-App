# Docker + Redis + Nginx — Learning Notes

Built via hands-on practice: `docker-counter-app` (Express + Redis + Nginx, 3 replicas).

---

## Phase 1: Docker Fundamentals

### Image vs Container
- **Image** = read-only blueprint (like a class / an installer).
- **Container** = a running instance of an image (like an object / a running process).
- One image → many containers.

### Dockerfile — layer order matters
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "app.js"]
```
- Each instruction = a **layer**, and Docker **caches** layers.
- `package.json` is copied *before* the rest of the code because it changes rarely, while app code changes often.
- If a layer's input hasn't changed, Docker reuses the cache — skips re-running it.
- Wrong order (`COPY . .` before `npm install`) → every code change invalidates the cache → `npm install` reruns on every build, wasting time.

### Image size insight
- Base runtime (Node + OS) dominates image size, not your actual app code (few KB).
- `alpine` variants are much smaller (minimal Linux distro) — e.g., `nginx:alpine` (~93MB) vs Node-based images (~220MB).
- Multiple images sharing the same base layers **do not** duplicate disk space — Docker deduplicates identical layers across images.

### Running a container
```bash
docker run -d -p 3000:3000 --name my-counter counter-app:v1
```
- `-d` → detached (background) mode.
- `-p HOST:CONTAINER` → maps host port to container port (container's network is isolated by default).
- `--name` → human-readable name instead of a random one.

### Container lifecycle: restart vs rm
| Action | Container filesystem | In-memory (RAM) data |
|---|---|---|
| `docker restart` | Preserved | **Lost** (process restarts, RAM clears) |
| `docker rm` (delete) | **Destroyed** | Lost |

- `restart` kills and restarts the process inside the *same* container → filesystem persists, RAM resets.
- `rm` deletes the container entirely (including its writable layer) → even file-based data is gone if a new container is created from the image.

### Volumes — persistence beyond the container's life
```bash
docker run -d -p 3000:3000 -v counter-data:/app/data --name my-counter counter-app:v1
```
- Maps a folder inside the container to a Docker-managed storage location on the host.
- Even if the container is deleted (`docker rm`) and recreated, data in the volume survives — because it isn't tied to the container's writable layer.
- Find where a named volume actually lives: `docker volume inspect <name>` → check `"Mountpoint"`.

### Networking — how containers talk to each other
- By default, containers are isolated; a **custom bridge network** enables container-to-container communication.
```bash
docker network create my-app-network
docker run -d --network my-app-network --name my-counter counter-app:v1
```
- Docker runs an internal **DNS server** (`127.0.0.11`) on custom networks — it maintains a name→IP "phonebook" for every container on that network.
- A container can reach another **by name** (e.g., `http://my-counter:3000`) — Docker resolves the name to an IP automatically.
- `localhost` inside a container refers to *that same container* — never use it to reach a different container.
- The **default bridge network** does NOT have this DNS feature — always prefer custom networks.

### docker-compose — managing multi-container setups
```yaml
services:
  counter-app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - counter-data:/app/data
volumes:
  counter-data:
```
- `docker-compose up -d` builds images, creates a network, creates volumes, and starts containers — all from one file.
- Compose auto-creates a **default network** shared by all services in the file — no manual `docker network create` needed.
- Replica containers get auto-named `<project>-<service>-<n>` (e.g., `-1`, `-2`, `-3`).

---

## Phase 2: Redis

### What it is
- An **in-memory key-value store** — data lives in RAM, making it far faster than disk-based file I/O.

### Persistence
- Redis periodically snapshots its RAM state to disk (**RDB** file), and optionally logs every write (**AOF**) for near-zero data loss.
- On restart, Redis reloads its last saved state from disk — but this disk write still lives inside the container's writable layer, so **Redis also needs a volume** to survive `docker rm`.
- RDB snapshots are periodic, not instant — very recent writes can be lost if the container is deleted right after a write, before the next snapshot fires. AOF mode avoids this by logging every write immediately (at some performance cost).

### Connecting from another container
```js
const redisClient = createClient({ url: 'redis://redis:6379' });
```
- Host = the **service name** in compose (`redis`), not `localhost` — same DNS-by-name principle as Phase 1.
- Default Redis port: `6379`.
- Connection is async — always `await redisClient.connect()` before starting the server, so no request hits Redis before it's ready.

### `depends_on`
```yaml
counter-app:
  depends_on:
    - redis
```
- Guarantees **start order** only (Redis container starts first) — does **not** guarantee Redis is fully ready to accept connections. Real production setups still need error handling / retry logic in the app.

### Why Redis over a plain file
1. **Speed** — RAM access vs. disk I/O; avoids bottlenecks at high request volume.
2. **Atomicity** — `INCR` is a built-in atomic operation. Redis processes commands effectively single-threaded, so concurrent increments can't race and silently lose updates — unlike a manual "read file → +1 → write file" approach, which is vulnerable to race conditions.

### Shared state across replicas
- Multiple app containers (replicas) querying the **same** Redis instance all see the same, consistent count — because none of them store the count themselves; Redis is the single source of truth (in RAM, backed by disk for recovery).
- Without a shared store (e.g., going back to per-container files), each replica would maintain its own independent count → inconsistent results depending on which replica served a given request.

---

## Phase 3: Nginx (Reverse Proxy / Load Balancing)

### Why
- Running multiple replicas of an app needs a single entry point that distributes incoming requests across them.

### Config
```nginx
events {}

http {
    upstream counter_backend {
        server counter-app:3000;
    }

    server {
        listen 80;
        location / {
            proxy_pass http://counter_backend;
        }
    }
}
```
- `upstream` defines a named group of backend servers.
- Even though `counter-app` is written once, Docker's DNS returns **multiple IPs** for that one name when there are multiple replicas — Nginx load-balances across all of them.
- Default algorithm: **round robin** — requests are distributed cycle-by-cycle across the available IPs.

### Compose changes for multi-replica + Nginx
```yaml
services:
  counter-app:
    build: .
    depends_on: [redis]
    deploy:
      replicas: 3
    # no "ports" — only Nginx should be externally reachable

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on: [counter-app]
```
- Replicas don't get a `ports` mapping — mapping the same host port from 3 containers would conflict. Only Nginx is exposed externally.
- `:ro` on the nginx.conf volume mount = read-only, so Nginx can't modify its own config file from inside the container.

### Single point of failure
- This setup load-balances the **app**, but Nginx itself is a single container — if it goes down, the whole system is unreachable.
- Real fix: multiple Nginx instances behind a higher-level load balancer (cloud LB) or a floating-IP failover mechanism (e.g., keepalived/VRRP) — not "master-slave" (that's a database replication concept, not a proxy redundancy one).

---

## The Big Picture

| Tool | Core problem it solves |
|---|---|
| **Docker** | Portability & consistency — same environment everywhere, easy to spin up/replicate isolated units |
| **Redis** | Shared, fast, consistent state across multiple stateless app replicas |
| **Nginx** | Distributing load across replicas through a single entry point, avoiding overload on any one instance |

Together: a system that is **fast, horizontally scalable, and reliably deployable** — not just "works on my machine," but "works the same everywhere, and holds up under real load."

---

## Key Corrections From This Session
- **Race condition ≠ idempotency.** Idempotency = repeating an operation gives the same result. Race condition = concurrent operations interfering with each other's results. Redis's `INCR` prevents race conditions via atomicity, not idempotency.
- **Redis's source of truth is RAM, not disk.** Disk (RDB/AOF) is a persistence/recovery backup, not the primary store.
- **Nginx redundancy ≠ master-slave.** Master-slave is a database replication pattern. Nginx redundancy needs multiple proxy instances + a failover/load-balancing mechanism in front of them.