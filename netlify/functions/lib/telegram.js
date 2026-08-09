// Sends a message to your own Telegram via the Bot API. No dependency — plain fetch.
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars. Silently no-ops if unset,
// so this never blocks the actual payment/unlock flow if you haven't set it up yet.

async function notify(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram not configured — skipping notification');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Telegram notify failed (${response.status}): ${errText}`);
  }
}

module.exports = { notify };
