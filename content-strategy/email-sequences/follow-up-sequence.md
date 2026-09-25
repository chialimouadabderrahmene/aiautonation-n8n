> **DRAFT copy - not wired to any workflow.** Links use the canonical domain but the paths (`/dashboard`, `/directory`, `/login`, `/verify`, `/feedback`, `/signup`) are illustrative: replace them with real Eki routes, and verify every claim (e.g. commission offers) before sending. Never put personal data in link query strings.

# Eki Inactive User Follow-Up Sequence (3-Email Series)

These templates are triggered by the engagement workflow when a user has been inactive for 7, 14, and 21 days respectively.

---

## Email 1: Day 7 Inactive
*   **Trigger**: No dashboard activity in 7 days.
*   **Subject Options**:
    *   *Option 1*: Quick question about your Eki account, {{name}}?
    *   *Option 2*: We noticed you haven't listed/browsed yet...
*   **Preview Text**: Need help setting up your store or connecting with buyers?

### HTML Body Copy
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Outfit', Arial, sans-serif; color: #1e1e1e; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background-color: #d4af37; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>We noticed you signed up for Eki recently, but haven’t completed your setup yet. Sourcing and exporting African foodstuff can feel overwhelming, but we are here to help make it simple.</p>
    
    <p>Did you run into any issues during onboarding? Whether you're struggling to verify your business license, upload product pictures, or configure your payment details, our support team can walk you through it.</p>
    
    <p><strong>Want a quick shortcut?</strong> You can schedule a free 10-minute onboarding call with our customer success team, or log in now to chat with support.</p>
    
    <div class="button-container">
      <a href="https://culinarytales.app/dashboard?support=true" class="button" target="_blank">Chat with Support Now</a>
    </div>
    
    <p>Let's get your business moving!</p>
    <p>Best,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Africa/Lagos Timezone | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

## Email 2: Day 14 Inactive
*   **Trigger**: No dashboard activity in 14 days.
*   **Subject Options**:
    *   *Option 1*: Here is what you're missing out on Eki... 📈
    *   *Option 2*: Verified buyers are looking for suppliers like you.
*   **Preview Text**: New trade opportunities are waiting in the Eki foodstuff directory.

### HTML Body Copy
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Outfit', Arial, sans-serif; color: #1e1e1e; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background-color: #1e1e1e; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; }
    .stats-box { background-color: #f9f9f9; border: 1px solid #eee; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>Trade waits for no one! While you've been away, Eki has onboarded new verified vendors and international buyers actively searching for partnerships.</p>
    
    <div class="stats-box">
      <h4>📈 Eki Marketplace Activity This Week:</h4>
      <ul>
        <li><strong>New Active Buyers:</strong> +12 verified buyers in Italy & Europe.</li>
        <li><strong>Top Demanded Products:</strong> Organic chili pepper, processed yam flour, palm oil, and stockfish.</li>
        <li><strong>Average Shipping Time:</strong> Shipments cleared customs and arrived in under 8 days.</li>
      </ul>
    </div>
    
    <p>Log in today to see current buying requests, check out new listings, and update your trading preferences.</p>
    
    <div class="button-container">
      <a href="https://culinarytales.app/directory" class="button" target="_blank">View Market Directory</a>
    </div>
    
    <p>Don't miss out on securing your next trade partner.</p>
    <p>Warm regards,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

## Email 3: Day 21 Inactive
*   **Trigger**: No dashboard activity in 21 days.
*   **Subject Options**:
    *   *Option 1*: Quick question: Should we keep your Eki profile open?
    *   *Option 2*: We miss you! Here is a special incentive to log back in.
*   **Preview Text**: Your Eki profile will be marked as inactive. Log in to keep it active.

### HTML Body Copy
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Outfit', Arial, sans-serif; color: #1e1e1e; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background-color: #d4af37; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; }
    .incentive-badge { border: 2px dashed #d4af37; padding: 15px; text-align: center; font-size: 18px; font-weight: bold; color: #d4af37; margin: 20px 0; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>It's been 3 weeks since you last logged into Eki. To keep our marketplace active and filled with trusted traders, we clean up inactive profiles regularly.</p>
    
    <p>If you're still planning to buy or sell foodstuff safely, we'd love to have you back. To make your return sweeter, we are waiving Eki escrow fees on your first transaction when you log back in this week!</p>
    
    <div class="incentive-badge">
      🎁 0% Escrow Fees On Your First Trade!
    </div>
    
    <p>All you need to do is log in, list a product or place a buying request, and the discount will be applied automatically at checkout.</p>
    
    <div class="button-container">
      <a href="https://culinarytales.app/login" class="button" target="_blank">Activate My 0% Commission Trade</a>
    </div>
    
    <p>If you no longer wish to use Eki, no action is needed—your profile will be marked inactive automatically.</p>
    
    <p>Hope to see you soon,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```
