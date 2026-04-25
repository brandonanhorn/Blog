(() => {
  const API_URL = "https://excel-completion-trainers-connect.trycloudflare.com/api/chat";
  const form = document.querySelector("[data-knowledge-form]");
  const messageField = document.querySelector("#knowledge-message");
  const askButton = document.querySelector("[data-ask-button]");
  const responseField = document.querySelector("[data-knowledge-response]");

  if (!form || !messageField || !askButton || !responseField) {
    return;
  }

  const setLoadingState = (isLoading) => {
    askButton.disabled = isLoading;
    askButton.textContent = isLoading ? "Thinking..." : "Ask";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = messageField.value.trim();

    if (!message) {
      responseField.textContent = "Please enter a question first.";
      return;
    }

    setLoadingState(true);
    responseField.textContent = "Thinking...";

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

      responseField.textContent = data.message;
    } catch (_error) {
      responseField.textContent = "The knowledge interface is offline right now. Please try again later.";
    } finally {
      setLoadingState(false);
    }
  });
})();
