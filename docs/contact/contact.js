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
    event.stopPropagation();

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
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const message = String(formData.get('message') || '').trim();
    const company = String(formData.get('company') || '').trim();
    const turnstileToken = String(formData.get('cf-turnstile-response') || '').trim();

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    setStatus('Sending message…', false);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          company,
          turnstileToken
        })
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
