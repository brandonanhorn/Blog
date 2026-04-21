(function () {
  const form = document.querySelector('[data-contact-form]');
  const status = document.querySelector('[data-form-status]');

  if (!form || !status) {
    return;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.style.color = isError ? '#a00' : '#060';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    const endpoint = form.getAttribute('action');
    if (!endpoint || endpoint.includes('REPLACE_WITH_WORKER_URL')) {
      setStatus('Form is not configured yet. Please set your Worker URL.', true);
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      message: String(formData.get('message') || '').trim(),
      company: String(formData.get('company') || '').trim(),
      turnstileToken: String(formData.get('cf-turnstile-response') || '').trim()
    };

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    setStatus('Sending message…', false);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(function () {
        return { error: 'Unexpected response from server.' };
      });

      if (!response.ok) {
        setStatus(result.error || 'Could not send your message. Please try again.', true);
        return;
      }

      form.reset();
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        window.turnstile.reset();
      }
      setStatus(result.message || 'Thanks! Your message was sent.', false);
    } catch (error) {
      setStatus('Network error. Please try again in a moment.', true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
})();
