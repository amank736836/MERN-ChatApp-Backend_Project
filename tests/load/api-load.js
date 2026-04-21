import http from 'k6';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users
    { duration: '1m', target: 20 },   // Stay at 20 users
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
  },
};

const BACKEND_URL = 'http://localhost:4000/api/v1';

export default function () {
  // Simulate a user searching for other users
  const searchResponse = http.get(`${BACKEND_URL}/user/search?q=test`);
  check(searchResponse, {
    'search status 200': (r) => r.status === 200,
  });

  sleep(1);

  // Simulate checking their own profile (will return 401 without token, but tests server load)
  const meResponse = http.get(`${BACKEND_URL}/user/me`);
  check(meResponse, {
    'me status 401/200': (r) => r.status === 401 || r.status === 200,
  });

  sleep(1);
}
