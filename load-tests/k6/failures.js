import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 10,
  duration: __ENV.DURATION || "20s"
};

const BASE = __ENV.BASE_URL || "http://localhost:8090";
const KEY = __ENV.API_KEY || "nplat_live_dev_demo_key_do_not_use_in_prod";

export default function () {
  const res = http.post(
    `${BASE}/v1/notifications`,
    JSON.stringify({
      userId: "user-1",
      type: "order.shipped",
      channel: "email",
      payload: {
        name: "Retry",
        orderId: String(__ITER),
        _test: { failureMode: __ITER % 4 === 0 ? "transient" : "success" }
      }
    }),
    {
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "idempotency-key": `fail-${__VU}-${__ITER}-${Date.now()}`
      }
    }
  );
  check(res, { accepted: (r) => r.status === 202 });
}
