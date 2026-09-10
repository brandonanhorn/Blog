import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// The budget object is the only hard limit on spending, so these tests are
// less about coverage and more about the handful of properties that have to
// hold: it never admits work past the ceiling, concurrency cannot slip past
// it, and anything unaccounted-for is charged rather than forgiven.

const LIMITS = { dailyNeurons: 100, dailyAsks: 10, ipPerHour: 3, ipPerDay: 5 };

// A fresh instance per test, so no test can see another's ledger.
function freshGate() {
  return env.BUDGET.getByName(crypto.randomUUID());
}

describe("reserve / settle", () => {
  it("admits a request and reports what is left", async () => {
    const gate = freshGate();
    const hold = await gate.reserve({ ip: "1.1.1.1", amount: 30, limits: LIMITS });

    expect(hold.ok).toBe(true);
    expect(hold.holdId).toBeTruthy();
    expect(hold.remaining).toBe(70);
  });

  it("charges the true cost, not the estimate", async () => {
    const gate = freshGate();
    const hold = await gate.reserve({ ip: "1.1.1.1", amount: 30, limits: LIMITS });

    await gate.settle({ holdId: hold.holdId, neurons: 12.5 });

    const status = await gate.status({ limits: LIMITS });
    expect(status.neurons).toBe(12.5);
    expect(status.held).toBe(0);
    expect(status.neuronsRemaining).toBe(87.5);
  });

  it("charges the full hold when the call reports no usage", async () => {
    const gate = freshGate();
    const hold = await gate.reserve({ ip: "1.1.1.1", amount: 30, limits: LIMITS });

    // What the Worker sends when the inference threw or returned no usage.
    await gate.settle({ holdId: hold.holdId, neurons: null });

    const status = await gate.status({ limits: LIMITS });
    expect(status.neurons).toBe(30);
  });
});

describe("the ceiling", () => {
  it("refuses once the neuron budget would be exceeded", async () => {
    const gate = freshGate();

    // 3 x 30 = 90 spent, 10 left, next 30 does not fit.
    for (let i = 0; i < 3; i += 1) {
      const hold = await gate.reserve({ ip: `10.0.0.${i}`, amount: 30, limits: LIMITS });
      expect(hold.ok).toBe(true);
      await gate.settle({ holdId: hold.holdId, neurons: 30 });
    }

    const refused = await gate.reserve({ ip: "10.0.0.9", amount: 30, limits: LIMITS });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("daily_neurons");
  });

  it("counts in-flight holds against the budget, so concurrency cannot overshoot", async () => {
    const gate = freshGate();

    // Ten simultaneous asks against a budget that fits three. Nothing is
    // settled, so the only thing standing between these and a 10x overspend is
    // that holds are counted while in flight.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        gate.reserve({ ip: `172.16.0.${i}`, amount: 30, limits: LIMITS })
      )
    );

    const admitted = results.filter((r) => r.ok);
    expect(admitted).toHaveLength(3);

    const status = await gate.status({ limits: LIMITS });
    expect(status.held).toBe(90);
    expect(status.neuronsRemaining).toBe(10);
  });

  it("refuses on the coarse ask count even when neurons are cheap", async () => {
    const gate = freshGate();
    const limits = { ...LIMITS, dailyNeurons: 100000, ipPerHour: 999, ipPerDay: 999 };

    for (let i = 0; i < limits.dailyAsks; i += 1) {
      const hold = await gate.reserve({ ip: "1.1.1.1", amount: 0.001, limits });
      expect(hold.ok).toBe(true);
      await gate.settle({ holdId: hold.holdId, neurons: 0.001 });
    }

    const refused = await gate.reserve({ ip: "1.1.1.1", amount: 0.001, limits });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("daily_asks");
  });
});

describe("per-IP limits", () => {
  it("stops one address after its hourly allowance", async () => {
    const gate = freshGate();

    for (let i = 0; i < LIMITS.ipPerHour; i += 1) {
      const hold = await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });
      expect(hold.ok).toBe(true);
      await gate.settle({ holdId: hold.holdId, neurons: 1 });
    }

    const refused = await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("ip_hour");
  });

  it("does not penalise a different visitor", async () => {
    const gate = freshGate();

    for (let i = 0; i < LIMITS.ipPerHour; i += 1) {
      const hold = await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });
      await gate.settle({ holdId: hold.holdId, neurons: 1 });
    }

    const other = await gate.reserve({ ip: "203.0.113.6", amount: 1, limits: LIMITS });
    expect(other.ok).toBe(true);
  });

  it("records refusals for later inspection", async () => {
    const gate = freshGate();

    for (let i = 0; i < LIMITS.ipPerHour; i += 1) {
      const hold = await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });
      await gate.settle({ holdId: hold.holdId, neurons: 1 });
    }
    await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });
    await gate.reserve({ ip: "203.0.113.5", amount: 1, limits: LIMITS });

    const status = await gate.status({ limits: LIMITS });
    expect(status.refusals).toBe(2);
    // A refused request costs nothing.
    expect(status.neurons).toBe(3);
  });
});

describe("abandoned holds", () => {
  it("settling an unknown hold does not credit the ledger", async () => {
    const gate = freshGate();
    const hold = await gate.reserve({ ip: "1.1.1.1", amount: 30, limits: LIMITS });
    await gate.settle({ holdId: hold.holdId, neurons: 10 });

    // A retry, a duplicate waitUntil, a replayed request.
    const again = await gate.settle({ holdId: hold.holdId, neurons: 10 });

    expect(again.ok).toBe(false);
    expect(again.reason).toBe("hold_expired");

    const status = await gate.status({ limits: LIMITS });
    expect(status.neurons).toBe(10);
  });
});
