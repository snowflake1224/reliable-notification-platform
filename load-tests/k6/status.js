import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  iterations: 1
};

const BASE = __ENV.BASE_URL || "http://localhost:8090";
const KEY = __ENV.API_KEY || "nplat_live_dev_demo_key_do_not_use_in_prod";

export default function () {
  const list = http.get(`${BASE}/v1/notifications?limit=20`, {
    headers: { "x-api-key": KEY }
  });
  check(list, { listed: (r) => r.status === 200 });
  const queue = http.get(`${BASE}/health/ready`);
  check(queue, { ready: (r) => r.status === 200 });
}
