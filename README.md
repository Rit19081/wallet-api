# One-line summary

A Node.js + Express backend for **pTran** that stores user transactions in a Neon (Postgres) database, protects the API with an Upstash Redis sliding-window rate limiter, exposes endpoints for CRUD and a financial summary, and runs a scheduled cron GET request in production.

---

# File-by-file breakdown

### `server.js`

**Role:** central configuration.
**What it does**

* Loads environment variables (`dotenv`).
* Starts the cron job in production (`if (process.env.NODE_ENV === "production") job.start()`).
* Applies global middleware:

  * `rateLimiter` (rate limiting)
  * `express.json()` (body parser)
  * `cors()` (enable cross-origin requests)
* Registers routes:

  * Health check: `GET /api/health`
  * Transactions API: mounted at `/api/transactions`
* Initializes DB (`initDB()`) before calling `app.listen()`.

**Interview talking points**

* `initDB()` ensures the `transactions` table exists before the server begins listening.
* `cors()` is used so your React/Expo frontends can call the API from the browser/mobile app.
* Starting cron only in production avoids accidental scheduled calls during development.

---

### `routes/transactionsRoute.js`

**Role:** defines transaction-related endpoints.
**Routes declared**

* `GET /api/transactions/:userId` → `getTransactionsByUserId`
* `POST /api/transactions` → `createTransaction`
* `DELETE /api/transactions/:id` → `deleteTransaction`
* `GET /api/transactions/summary/:userId` → `getSummaryByUserID`

---

### `middleware/rateLimiter.js`

**Role:** middleware wrapper for Upstash ratelimit.
**What it does**

* Calls `ratelimit.limit("my-rate-limit")` and blocks with HTTP 429 if `success` is false.
* On error logs and passes error to next middleware.

**Important observations & suggestion**

* You’re currently passing a fixed key string (`"my-rate-limit"`). That means the limit is shared globally across all clients — once 100 requests in 60s happen, everyone is blocked. In production you typically want per-client limits: pass a dynamic key like `req.ip` or an authenticated `userId` (e.g., `ratelimit.limit(req.ip)` or `ratelimit.limit(userId)`).
* Also mention how the sliding window is configured in `config/upstash.js`.

---

### `controllers/transactionsController.js`

**Role:** handlers for CRUD and summary logic. Uses Neon SQL tagged templates (\`sql\`\`) which parameterize queries.

**Endpoints behaviour**

* `getTransactionsByUserId(req, res)` — returns all transactions for a user ordered by `created_at` desc.
* `createTransaction(req, res)` — inserts a new transaction (`title, amount, category, user_id`) and returns the created row.

  * Validates presence of fields; returns 400 when missing.
* `deleteTransaction(req, res)` — deletes by `id`, validates `id` is a number and returns 404 when not found.
* `getSummaryByUserID(req, res)` — returns:

  ```json
  {
    "balance": <sum of all amounts>,
    "income": <sum of positive amounts>,
    "expenses": <sum of negative amounts>
  }
  ```

**Important details & suggestions**

* SQL usage via Neon tagged template is safe from SQL injection (parameters are bound).
* `created_at` uses `DATE` — it stores only date, not time. If you want full timestamps, prefer `TIMESTAMP WITH TIME ZONE` or `timestamptz`.
* `expenses` is `SUM(amount)` where amounts are negative — that means `expenses` will be negative (e.g., `-120.00`). If you want display-friendly positive totals for expenses, show `Math.abs(expenses)` or change query to `SUM(ABS(amount)) FILTER (WHERE amount < 0)`.
* Potential addition: pagination and a `LIMIT/OFFSET` or cursor-based paging on `getTransactionsByUserId` to avoid returning huge result sets.

---

### `config/cron.js`

**Role:** scheduled job that sends a GET to `process.env.API_URL` every 14 minutes.
**What it does**

* Uses `cron.CronJob("*/14 * * * *", ...)` and an `https.get(...)`.
* Logs success/failure and errors.

**Talking points**

* `*/14 * * * *` runs at minute 0,14,28,42,56 every hour (i.e., every 14 minutes).
* Only runs in production as `server.js` only starts it when `NODE_ENV === "production"`.
* Good to note: for reliability in distributed/multi-instance setups you may want a centralized scheduler (e.g., hosted cron, serverless Cron, or a single leader instance) to avoid duplicate calls.

---

### `config/db.js`

**Role:** Neon (serverless Postgres) connection and DB initialization.
**What it does**

* Exposes `sql` (Neon client).
* `initDB()` runs `CREATE TABLE IF NOT EXISTS transactions (...)` with these columns:

  * `id SERIAL PRIMARY KEY`
  * `user_id VARCHAR(255) NOT NULL`
  * `title VARCHAR(255) NOT NULL`
  * `amount DECIMAL(10, 2) NOT NULL`
  * `category VARCHAR(255) NOT NULL`
  * `created_at DATE NOT NULL DEFAULT CURRENT_DATE`

**Notes and suggestions**

* `SERIAL` is fine; on Postgres 10+ an identity column or migrations tool can be recommended for production.
* Consider `created_at TIMESTAMPTZ DEFAULT now()` if you need precise ordering/time info.
* Add an index on `user_id` for faster lookups: `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);`
* For larger apps use a migration tool (e.g., Flyway, Knex, Liquibase, or Prisma migrations) instead of `CREATE TABLE IF NOT EXISTS` at runtime.

---

### `config/upstash.js`

**Role:** creates an Upstash Redis client and the Upstash Ratelimit instance.
**What it does**

* `Redis.fromEnv()` reads connection info from env.
* `new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(100, '60 s') })` sets the policy.

**Notes**

* Sliding window of 100 requests / 60 seconds is configured here.
* Make sure the expected environment variables for Upstash are present (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` or whichever `fromEnv()` expects).
* Again: use a per-client key when calling `ratelimit.limit(key)`.

---

# Endpoints — quick reference & example requests

* `GET /api/health`
  Response: `200 { "status": "ok" }`

* `GET /api/transactions/summary/:userId`
  Returns `{ balance, income, expenses }` where `expenses` currently is sum of negative amounts.

* `GET /api/transactions/:userId`
  Returns array of transaction rows sorted by `created_at` desc.

* `POST /api/transactions`
  Body JSON: `{ "title": "Groceries", "amount": -120.50, "category": "Food", "user_id": "abc" }`
  Response: `201` created transaction row.

* `DELETE /api/transactions/:id`
  Response: `200 { message: "Transaction deleted successfully" }` or `404` if id not found.

**cURL example (create)**:

```bash
curl -X POST https://api.example.com/api/transactions \
  -H "Content-Type: application/json" \
  -d '{"title":"Salary","amount":2000,"category":"Income","user_id":"user-123"}'
```

---

# Tools & why they’re used — short explanations you can say in interview

* **Node.js + Express** — lightweight HTTP server and routing for your REST API.
* **Neon (serverless Postgres)** — managed Postgres for persisting transactions; provides SQL via `neon` tagged template for safe parameter binding.
* **Upstash Redis + `@upstash/ratelimit`** — external managed Redis for storing request counters and enforcing rate limits (sliding-window). Helps protect endpoints from abuse/bots.
* **cron (`cron` package)** — schedules periodic tasks, here used to make a GET request every 14 minutes.
* **dotenv** — environment variable management for secrets and config.
* **cors** — allows your web/mobile frontends to access the API securely.
* **Cloudinary / Clerk (frontend)** — you mentioned Clerk for auth and Cloudinary for media in other parts of the project: Clerk is used for authentication/SSO on the client; Cloudinary stores images. (Note: backend currently does not validate Clerk token — see security notes below.)

---

# Security, correctness & production-readiness notes (good to mention)

* **Authentication:** Your routes accept `userId` via params/body but do not validate an auth token. In production you should:

  * Verify Clerk session tokens in backend (or use Clerk middleware) and use the authenticated user id server-side, not rely on client-supplied `user_id`.
* **Rate limiting key:** Use `req.ip` or authenticated user id as the ratelimit key instead of a global static string to enforce per-client limits.
* **Input validation:** Add stronger validation (e.g., Joi/Zod) for `title` length, numeric range for `amount`, and allowed `category` values.
* **Audit & logging:** Add structured logging (winston/pino) and error monitoring (Sentry) for observability.
* **Pagination:** Add pagination for `GET /:userId` to avoid returning thousands of rows at once.
* **Migrations:** Move DB schema management to a migration tool and remove `CREATE TABLE IF NOT EXISTS` from runtime.
* **Timestamps:** Use `TIMESTAMPTZ` for `created_at` if you need precise ordering with time zones.
* **Testing:** Add integration tests (supertest + jest) for critical endpoints and unit tests for controller logic.

---

# Small nitpicks / quick fixes you can mention in interview

* **Route order bug:** Put `router.get("/summary/:userId", ...)` before `router.get("/:userId", ...)`.
* **Expenses sign:** If you want positive expense totals: return `ABS(expenses)` or `-SUM(amount)` for `amount < 0`.
* **Rate-limit key:** change `ratelimit.limit("my-rate-limit")` → `ratelimit.limit(req.ip)` (or `ratelimit.limit(userId)` when authenticated).

---

# Suggested one-minute elevator pitch (say this in the interview)

“I built a Node/Express backend for pTran that persists transactions in a serverless Postgres (Neon), enforces API rate limits via Upstash Redis, and exposes simple CRUD endpoints plus a financial summary (income, expenses, net balance). I also added a production cron that calls an external URL on a schedule. Key design choices include parameterized Neon SQL queries to prevent injection, a sliding-window rate limiter for burst protection, and an init step that ensures the transactions table exists before the server starts. For production I’d add token verification with Clerk, per-user rate keys, pagination, and DB migrations.”

---
