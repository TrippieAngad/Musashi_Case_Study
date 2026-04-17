# Backend API (Supabase)

## Start server

```bash
pnpm run api:start
```

Server default URL: `http://localhost:8787`

Set these in `.env`:

```env
SUPABASE_URL= "https://qozuuqzhknufcekwzxwa.supabase.co"
SUPABASE_SERVICE_ROLE_KEY=...
API_PORT=8787
BACKEND_API_KEY=optional-secret-key
```

If `BACKEND_API_KEY` is set, send it in header `x-api-key`.

## Endpoints

### Health

```bash
curl http://localhost:8787/health
```

### Upsert user account

```bash
curl -X POST http://localhost:8787/api/user-accounts/upsert \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_BACKEND_API_KEY" \
  -d '{
    "email": "user@example.com",
    "role": "user",
    "subscription_status": "trial"
  }'
```

### Insert plugin usage log

```bash
curl -X POST http://localhost:8787/api/plugin-usage/log \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_BACKEND_API_KEY" \
  -d '{
    "user_id": "UUID_FROM_USER_ACCOUNTS",
    "extension_version": "1.0.0",
    "device_id": "macbook-pro",
    "event_type": "usage",
    "is_active": true,
    "metadata": {"source": "extension"}
  }'
```

### Upsert order/subscription

```bash
curl -X POST http://localhost:8787/api/orders-subscriptions/upsert \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_BACKEND_API_KEY" \
  -d '{
    "user_id": "UUID_FROM_USER_ACCOUNTS",
    "amount_usd": 9.99,
    "payment_method": "card",
    "subscription_status": "active",
    "expires_at": "2026-12-31T00:00:00.000Z"
  }'
```

To update an existing order, include `id` in payload.
