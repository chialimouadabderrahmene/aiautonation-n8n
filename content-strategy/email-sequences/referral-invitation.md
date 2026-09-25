# Eki Referral Invitation Email Template

This email is sent to active users to encourage them to invite their network of vendors, exporters, and buyers to Eki in exchange for transaction fee waivers.

---

## Referral Invitation Email
*   **Trigger**: Sent during promotional campaigns or when users complete registration milestones.
*   **Subject Options**:
    *   *Option 1*: Get 30 days of commission-free trade on Eki! 🎁
    *   *Option 2*: Help us build a trusted foodstuff network (and save on fees)
*   **Preview Text**: Invite other vendors or buyers to Eki and unlock 0% escrow fees.

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
    .referral-box { background-color: #fcf8e3; border: 2px dashed #d4af37; padding: 20px; text-align: center; font-size: 20px; font-weight: bold; margin: 20px 0; letter-spacing: 1px; }
    .milestones { margin: 20px 0; }
    .milestones li { margin-bottom: 10px; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>We believe that global foodstuff trade works best when it is built on personal connections. That’s why we want to reward you for inviting other trusted vendors, exporters, and buyers to **Eki**.</p>
    
    <p>When you invite your trade partners, you help us make the marketplace safer, and you unlock exclusive savings on transactions.</p>
    
    <div class="referral-box">
      Your Referral Link:<br>
      <span style="color: #1e1e1e; font-size: 16px; font-family: monospace;">https://eki-marketplace.com/signup?ref={{referral_code}}</span>
    </div>
    
    <h3 class="milestones">🎁 Referral Rewards & Milestones:</h3>
    <ul>
      <li><strong>Refer 3 Exporters:</strong> Unlock early beta listings features.</li>
      <li><strong>Refer 5 Traders (Buyers or Vendors):</strong> Unlock <strong>30 days of 0% transaction commissions</strong> on your Eki escrow checkouts (saves up to $250).</li>
      <li><strong>Refer 10+ Traders:</strong> Get featured in Eki's premium directory spotlight, placing your profile at the top of search results.</li>
    </ul>
    
    <p>Simply copy your link above and share it on WhatsApp, LinkedIn, or directly with your trading partners.</p>
    
    <div class="button-container">
      <a href="https://eki-marketplace.com/dashboard/referrals" class="button" target="_blank">Track My Referrals</a>
    </div>
    
    <p>Thank you for helping us grow Eki safely!</p>
    <p>Cheers,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Africa/Lagos Timezone</p>
      <p>To unsubscribe from referral campaign emails, click <a href="{{unsubscribe_link}}">here</a>.</p>
    </div>
  </div>
</body>
</html>
```
