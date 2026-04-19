const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, corsHeaders);
    }

    if (!isAllowedOrigin(request, env)) {
      return json({ error: 'Origin not allowed.' }, 403, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400, corsHeaders);
    }

    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim();
    const message = String(body?.message || '').trim();
    const company = String(body?.company || '').trim(); // honeypot
    const turnstileToken = String(body?.turnstileToken || '').trim();

    if (company) {
      return json({ error: 'Rejected request.' }, 400, corsHeaders);
    }

    if (!name || !email || !message || !turnstileToken) {
      return json({ error: 'Missing required fields.' }, 400, corsHeaders);
    }

    if (!EMAIL_REGEX.test(email)) {
      return json({ error: 'Email format is invalid.' }, 400, corsHeaders);
    }

    if (name.length > 100 || email.length > 254 || message.length > 5000) {
      return json({ error: 'Input exceeds allowed length.' }, 400, corsHeaders);
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const turnstileOk = await verifyTurnstile(turnstileToken, ip, env);
    if (!turnstileOk) {
      return json({ error: 'Verification failed. Please try again.' }, 400, corsHeaders);
    }

    const resendResult = await sendWithResend({ name, email, message }, env);
    if (!resendResult.ok) {
      return json({ error: 'Unable to send message right now.' }, 502, corsHeaders);
    }

    return json(
      { message: 'Thanks! Your message has been sent successfully.' },
      200,
      corsHeaders
    );
  }
};

function buildCorsHeaders(request, env) {
  const headers = { 'Content-Type': 'application/json' };
  const origin = request.headers.get('Origin') || '';
  if (origin && env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

function isAllowedOrigin(request, env) {
  if (!env.ALLOWED_ORIGIN) {
    return false;
  }

  const origin = request.headers.get('Origin');
  if (!origin) {
    return false;
  }

  return origin === env.ALLOWED_ORIGIN;
}

async function verifyTurnstile(token, remoteip, env) {
  const formData = new FormData();
  formData.append('secret', env.TURNSTILE_SECRET_KEY);
  formData.append('response', token);
  if (remoteip) {
    formData.append('remoteip', remoteip);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  return Boolean(result.success);
}

async function sendWithResend(contact, env) {
  const payload = {
    from: env.RESEND_FROM,
    to: [env.RESEND_TO],
    reply_to: contact.email,
    subject: `Contact form: ${contact.name}`,
    text: `New contact message\n\nName: ${contact.name}\nEmail: ${contact.email}\n\nMessage:\n${contact.message}`
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Resend failed', response.status, body);
    return { ok: false };
  }

  return { ok: true };
}

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
