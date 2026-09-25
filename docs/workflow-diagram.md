# Workflow diagrams

## System overview
```mermaid
flowchart LR
  subgraph Inputs
    LP[Landing page / forms] -->|X-Eki-Webhook-Secret| W03[03 Lead capture]
    LP --> W04[04 Waitlist]
    BE[Backend / admin tooling] --> W07[07 Referral]
    BE --> W18[18 Content multiplication]
    BE --> W21[21 Social proof]
    SV[Survey tool] --> W08B[08B Feedback webhook]
    MC[ManyChat] -->|External Request| W17[17 Comment funnel]
    WA[WhatsApp user] -->|X-Hub-Signature-256| W13[13 WhatsApp funnel]
    TG[Team on Telegram] -->|secret token| W02[02 Approval]
  end
  subgraph Data
    S[(Google Sheet: Leads, Waitlist, Referrals, ...)]
  end
  W03 --> S
  W04 --> S
  W07 --> S
  W08B --> S
  W17 --> S
  W13 --> S
  subgraph Schedules[Africa/Lagos]
    W05[05 Welcome 09:00] --- W06[06 Re-engage 10:00] --- W19[19 Nurture 08:00]
    W01[01 Content 09:00] --- W10[10 Scheduler 2h] --- W12[12 Autopilot 09:00]
    W14[14 Controller 08:00] --- W09[09 Weekly Mon 09:00] --- W22[22 Analyst Mon 09:30]
    W15[15 Trends 6h] --- W16[16 Pain 06:00] --- W20[20 A/B 72h]
  end
  S --> W05
  S --> W06
  S --> W19
  W05 & W06 & W19 -->|approved TEMPLATES only| CLOUD[WhatsApp Cloud API]
  W13 -->|session replies within 24h| CLOUD
  W00[00 Global error handler] -.->|any workflow error| T[Telegram team chat]
```

## Lead lifecycle (Leads.status)
```mermaid
stateDiagram-v2
  [*] --> new: form / lead-capture
  new --> nurturing: 05 sent D1-D3
  [*] --> lead_captured: 13 BUYER / VENDOR
  lead_captured --> nurturing: 19 last step
  nurturing --> churned: 06 step 3 (21 days silent)
  churned --> nurturing: lead writes again (13)
  new --> unsubscribed: STOP
  lead_captured --> unsubscribed: STOP
  nurturing --> unsubscribed: STOP
  unsubscribed --> new: START
  new --> converted: set by a human
  converted --> [*]
```

## WhatsApp signature check (workflow 13, POST)
```mermaid
flowchart TD
  A[Meta POST /whatsapp-webhook + X-Hub-Signature-256] --> B[Webhook keeps RAW body]
  B --> C[Extract raw bytes -> string]
  C --> D[HMAC-SHA256 with WHATSAPP_APP_SECRET]
  D --> E{constant-time compare\nsha256=hex}
  E -- no / secret unset --> F[401, nothing processed]
  E -- yes --> G[ACK 200] --> H[Parse -> read lead -> STOP / START / router]
  H --> I{send reply?}
  I -- yes --> J[Send session reply -> record result]
  I -- no --> K
  J --> K[Upsert lead -> log conversation -> high-intent alert]
```

## Bulk sender pattern (05, 06, 19, 08A, 12-Buffer)
```mermaid
flowchart LR
  R[Read sheet] --> S[Select eligible + build payload]
  S --> I{send?}
  I -- config missing --> A[ONE Telegram alert]
  I -- items --> L[Loop over items: 1 per iteration]
  L --> H[HTTP send - retry 3x]
  H --> C[Record result]
  C --> U[Upsert lead row]
  U --> L
  L -- done --> M[Summary to Telegram]
```
Why a loop: n8n's retry-on-fail re-runs the whole node. Without the loop, one failing lead makes every lead that already succeeded get the message again (regression-tested: 5 requests, not 9).
