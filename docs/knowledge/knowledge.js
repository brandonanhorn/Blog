(() => {
  // Permanent. This used to be a *.trycloudflare.com quick tunnel that changed
  // its hostname on every restart; it is now a Worker, and this line should
  // never need editing again.
  const API_URL = "https://knowledge-worker.brandon-anhorn.workers.dev/api/chat";
  const FEEDBACK_URL = API_URL.replace(/\/api\/chat\/?$/, "/api/feedback");

  // Paste the sitekey from the Turnstile widget you create for this domain.
  // While it is empty the script never loads and no token is sent, which is
  // only safe while the Worker has REQUIRE_TURNSTILE="false".
  //
  // Turn it on in this order, or the endpoint refuses every question:
  //   1. sitekey here, deploy the site  (token is sent, Worker ignores it)
  //   2. wrangler secret put TURNSTILE_SECRET
  //   3. REQUIRE_TURNSTILE="true" in wrangler.jsonc, redeploy the Worker
  const TURNSTILE_SITEKEY = "0x4AAAAAAEvOWvGlnyZx2SXr";
  const form = document.querySelector("[data-knowledge-form]");
  const messageField = document.querySelector("#knowledge-message");
  const imageUpload = document.querySelector("[data-image-upload]");
  const imageInput = document.querySelector("[data-image-input]");
  const imageFilename = document.querySelector("[data-image-filename]");
  const imageRemove = document.querySelector("[data-image-remove]");
  const askButton = document.querySelector("[data-ask-button]");
  const responseField = document.querySelector("[data-knowledge-response]");
  const thinking = document.querySelector("[data-thinking]");
  const thinkingCopy = document.querySelector("[data-thinking-copy]");
  const thinkingFact = document.querySelector("[data-thinking-fact]");
  const feedbackBox = document.querySelector("[data-feedback]");
  const feedbackStatus = document.querySelector("[data-feedback-status]");
  const feedbackButtons = Array.from(document.querySelectorAll("[data-feedback-value]"));

  if (!form || !messageField || !askButton || !responseField || !thinking) return;

  let currentLogId = null;
  let waitingMessageTimer = null;
  let waitingFactTimer = null;

  const baseWaitingMessages = [
    "Reading Brandon’s notes…",
    "Looking for useful context…",
    "Composing an answer…",
    "Almost there…"
  ];
  const waitingFacts = [
    "This runs on an open-source model, not a commercial assistant.",
    "The model is reading notes, not searching the web.",
    "Only notes I've marked publishable are in the index.",
    "Good questions make better retrieval."
  ];

  const getSelectedImage = () => imageInput?.files?.[0] || null;

  const formatFileSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  };

  const setLoadingState = (isLoading) => {
    askButton.disabled = isLoading;
    askButton.textContent = isLoading ? "Reading…" : "Ask";
  };

  const stopWaitingRotation = () => {
    window.clearInterval(waitingMessageTimer);
    window.clearInterval(waitingFactTimer);
    waitingMessageTimer = null;
    waitingFactTimer = null;
  };

  const startWaitingRotation = (hasImage) => {
    stopWaitingRotation();

    const messages = hasImage
      ? [baseWaitingMessages[0], baseWaitingMessages[1], "Checking the attached image…", baseWaitingMessages[2], baseWaitingMessages[3]]
      : baseWaitingMessages;
    let messageIndex = 0;
    let factIndex = 0;

    if (thinkingCopy) thinkingCopy.textContent = messages[messageIndex];
    if (thinkingFact) thinkingFact.textContent = waitingFacts[factIndex];

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    waitingMessageTimer = window.setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      if (thinkingCopy) thinkingCopy.textContent = messages[messageIndex];
    }, 2600);

    waitingFactTimer = window.setInterval(() => {
      factIndex = (factIndex + 1) % waitingFacts.length;
      if (thinkingFact) thinkingFact.textContent = waitingFacts[factIndex];
    }, 5200);
  };

  const updateImageState = () => {
    const selectedImage = getSelectedImage();
    if (imageFilename) {
      if (selectedImage) {
        const fileSize = formatFileSize(selectedImage.size);
        imageFilename.textContent = fileSize ? `${selectedImage.name} · ${fileSize}` : selectedImage.name;
      } else {
        imageFilename.textContent = "No image attached";
      }
    }
    if (imageRemove) {
      imageRemove.hidden = !selectedImage;
    }
    if (imageUpload) {
      imageUpload.classList.toggle("has-image", !!selectedImage);
    }
  };

  const clearSelectedImage = () => {
    if (imageInput) imageInput.value = "";
    updateImageState();
    imageInput?.focus();
  };

  const setFeedbackState = ({ visible, disabled, message = "" }) => {
    if (!feedbackBox) return;
    feedbackBox.hidden = !visible;
    feedbackButtons.forEach((button) => {
      button.disabled = !!disabled;
    });
    if (feedbackStatus) {
      feedbackStatus.textContent = message;
    }
  };

  const setResponseEmpty = (message) => {
    responseField.classList.add("response-empty");
    responseField.textContent = message;
  };

  const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const renderResponse = (message) => {
    responseField.classList.remove("response-empty");
    const lines = message.split(/\r?\n/);
    const blocks = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];

    const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.join("<br>")}</p>`); paragraph = []; } };
    const flushList = () => { if (listType && listItems.length) { blocks.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`); listType = null; listItems = []; } };

    lines.forEach((line) => {
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
      if (!trimmed) { flushParagraph(); flushList(); return; }
      if (bulletMatch) { flushParagraph(); if (listType !== "ul") { flushList(); listType = "ul"; } listItems.push(escapeHtml(bulletMatch[1])); return; }
      if (orderedMatch) { flushParagraph(); if (listType !== "ol") { flushList(); listType = "ol"; } listItems.push(escapeHtml(orderedMatch[1])); return; }
      flushList(); paragraph.push(escapeHtml(line));
    });

    flushParagraph(); flushList();
    responseField.innerHTML = blocks.length ? blocks.join("") : `<p>${escapeHtml(message)}</p>`;
  };

  // --- Turnstile ---------------------------------------------------------
  // This is what stops a script looping the endpoint: a token cannot be minted
  // without a real browser. Loaded only when a sitekey is set, so the page
  // works both before and after the widget exists. Tokens are single-use, so
  // the widget is reset after every question.

  const turnstileSlot = document.querySelector("[data-turnstile]");
  let turnstileWidgetId = null;
  let turnstileToken = null;
  let turnstileWaiters = [];

  const resolveTurnstile = (token) => {
    turnstileToken = token;
    turnstileWaiters.forEach((resolve) => resolve(token));
    turnstileWaiters = [];
  };

  const loadTurnstile = () => {
    if (!TURNSTILE_SITEKEY || !turnstileSlot) return;

    turnstileSlot.hidden = false;

    window.onKnowledgeTurnstileLoad = () => {
      turnstileWidgetId = window.turnstile.render(turnstileSlot, {
        sitekey: TURNSTILE_SITEKEY,
        callback: resolveTurnstile,
        "expired-callback": () => { turnstileToken = null; },
        "error-callback": () => resolveTurnstile(null)
      });
    };

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onKnowledgeTurnstileLoad";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  };

  const getTurnstileToken = () => {
    if (!TURNSTILE_SITEKEY) return Promise.resolve(null);
    if (turnstileToken) return Promise.resolve(turnstileToken);

    return new Promise((resolve) => {
      turnstileWaiters.push(resolve);
      // Never leave someone watching a spinner because the challenge stalled.
      // Sending no token gets a clear "reload and try again" from the server.
      window.setTimeout(() => resolve(turnstileToken), 10000);
    });
  };

  const resetTurnstile = () => {
    turnstileToken = null;
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
  };

  loadTurnstile();

  const submitQuestion = async (message) => {
    const token = await getTurnstileToken();
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(token ? { message, turnstileToken: token } : { message })
    });
  };

  if (imageInput) {
    imageInput.addEventListener("change", updateImageState);
  }

  if (imageRemove) {
    imageRemove.addEventListener("click", clearSelectedImage);
  }

  updateImageState();

  feedbackButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const feedback = button.getAttribute("data-feedback-value");
      if (!currentLogId || !feedback) return;

      try {
        const response = await fetch(FEEDBACK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logId: currentLogId, feedback })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error("feedback_failed");
        setFeedbackState({ visible: true, disabled: true, message: "Thanks for the feedback." });
      } catch (_error) {
        setFeedbackState({ visible: true, disabled: false, message: "Feedback could not be saved." });
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = messageField.value.trim();
    currentLogId = null;
    setFeedbackState({ visible: false, disabled: false, message: "" });

    if (!message) {
      renderResponse("Please enter a question first.");
      return;
    }

    setLoadingState(true);
    startWaitingRotation(false);
    thinking.hidden = false;
    setResponseEmpty("Answer will appear here when the notebook is ready.");

    try {
      const response = await submitQuestion(message);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.message !== "string") throw new Error(data.error || "The knowledge interface is offline right now. Please try again later.");
      renderResponse(data.message);
      currentLogId = typeof data.logId === "string" && data.logId.trim() ? data.logId : null;
      setFeedbackState({ visible: !!currentLogId, disabled: false, message: "" });
    } catch (error) {
      renderResponse(error.message || "The knowledge interface is offline right now. Please try again later.");
    } finally {
      // The token is spent whether or not the answer came back.
      resetTurnstile();
      thinking.hidden = true;
      stopWaitingRotation();
      setLoadingState(false);
    }
  });
})();
