(() => {
  const API_URL = "https://hybrid-rev-excerpt-kerry.trycloudflare.com/api/chat";
  const MULTIMODAL_API_URL = API_URL.replace(/\/api\/chat\/?$/, "/api/chat-multimodal");
  const FEEDBACK_URL = API_URL.replace(/\/api\/chat\/?$/, "/api/feedback");
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
    "This answer is being generated locally.",
    "The model is reading notes, not searching the web.",
    "Images are processed in memory and not stored.",
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

  const submitQuestion = (message, selectedImage) => {
    if (!selectedImage) {
      return fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    }

    const formData = new FormData();
    formData.append("message", message);
    formData.append("image", selectedImage);
    return fetch(MULTIMODAL_API_URL, { method: "POST", body: formData });
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
    const selectedImage = getSelectedImage();
    currentLogId = null;
    setFeedbackState({ visible: false, disabled: false, message: "" });

    if (!message) {
      renderResponse("Please enter a question first.");
      return;
    }

    setLoadingState(true);
    startWaitingRotation(!!selectedImage);
    thinking.hidden = false;
    setResponseEmpty("Answer will appear here when the notebook is ready.");

    try {
      const response = await submitQuestion(message, selectedImage);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.message !== "string") throw new Error(data.error || "The knowledge interface is offline right now. Please try again later.");
      renderResponse(data.message);
      currentLogId = typeof data.logId === "string" && data.logId.trim() ? data.logId : null;
      setFeedbackState({ visible: !!currentLogId, disabled: false, message: "" });
    } catch (error) {
      renderResponse(error.message || "The knowledge interface is offline right now. Please try again later.");
    } finally {
      thinking.hidden = true;
      stopWaitingRotation();
      setLoadingState(false);
    }
  });
})();
