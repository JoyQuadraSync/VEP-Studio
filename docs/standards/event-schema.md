# VEP Enterprise Event Schema

## Purpose

The VEP Enterprise Event Schema defines the standard structure used by all events inside the Voluvia Enterprise Platform.

All systems, workflows, AI agents, and external integrations must use this format when publishing events to the Enterprise Event Bus.

---

## Event Structure

Every event must contain the following top-level fields:

```json
{
  "event_id": "evt_01JXYZ123456789",
  "event_type": "customer.comment.created",
  "event_version": "1.0",
  "source": "tiktok_shop",
  "priority": "medium",
  "occurred_at": "2026-07-29T20:30:00.000Z",
  "correlation_id": "cor_01JXYZ123456789",
  "causation_id": null,
  "customer_id": "cus_123456",
  "payload": {}
}
