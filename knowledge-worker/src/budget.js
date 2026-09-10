import { DurableObject } from "cloudflare:workers";

// The spending ceiling for the knowledge endpoint.
//
// This is deliberately ONE global instance, which is normally a Durable Object
// anti-pattern. It is correct here because a shared budget is a single
// coordination atom: you cannot shard "have we spent 3,000 neurons today"
// without the shards collectively overspending. Throughput is the reason it is
// safe — the daily ask cap is 150, so this object sees a few hundred calls a
// day against a limit of 100,000.
//
// Two properties do the real work:
//
//   1. Durable Objects are single-threaded. `reserve` contains no `await`, so
//      it runs to completion before another request is admitted. Fifty
//      concurrent asks cannot all read the same "nothing spent yet" state.
//
//   2. Cost is HELD before the model call and settled after. Charging only on
//      the way back leaves a window where the ledger reads zero while N calls
//      are in flight.

const HOLD_TTL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LEDGER_RETENTION_DAYS = 30;

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export class Budget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ledger (
          day       TEXT PRIMARY KEY,
          neurons   REAL NOT NULL DEFAULT 0,
          asks      INTEGER NOT NULL DEFAULT 0,
          refusals  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS holds (
          id         TEXT PRIMARY KEY,
          day        TEXT NOT NULL,
          amount     REAL NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ip_hits (
          ip TEXT NOT NULL,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ip_hits_ip_ts ON ip_hits (ip, ts);
        CREATE INDEX IF NOT EXISTS holds_created_at ON holds (created_at);
      `);
    });
  }

  // Synchronous on purpose — see note 1 above. Do not add `await` in here.
  reserve({ ip, amount, limits }) {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const day = dayKey(now);

    this.#sweep(now);

    const hourHits = sql
      .exec("SELECT COUNT(*) AS n FROM ip_hits WHERE ip = ? AND ts >= ?", ip, now - HOUR_MS)
      .one().n;
    if (hourHits >= limits.ipPerHour) {
      return this.#refuse(day, "ip_hour");
    }

    const dayHits = sql
      .exec("SELECT COUNT(*) AS n FROM ip_hits WHERE ip = ? AND ts >= ?", ip, now - DAY_MS)
      .one().n;
    if (dayHits >= limits.ipPerDay) {
      return this.#refuse(day, "ip_day");
    }

    const spent = this.#spent(day);

    if (spent.asks >= limits.dailyAsks) {
      return this.#refuse(day, "daily_asks");
    }

    if (spent.neurons + spent.held + amount > limits.dailyNeurons) {
      return this.#refuse(day, "daily_neurons");
    }

    const holdId = crypto.randomUUID();
    sql.exec(
      "INSERT INTO holds (id, day, amount, created_at) VALUES (?, ?, ?, ?)",
      holdId,
      day,
      amount,
      now
    );
    sql.exec(
      `INSERT INTO ledger (day, neurons, asks, refusals) VALUES (?, 0, 1, 0)
       ON CONFLICT(day) DO UPDATE SET asks = asks + 1`,
      day
    );
    sql.exec("INSERT INTO ip_hits (ip, ts) VALUES (?, ?)", ip, now);

    return {
      ok: true,
      holdId,
      remaining: limits.dailyNeurons - (spent.neurons + spent.held + amount)
    };
  }

  // Replace the held estimate with what the call actually cost. Passing a
  // non-finite `neurons` (a failed call, a response without usage) charges the
  // full hold instead — an inference that died halfway may still have burned
  // tokens, and guessing high is the only guess that cannot be gamed.
  settle({ holdId, neurons }) {
    const sql = this.ctx.storage.sql;
    const hold = sql.exec("SELECT day, amount FROM holds WHERE id = ?", holdId).toArray()[0];

    if (!hold) {
      // Already swept and charged. Nothing owed.
      return { ok: false, reason: "hold_expired" };
    }

    const charge = Number.isFinite(neurons) && neurons >= 0 ? neurons : hold.amount;

    sql.exec("DELETE FROM holds WHERE id = ?", holdId);
    sql.exec(
      `INSERT INTO ledger (day, neurons, asks, refusals) VALUES (?, ?, 0, 0)
       ON CONFLICT(day) DO UPDATE SET neurons = neurons + ?`,
      hold.day,
      charge,
      charge
    );

    return { ok: true, charged: charge };
  }

  status({ limits }) {
    const now = Date.now();
    this.#sweep(now);

    const day = dayKey(now);
    const spent = this.#spent(day);

    return {
      day,
      neurons: Math.round(spent.neurons * 10) / 10,
      held: Math.round(spent.held * 10) / 10,
      asks: spent.asks,
      refusals: spent.refusals,
      neuronsRemaining:
        Math.round((limits.dailyNeurons - spent.neurons - spent.held) * 10) / 10,
      asksRemaining: Math.max(0, limits.dailyAsks - spent.asks),
      limits
    };
  }

  #spent(day) {
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec("SELECT neurons, asks, refusals FROM ledger WHERE day = ?", day)
      .toArray()[0];
    const held = sql
      .exec("SELECT COALESCE(SUM(amount), 0) AS n FROM holds WHERE day = ?", day)
      .one().n;

    return {
      neurons: row?.neurons ?? 0,
      asks: row?.asks ?? 0,
      refusals: row?.refusals ?? 0,
      held
    };
  }

  #refuse(day, reason) {
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger (day, neurons, asks, refusals) VALUES (?, 0, 0, 1)
       ON CONFLICT(day) DO UPDATE SET refusals = refusals + 1`,
      day
    );
    return { ok: false, reason };
  }

  // Expired holds are CHARGED, not released — a request that vanished between
  // reserve and settle is assumed to have spent what it asked for.
  #sweep(now) {
    const sql = this.ctx.storage.sql;

    const stale = sql
      .exec("SELECT id, day, amount FROM holds WHERE created_at < ?", now - HOLD_TTL_MS)
      .toArray();

    for (const hold of stale) {
      sql.exec(
        `INSERT INTO ledger (day, neurons, asks, refusals) VALUES (?, ?, 0, 0)
         ON CONFLICT(day) DO UPDATE SET neurons = neurons + ?`,
        hold.day,
        hold.amount,
        hold.amount
      );
      sql.exec("DELETE FROM holds WHERE id = ?", hold.id);
    }

    sql.exec("DELETE FROM ip_hits WHERE ts < ?", now - DAY_MS);
    sql.exec("DELETE FROM ledger WHERE day < ?", dayKey(now - LEDGER_RETENTION_DAYS * DAY_MS));
  }
}
