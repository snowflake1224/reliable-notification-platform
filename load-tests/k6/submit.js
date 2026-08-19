import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const acceptTrend = new Trend("nplat_accept_ms");
const failRate = new Rate("nplat_accept_fail");

export const options = {
  scenarios: {
    submit: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 20),
      timeUnit: "1s",
      duration: __ENV.DURATION || "30s",
      preAllocatedVUs: 20,
      maxVUs: 80
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<500"]
  }
};

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const KEY = __ENV.API_KEY || "nplat_live_dev_demo_key_do_not_use_in_prod";

export default function () {
  const idem = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE}/v1/notifications`,
    JSON.stringify({
      userId: "user-1",
      type: "order.shipped",
      channel: ["email", "sms", "push"][__ITER % 3],
      payload: { name: "Load", orderId: String(__ITER) }
    }),
    {
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "idempotency-key": idem
      },
      tags: { name: "submit" }
    }
  );
  acceptTrend.add(res.timings.duration);
  failRate.add(res.status !== 202);
  check(res, { accepted: (r) => r.status === 202 });
  sleep(0.01);
}
