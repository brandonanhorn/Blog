(() => {
  const API_URL = "https://carnival-welfare-teachers-updates.trycloudflare.com/api/chat";
  const FEEDBACK_URL = API_URL.replace(/\/api\/chat\/?$/, "/api/feedback");
  const form = document.querySelector("[data-knowledge-form]");
  const messageField = document.querySelector("#knowledge-message");
  const askButton = document.querySelector("[data-ask-button]");
  const responseField = document.querySelector("[data-knowledge-response]");
  const thinking = document.querySelector("[data-thinking]");
  const feedbackBox = document.querySelector("[data-feedback]");
  const feedbackStatus = document.querySelector("[data-feedback-status]");
  const feedbackButtons = Array.from(document.querySelectorAll("[data-feedback-value]"));

  if (!form || !messageField || !askButton || !responseField || !thinking) return;

  let currentLogId = null;

  const setLoadingState = (isLoading) => {
    askButton.disabled = isLoading;
    askButton.textContent = isLoading ? "Thinking..." : "Ask";
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

  const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const renderResponse = (message) => {
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
    thinking.hidden = false;
    renderResponse("Thinking...");

    try {
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.message !== "string") throw new Error(data.error || "Request failed");
      renderResponse(data.message);
      currentLogId = typeof data.logId === "string" && data.logId.trim() ? data.logId : null;
      setFeedbackState({ visible: !!currentLogId, disabled: false, message: "" });
    } catch (_error) {
      renderResponse("The knowledge interface is offline right now. Please try again later.");
    } finally {
      thinking.hidden = true;
      setLoadingState(false);
    }
  });
})();
