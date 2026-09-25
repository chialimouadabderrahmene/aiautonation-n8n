# Eki Feedback Request Email Template

This email is triggered by the feedback collection workflow 7 days after signup to request usability ratings and feature comments.

---

## Feedback Request Email
*   **Trigger**: Sent 7 days after active usage on Eki.
*   **Subject Options**:
    *   *Option 1*: Got 30 seconds to help us improve Eki? 🙏
    *   *Option 2*: Help us build a better marketplace for you.
*   **Preview Text**: Your feedback helps us make Eki safer and faster. Tell us how we are doing.

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
    .incentive-note { background-color: #fcf8e3; border-left: 4px solid #d4af37; padding: 15px; margin: 20px 0; font-size: 14px; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Hey {{name}},</p>
    
    <p>You’ve been using Eki for a week now! Whether you're sourcing high-quality yams, listing native spices, or coordinating logistics, we want to hear about your experience.</p>
    
    <p>We are constantly refining the platform to make global African foodstuff trade safer, faster, and more convenient. Your honest feedback is crucial for our engineering and product teams.</p>
    
    <div class="incentive-note">
      <strong>🎁 We value your time:</strong> Complete this 30-second survey, and we will credit your account with <strong>1 free shipping consult</strong> with our import/export customs team.
    </div>
    
    <p>Please click the link below to share your thoughts:</p>
    
    <div class="button-container">
      <a href="https://eki-marketplace.com/feedback-form?email={{email}}&name={{name}}" class="button" target="_blank">Start Feedback Survey</a>
    </div>
    
    <p>We read every single submission personally.</p>
    
    <p>Thank you for helping us shape Eki!</p>
    
    <p>Cheers,</p>
    <p><strong>The Eki Team</strong></p>
    
    <div class="footer">
      <p>Eki Marketplace | Africa/Lagos Timezone | <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```
