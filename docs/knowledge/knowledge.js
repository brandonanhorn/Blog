(() => {
  const API_URL = "https://massage-index-prairie-americas.trycloudflare.com/api/chat";
  const form = document.querySelector("[data-knowledge-form]");
  const messageField = document.querySelector("#knowledge-message");
  const askButton = document.querySelector("[data-ask-button]");
  const responseField = document.querySelector("[data-knowledge-response]");
  const thinking = document.querySelector("[data-thinking]");

  if (!form || !messageField || !askButton || !responseField || !thinking) {
    return;
  }

  const setLoadingState = (isLoading) => {
    askButton.disabled = isLoading;
    askButton.textContent = isLoading ? "Thinking..." : "Ask";
  };

  const escapeHtml = (value) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const renderResponse = (message) => {
    const lines = message.split(/\r?\n/);
    const blocks = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];

    const flushParagraph = () => {
      if (!paragraph.length) {
        return;
      }

      blocks.push(`<p>${paragraph.join("<br>")}</p>`);
      paragraph = [];
    };

    const flushList = () => {
      if (!listType || !listItems.length) {
        return;
      }

      const items = listItems.map((item) => `<li>${item}</li>`).join("");
      blocks.push(`<${listType}>${items}</${listType}>`);
      listType = null;
      listItems = [];
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);

      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }

      if (bulletMatch) {
        flushParagraph();

        if (listType !== "ul") {
          flushList();
          listType = "ul";
        }

        listItems.push(escapeHtml(bulletMatch[1]));
        return;
      }

      if (orderedMatch) {
        flushParagraph();

        if (listType !== "ol") {
          flushList();
          listType = "ol";
        }

        listItems.push(escapeHtml(orderedMatch[1]));
        return;
      }

      flushList();
      paragraph.push(escapeHtml(line));
    });

    flushParagraph();
    flushList();

    responseField.innerHTML = blocks.length ? blocks.join("") : `<p>${escapeHtml(message)}</p>`;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = messageField.value.trim();

    if (!message) {
      renderResponse("Please enter a question first.");
      return;
    }

    setLoadingState(true);
    thinking.hidden = false;
    renderResponse("Thinking...");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.message !== "string") {
        throw new Error(data.error || "Request failed");
      }

      renderResponse(data.message);
    } catch (_error) {
      renderResponse("The knowledge interface is offline right now. Please try again later.");
    } finally {
      thinking.hidden = true;
      setLoadingState(false);
    }
  });
})();
