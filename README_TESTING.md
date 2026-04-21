# Backend Testing Guide

This directory contains the test suite for the MERN ChatApp Backend.

## 🚀 Running Tests
Run all backend tests (including unit, integration, and socket tests) using Vitest:

```bash
npm run test
```

For a single run (without watch mode):
```bash
npm run test -- --run
```

## 📁 Structure
- `tests/integration/`: API endpoint and flow validation.
- `tests/socket/`: Real-time WebSocket event testing.
- `tests/edge-cases/`: Failure handling and boundary testing.
- `tests/load/`: Load testing scripts (k6).
- `tests/setup/`: Database and environment configuration.

## ⚙️ Configuration
- Uses `mongodb-memory-server` for isolated database testing.
- Configured via `vitest.config.js` and `jest.config.js`.
