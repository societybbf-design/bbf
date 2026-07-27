async function sendSms({ to, message }) {
  const phone = String(to || '').trim();
  const body = String(message || '').trim();

  if (!phone || !body) {
    return { sent: false, skipped: true, reason: 'missing_phone_or_message' };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[SMS preview] To: ${phone} | ${body}`);
    return { sent: false, preview: true };
  }

  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: phone,
      From: fromNumber,
      Body: body,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('SMS send failed:', data.message || response.statusText);
      return { sent: false, error: data.message || 'sms_failed' };
    }

    return { sent: true, sid: data.sid };
  } catch (error) {
    console.error('SMS send failed:', error.message);
    return { sent: false, error: error.message };
  }
}

module.exports = {
  sendSms,
};
