# Marketplace activation attribution contract

This is a proposed integration contract, not evidence that the EKI marketplace currently exposes it. Native attribution can accept lead/source data, but vendor activation remains blocked until EKI supplies the real endpoint or event schema, authentication method, field semantics, retry/idempotency rules, and permission to integrate.

## Required event

`POST /integrations/eki-marketplace/vendor-activation` (or the equivalent EKI-owned webhook) should carry:

```json
{
  "eventId": "stable-external-id",
  "vendorId": "eki-vendor-id",
  "activatedAt": "2026-10-15T12:00:00Z",
  "source": "instagram",
  "utm": { "source": "instagram", "medium": "social", "campaign": "launch", "content": "reel-1", "term": "" },
  "leadId": "optional-lead-id"
}
```

The receiver must deduplicate by `eventId`, preserve the original UTM/source values, reject malformed or unauthenticated events, and make retries safe. No production vendor-activation claim is valid until a real contract and a staging event are supplied by EKI.
