> **DRAFT copy - not wired to any workflow.** Links use the canonical domain but the paths (`/dashboard`, `/directory`, `/login`, `/verify`, `/feedback`, `/signup`) are illustrative: replace them with real Eki routes, and verify every claim (e.g. commission offers) before sending. Never put personal data in link query strings.

# Eki App Store Review Request Email Template

This email is triggered by the feedback workflow when a user submits a positive rating (4 or 5 stars). It asks for an honest review on public app stores.

---

## App Store Review Request
*   **Trigger**: Positive rating (rating >= 4) received in Feedback sheet.
*   **Subject Options**:
    *   *Option 1*: Can you help other exporters and buyers find Eki? ⭐⭐⭐⭐⭐
    *   *Option 2*: Thank you for the positive review! Could you share it publicly?
*   **Preview Text**: Since you're loving Eki, please leave us an honest review on the app store.

### HTML Body Copy
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Outfit', Arial, sans-serif; color: #1e1e1e; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; }
    .button-container { text-align: center; margin: 30px 0; }
    .button-link { display: inline-block; background-color: #d4af37; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 0 10px; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>Thank you so much for your positive feedback! We are thrilled to hear that Eki is helping you trade foodstuff securely and grow your business.</p>
    
    <p>As a small team building Eki, public reviews are the most powerful way for us to show other African foodstuff exporters and global buyers that they can trust our platform.</p>
    
    <p>If you have 1 minute to spare, could you leave us an honest rating and review on your app store? It makes a massive difference for us.</p>
    
    <div class="button-container">
      <a href="https://apps.apple.com/app/eki-marketplace/id[APP_ID]" class="button-link" target="_blank">Review on Apple App Store</a>
      <a href="https://play.google.com/store/apps/details?id=com.eki.marketplace" class="button-link" target="_blank">Review on Google Play Store</a>
    </div>
    
    <p>Your support helps us keep Eki safe, verified, and scam-free for everyone.</p>
    
    <p>Thank you so much for being an active part of our community!</p>
    
    <p>Cheers,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Milan & Lagos | Timezone Africa/Lagos</p>
      <p>To unsubscribe from feedback follow-ups, click <a href="{{unsubscribe_link}}">here</a>.</p>
    </div>
  </div>
</body>
</html>
```
