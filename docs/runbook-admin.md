# Admin actions (support)

All need the admin key and only work on the laptop (`127.0.0.1:3000`). They touch real people's
accounts, so check the request first and note why. Every action goes to the audit log.

```
K=$(grep ^ADMIN_API_KEY= .env | cut -d= -f2-)   # don't paste it into chats or tickets
curl -s -H "x-admin-key: $K" http://127.0.0.1:3000/admin/users/<username or uuid>
```

| Task | Request |
|---|---|
| Give someone a free plan (refund goodwill, creator) | `POST /admin/users/<accountId>/entitlement` `{"tier":"pro","days":30}` |
| Remove a comp | same with `{"tier":"free"}` |
| Suspend an account (abuse, chargeback fraud) | `POST /admin/users/<accountId>/ban` `{"banned":true,"reason":"..."}`. Signs them out everywhere. |
| Lift a suspension | `{"banned":false,"reason":"..."}` |
| Feature flag | `PUT /admin/flags/<key>` `{"enabled":true,"minTier":null,"rolloutPercent":10}` |
| Failed jobs | `GET /admin/jobs/failed`, then `POST /admin/jobs/<queue>/<id>/retry` |
| Rebuild money rollups after a fix | `POST /admin/rollups/backfill` `{"days":30}` |

A suspended person still has their UK GDPR rights: access (`/v1/me/export` needs a session, so
send the export by hand if asked) and erasure (run the deletion for them).

**Refunds within 14 days** (Consumer Contracts Regulations): refund in the Stripe dashboard, cancel
the subscription, and reply within 14 days. Unredeemed gift codes can be refunded the same way;
redeemed ones count as supplied.
