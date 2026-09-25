# Eki Welcome Email Sequence (3-Email Series)

These templates are configured to be sent via the Resend API. The automation workflow will trigger them immediately, 24 hours, and 72 hours after signup.

---

## Email 1: Welcome to Eki (Immediate)
*   **Trigger**: Sent immediately upon lead registration.
*   **Subject Options**:
    *   *Option 1*: Welcome to Eki! Let’s make foodstuff trade secure 🚀
    *   *Option 2*: You're in! Sourcing & exporting African foodstuffs just got safe.
*   **Preview Text**: Get ready to buy and sell authentic African foodstuffs with zero scam risk.

### HTML Body Copy
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Outfit', Arial, sans-serif; color: #1e1e1e; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; }
    .logo { text-align: center; margin-bottom: 20px; }
    .logo img { height: 50px; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background-color: #d4af37; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <!-- Eki Logo Asset Placeholder -->
      <h2 style="color: #d4af37; margin: 0;">Eki</h2>
      <small style="color: #888;">Secure African Foodstuff Marketplace</small>
    </div>
    
    <p>Hey {{name}},</p>
    
    <p>Welcome to **Eki** — the digital marketplace that connects verified African foodstuff vendors and exporters with local and international buyers safely.</p>
    
    <p>We built Eki because we know how stressful international food trade can be. Scams, high shipping rates, unverified sellers, and customs issues cost businesses thousands of dollars daily. We are putting an end to that.</p>
    
    <h3>Here is how Eki protects you:</h3>
    <ul>
      <li><strong>Escrow Payments:</strong> Buyers deposit funds securely. Eki holds the payment until the shipment arrives and is verified. Vendors ship with guaranteed payouts.</li>
      <li><strong>Verified Network:</strong> Every vendor and exporter is audited for product quality, licensing, and compliance.</li>
      <li><strong>Logistics Support:</strong> Integrated shipping assistance to make customs clearance hassle-free.</li>
    </ul>
    
    <p><strong>Your next step:</strong> Log in to your dashboard to complete your profile verification so you can start trading.</p>
    
    <div class="button-container">
      <a href="https://eki-marketplace.com/verify?email={{email}}" class="button" target="_blank">Complete Profile Setup</a>
    </div>
    
    <p>Welcome aboard,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Africa / Lagos Timezone</p>
      <p>If you did not sign up for this account, you can safely ignore this email or <a href="{{unsubscribe_link}}">unsubscribe</a>.</p>
    </div>
  </div>
</body>
</html>
```

---

## Email 2: Sourcing/Exporting Guide (Day 1 - 24h later)
*   **Trigger**: Sent 24 hours after signup.
*   **Subject Options**:
    *   *Option 1*: How Eki Escrow guarantees your payments 🛡️
    *   *Option 2*: Exporters & Buyers: How to avoid trade scams.
*   **Preview Text**: Learn how our secure payment protection keeps your trade funds safe.

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
    .highlight { background-color: #fcf8e3; padding: 15px; border-left: 4px solid #d4af37; margin: 20px 0; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>One of the biggest blockers in international trade is trust. Buyers worry about sending money and getting nothing; exporters worry about shipping goods and getting ghosted.</p>
    
    <p>Here is exactly how **Eki Escrow** solves this problem for you:</p>
    
    <div class="highlight">
      <strong>The 4-Step Escrow Protection Flow:</strong>
      <ol>
        <li><strong>Deal Locked:</strong> The buyer and vendor agree on quantity and price. The buyer deposits payment into the secure Eki Escrow account.</li>
        <li><strong>Notification:</strong> The vendor receives an automated alert confirming funds are locked and it's safe to ship.</li>
        <li><strong>Shipment:</strong> The vendor packages the foodstuff according to compliance standards and ships them.</li>
        <li><strong>Payout:</strong> Once the buyer inspects and approves the shipment, funds are instantly released to the vendor.</li>
      </ol>
    </div>
    
    <p>No scams. No stress. You can now focus entirely on sourcing quality foodstuff and growing your business.</p>
    
    <div class="button-container">
      <a href="https://eki-marketplace.com/dashboard" class="button" target="_blank">Access Your Dashboard</a>
    </div>
    
    <p>Best regards,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>If you have any questions, just reply directly to this email.</p>
      <p>Eki Marketplace | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

## Email 3: Build Your Store / Search Directory (Day 3 - 72h later)
*   **Trigger**: Sent 72 hours after signup.
*   **Subject Options**:
    *   *Option 1*: Ready to make your first trade on Eki? 🛒
    *   *Option 2*: Find verified African foodstuff exporters now.
*   **Preview Text**: List your products or browse verified suppliers in our secure directory.

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
    
    <p>Eki is growing fast, and there are active buyers and vendors waiting to connect with you.</p>
    
    <p>Here is what you should do today depending on your business:</p>
    
    <p>🌾 <strong>If you are a Vendor / Exporter:</strong><br>
    Log in and list your products. Upload clear photos of your spices, flours, or oils, specify minimum order quantities (MOQ), and indicate your export certifications. The more complete your profile, the faster buyers will trust you.</p>
    
    <p>🌍 <strong>If you are a Buyer / Importer:</strong><br>
    Browse our verified directory. Filter by country of origin, product type, and exporter rating. You can place direct requests or initiate secure escrow deposits in a few clicks.</p>
    
    <div class="button-container">
      <a href="https://eki-marketplace.com/directory" class="button" target="_blank">Start Trading on Eki</a>
    </div>
    
    <p>P.S. Need help with customs regulations or shipping logistics? Contact our support desk directly through the dashboard chat.</p>
    
    <p>Cheers,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Lagos & Milan | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```
