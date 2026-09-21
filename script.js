(() => {
  "use strict";

  /* =========================================================
     КОНСТАНТЫ
     ========================================================= */

  const STORAGE_KEY = "waw_web_state_v1";

  const API_ENDPOINT = "https://forwaw-ai.ervin-mandarin.workers.dev";

  /* =========================================================
     STORAGE
     ========================================================= */

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);

        parsed.settings = Object.assign(
          defaultState().settings,
          parsed.settings || {}
        );

        return parsed;
      }
    } catch (e) {
      console.warn("WAW: failed to read stored state", e);
    }

    return null;
  }

  function makeChat(index) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `Чат ${index}`,
      messages: [],
    };
  }

  function defaultState() {
    const chat = makeChat(1);

    return {
      chats: [chat],
      activeChatId: chat.id,

      settings: {
        displayName: "Ты",
        personalInstruction: "",
        accent: "violet",
        theme: "dark",
        reasoningDefault: false,
        roleplayDefault: false,
      },
    };
  }

  let state = loadState() || defaultState();

  let reasoningOn = state.settings.reasoningDefault;
  let roleplayOn = state.settings.roleplayDefault;
  let isGenerating = false;

  /*
    Временные варианты ответов.
    Формат:
    {
      messageId,
      variants: [messageObject, messageObject],
      current: 0
    }
  */
  const responseVariants = new Map();

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state)
      );
    } catch (e) {
      console.warn("WAW: failed to persist state", e);
    }
  }

  function getActiveChat() {
    return (
      state.chats.find(
        (c) => c.id === state.activeChatId
      ) || state.chats[0]
    );
  }

  /* =========================================================
     DOM
     ========================================================= */

  const $ = (id) => document.getElementById(id);

  const chatListEl = $("chatList");
  const messagesEl = $("messages");
  const emptyStateEl = $("emptyState");
  const threadEl = $("thread");
  const topbarTitleEl = $("topbarTitle");
  const messageInput = $("messageInput");
  const sendBtn = $("sendBtn");
  const brandDot = document.querySelector(".brand-dot");

  const sidebarEl = $("sidebar");
  const sidebarScrim = $("sidebarScrim");
  const openSidebarBtn = $("openSidebarBtn");
  const closeSidebarBtn = $("closeSidebarBtn");

  const newChatBtn = $("newChatBtn");
  const deleteChatBtn = $("deleteChatBtn");

  const reasoningToggle = $("reasoningToggle");
  const roleplayToggle = $("roleplayToggle");

  const settingsBtn = $("settingsBtn");
  const settingsPanel = $("settingsPanel");
  const settingsScrim = $("settingsScrim");
  const closeSettingsBtn = $("closeSettingsBtn");

  const displayNameInput = $("displayNameInput");
  const userDisplayName = $("userDisplayName");
  const userAvatar = $("userAvatar");

  const personalInstructionInput =
    $("personalInstructionInput");

  const piCount = $("piCount");
  const accentSwatches = $("accentSwatches");
  const themeSegmented = $("themeSegmented");

  const reasoningDefaultSwitch =
    $("reasoningDefaultSwitch");

  const roleplayDefaultSwitch =
    $("roleplayDefaultSwitch");

  const wipeDataBtn = $("wipeDataBtn");

  /* =========================================================
     MARKDOWN
     ========================================================= */

  function renderMarkdown(el, text, withCaret) {
    const caret = withCaret
      ? '<span class="stream-caret"></span>'
      : "";

    if (window.marked && window.DOMPurify) {
      const parse = marked.parse || marked;

      const html = parse(text, {
        breaks: true,
        gfm: true,
      });

      el.innerHTML =
        DOMPurify.sanitize(html) + caret;
    } else {
      el.textContent =
        text + (withCaret ? "▌" : "");
    }
  }

  function highlightCode(root) {
    if (!window.hljs) return;

    root.querySelectorAll("pre code").forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch (e) {
        /* noop */
      }
    });
  }

  /* =========================================================
     CHAT LIST
     ========================================================= */

  function renderChatList() {
    chatListEl.innerHTML = "";

    state.chats.forEach((chat) => {
      const item = document.createElement("div");

      item.className =
        "chat-item" +
        (chat.id === state.activeChatId
          ? " active"
          : "");

      item.tabIndex = 0;
      item.setAttribute("role", "button");

      const title = document.createElement("span");

      title.className = "title";
      title.textContent = chat.title;

      const del = document.createElement("button");

      del.className = "del";
      del.setAttribute(
        "aria-label",
        "Удалить чат"
      );

      del.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/></svg>';

      del.addEventListener("click", (e) => {
        e.stopPropagation();

        if (
          confirm(
            `Удалить «${chat.title}»?`
          )
        ) {
          deleteChat(chat.id);
        }
      });

      item.appendChild(title);
      item.appendChild(del);

      item.addEventListener("click", () =>
        selectChat(chat.id)
      );

      item.addEventListener("keydown", (e) => {
        if (
          e.key === "Enter" ||
          e.key === " "
        ) {
          e.preventDefault();
          selectChat(chat.id);
        }
      });

      chatListEl.appendChild(item);
    });
  }

  function selectChat(chatId) {
    state.activeChatId = chatId;

    save();
    renderAll();

    closeSidebarOnMobile();
  }

  function createChat() {
    const chat = makeChat(
      state.chats.length + 1
    );

    state.chats.push(chat);
    state.activeChatId = chat.id;

    save();
    renderAll();

    closeSidebarOnMobile();

    messageInput.focus();
  }

  function deleteChat(chatId) {
    const wasActive =
      chatId === state.activeChatId;

    state.chats = state.chats.filter(
      (c) => c.id !== chatId
    );

    if (state.chats.length === 0) {
      const replacement = makeChat(1);

      state.chats = [replacement];
      state.activeChatId =
        replacement.id;
    } else if (wasActive) {
      state.activeChatId =
        state.chats[0].id;
    }

    save();
    renderAll();
  }

  /* =========================================================
     MESSAGE VARIANTS
     ========================================================= */

  function getVariantData(message) {
    return responseVariants.get(
      message.id
    );
  }

  function ensureVariantData(message) {
    if (!message.id) {
      message.id =
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
    }

    if (!responseVariants.has(message.id)) {
      responseVariants.set(
        message.id,
        {
          variants: [message],
          current: 0,
        }
      );
    }

    return responseVariants.get(
      message.id
    );
  }

  function addVariant(message, variant) {
    const data = ensureVariantData(message);

    data.variants.push(variant);
    data.current =
      data.variants.length - 1;
  }

  /* =========================================================
     MESSAGE SHELL
     ========================================================= */

  function buildMessageShell(m) {
    const wrap = document.createElement("div");

    wrap.className =
      "msg " +
      (m.role === "user"
        ? "user"
        : "model");

    if (m.role === "model") {
      wrap.dataset.messageId =
        m.id || "";
    }

    const body =
      document.createElement("div");

    body.className = "msg-body";

    if (m.reasoning) {
      const reasoning =
        document.createElement("div");

      reasoning.className =
        "reasoning-block";

      reasoning.textContent =
        m.reasoning;

      body.appendChild(reasoning);
    }

    const textEl =
      document.createElement("div");

    textEl.className = "msg-text";

    body.appendChild(textEl);

    wrap.appendChild(body);

    if (m.role === "model") {
      const actions =
        createMessageActions(m, body);

      body.appendChild(actions);
    }

    return {
      wrap,
      body,
      textEl,
    };
  }

  /* =========================================================
     MESSAGE ACTIONS
     ========================================================= */

  function createIcon(path) {
    return `
      <svg viewBox="0 0 24 24">
        ${path}
      </svg>
    `;
  }

  function createMessageActions(
    message,
    body
  ) {
    const actions =
      document.createElement("div");

    actions.className = "msg-actions";

    /* COPY */

    const copyBtn =
      document.createElement("button");

    copyBtn.className =
      "msg-action";

    copyBtn.title = "Скопировать";
    copyBtn.setAttribute(
      "aria-label",
      "Скопировать"
    );

    copyBtn.innerHTML =
      createIcon(
        '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'
      );

    copyBtn.addEventListener(
      "click",
      async () => {
        await copyMessage(
          message,
          body,
          copyBtn
        );
      }
    );

    /* LIKE */

    const likeBtn =
      document.createElement("button");

    likeBtn.className =
      "msg-action";

    likeBtn.title = "Нравится";
    likeBtn.setAttribute(
      "aria-label",
      "Нравится"
    );

    likeBtn.innerHTML =
      createIcon(
        '<path d="M7 10v10H4a2 2 0 01-2-2v-6a2 2 0 012-2h3z"/><path d="M7 20h9.5a2 2 0 001.9-1.4l2-7A2 2 0 0018.5 9H14l.7-3.2A2.3 2.3 0 0012.5 3L7 10"/>'
      );

    likeBtn.addEventListener(
      "click",
      () => {
        likeBtn.classList.toggle(
          "active-like"
        );

        dislikeBtn.classList.remove(
          "active-dislike"
        );
      }
    );

    /* DISLIKE */

    const dislikeBtn =
      document.createElement("button");

    dislikeBtn.className =
      "msg-action";

    dislikeBtn.title = "Не нравится";
    dislikeBtn.setAttribute(
      "aria-label",
      "Не нравится"
    );

    dislikeBtn.innerHTML =
      createIcon(
        '<path d="M7 14V4H4a2 2 0 00-2 2v6a2 2 0 002 2h3z"/><path d="M7 4h9.5a2 2 0 011.9 1.4l2 7A2 2 0 0118.5 15H14l.7 3.2a2.3 2.3 0 01-2.2 2.8L7 14"/>'
      );

    dislikeBtn.addEventListener(
      "click",
      () => {
        dislikeBtn.classList.toggle(
          "active-dislike"
        );

        likeBtn.classList.remove(
          "active-like"
        );
      }
    );

    /* RETRY */

    const retryBtn =
      document.createElement("button");

    retryBtn.className =
      "msg-action retry";

    retryBtn.title = "Переписать ответ";
    retryBtn.setAttribute(
      "aria-label",
      "Переписать ответ"
    );

    retryBtn.innerHTML =
      createIcon(
        '<path d="M20 11a8.1 8.1 0 00-14.9-4L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8.1 8.1 0 0014.9 4L21 14"/><path d="M21 20v-6h-6"/>'
      );

    retryBtn.addEventListener(
      "click",
      () => retryMessage(message)
    );

    /* VERSION NAVIGATION */

    const versions =
      document.createElement("div");

    versions.className =
      "msg-versions";

    const prevBtn =
      document.createElement("button");

    prevBtn.className =
      "msg-version-arrow";

    prevBtn.innerHTML = "‹";
    prevBtn.setAttribute(
      "aria-label",
      "Предыдущий вариант"
    );

    const count =
      document.createElement("span");

    count.className =
      "msg-version-count";

    const nextBtn =
      document.createElement("button");

    nextBtn.className =
      "msg-version-arrow";

    nextBtn.innerHTML = "›";
    nextBtn.setAttribute(
      "aria-label",
      "Следующий вариант"
    );

    versions.appendChild(prevBtn);
    versions.appendChild(count);
    versions.appendChild(nextBtn);

    function updateVersionControls() {
      const data =
        getVariantData(message);

      if (!data || data.variants.length <= 1) {
        versions.style.display =
          "none";
        return;
      }

      versions.style.display =
        "flex";

      count.textContent =
        `${data.current + 1}/${data.variants.length}`;

      prevBtn.disabled =
        data.current <= 0;

      nextBtn.disabled =
        data.current >=
        data.variants.length - 1;
    }

    prevBtn.addEventListener(
      "click",
      () => {
        const data =
          getVariantData(message);

        if (
          !data ||
          data.current <= 0
        ) {
          return;
        }

        data.current--;

        renderVariantInPlace(
          message,
          body,
          wrapFromBody(body)
        );

        updateVersionControls();
      }
    );

    nextBtn.addEventListener(
      "click",
      () => {
        const data =
          getVariantData(message);

        if (
          !data ||
          data.current >=
            data.variants.length - 1
        ) {
          return;
        }

        data.current++;

        renderVariantInPlace(
          message,
          body,
          wrapFromBody(body)
        );

        updateVersionControls();
      }
    );

    actions.appendChild(copyBtn);
    actions.appendChild(likeBtn);
    actions.appendChild(dislikeBtn);
    actions.appendChild(retryBtn);
    actions.appendChild(versions);

    setTimeout(
      updateVersionControls,
      0
    );

    return actions;
  }

  /*
    body -> message wrapper
  */
  function wrapFromBody(body) {
    return body.closest(".msg");
  }

  function renderVariantInPlace(
    originalMessage,
    body,
    wrap
  ) {
    const data =
      getVariantData(originalMessage);

    if (
      !data ||
      !data.variants[data.current]
    ) {
      return;
    }

    const variant =
      data.variants[data.current];

    const textEl =
      body.querySelector(".msg-text");

    if (!textEl) return;

    if (variant.reasoning) {
      let reasoning =
        body.querySelector(
          ".reasoning-block"
        );

      if (!reasoning) {
        reasoning =
          document.createElement(
            "div"
          );

        reasoning.className =
          "reasoning-block";

        body.insertBefore(
          reasoning,
          textEl
        );
      }

      reasoning.textContent =
        variant.reasoning;
    } else {
      const reasoning =
        body.querySelector(
          ".reasoning-block"
        );

      if (reasoning) {
        reasoning.remove();
      }
    }

    renderMarkdown(
      textEl,
      variant.text,
      false
    );

    highlightCode(textEl);

    wrap.dataset.messageId =
      variant.id || "";
  }

  /* =========================================================
     COPY
     ========================================================= */

  async function copyMessage(
    message,
    body,
    button
  ) {
    const data =
      getVariantData(message);

    const current =
      data
        ? data.variants[data.current]
        : message;

    try {
      await navigator.clipboard.writeText(
        current.text
      );

      body.classList.remove(
        "copy-flash"
      );

      /*
        forcing reflow allows repeated copies
        to retrigger the animation
      */
      void body.offsetWidth;

      body.classList.add(
        "copy-flash"
      );

      setTimeout(() => {
        body.classList.remove(
          "copy-flash"
        );
      }, 850);

      const old =
        button.innerHTML;

      button.innerHTML =
        createIcon(
          '<path d="M5 12l4 4L19 6"/>'
        );

      setTimeout(() => {
        button.innerHTML = old;
      }, 1000);

    } catch (err) {
      console.warn(
        "WAW: clipboard failed",
        err
      );
    }
  }

  /* =========================================================
     RETRY / REWRITE
     ========================================================= */

  async function retryMessage(
    originalMessage
  ) {
    if (isGenerating) return;

    const chat = getActiveChat();

    const index =
      chat.messages.findIndex(
        (m) =>
          m.id === originalMessage.id
      );

    if (index === -1) return;

    const previousUser =
      [...chat.messages]
        .slice(0, index)
        .reverse()
        .find(
          (m) => m.role === "user"
        );

    if (!previousUser) return;

    isGenerating = true;
    updateSendBtnState();

    const wrap =
      messagesEl.querySelector(
        `.msg[data-message-id="${originalMessage.id}"]`
      );

    const body =
      wrap?.querySelector(
        ".msg-body"
      );

    const textEl =
      wrap?.querySelector(
        ".msg-text"
      );

    if (!textEl) {
      isGenerating = false;
      updateSendBtnState();
      return;
    }

    textEl.innerHTML = `
      <div class="typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;

    try {
      const result =
        await getReply(chat);

      const variant = {
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        role: "model",
        text: result.answer,
        reasoning:
          result.reasoning ||
          undefined,

        createdAt: Date.now(),
      };

      addVariant(
        originalMessage,
        variant
      );

      const data =
        getVariantData(originalMessage);

      renderMarkdown(
        textEl,
        variant.text,
        false
      );

      highlightCode(textEl);

      /*
        Сохраняем варианты отдельно от основного
        массива чата, чтобы не плодить сообщения
        при каждом нажатии "переписать".
      */
      data.current =
        data.variants.length - 1;

      updateAllVersionControls(
        originalMessage
      );

      save();

      scrollThreadToBottom();

    } catch (err) {
      console.error(
        "WAW: retry failed",
        err
      );

      renderMarkdown(
        textEl,
        "не удалось переписать ответ. попробуй ещё раз",
        false
      );

    } finally {
      isGenerating = false;
      updateSendBtnState();
    }
  }

  function updateAllVersionControls(
    message
  ) {
    const wrap =
      messagesEl.querySelector(
        `.msg[data-message-id="${message.id}"]`
      );

    if (!wrap) return;

    const versions =
      wrap.querySelector(
        ".msg-versions"
      );

    if (!versions) return;

    const data =
      getVariantData(message);

    if (
      !data ||
      data.variants.length <= 1
    ) {
      versions.style.display =
        "none";
      return;
    }

    versions.style.display =
      "flex";

    const count =
      versions.querySelector(
        ".msg-version-count"
      );

    const prev =
      versions.querySelector(
        ".msg-version-arrow:first-child"
      );

    const next =
      versions.querySelector(
        ".msg-version-arrow:last-child"
      );

    if (count) {
      count.textContent =
        `${data.current + 1}/${data.variants.length}`;
    }

    if (prev) {
      prev.disabled =
        data.current <= 0;
    }

    if (next) {
      next.disabled =
        data.current >=
        data.variants.length - 1;
    }
  }

  /* =========================================================
     RENDER MESSAGES
     ========================================================= */

  function renderMessages() {
    const chat =
      getActiveChat();

    topbarTitleEl.textContent =
      chat.title;

    messagesEl.innerHTML = "";

    if (chat.messages.length === 0) {
      emptyStateEl.style.display =
        "block";

      return;
    }

    emptyStateEl.style.display =
      "none";

    chat.messages.forEach((m) => {
      const {
        wrap,
        textEl
      } =
        buildMessageShell(m);

      renderMarkdown(
        textEl,
        m.text,
        false
      );

      highlightCode(textEl);

      messagesEl.appendChild(wrap);

      if (m.role === "model") {
        ensureVariantData(m);
      }
    });

    scrollThreadToBottom();
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => {
      threadEl.scrollTop =
        threadEl.scrollHeight;
    });
  }

  /* =========================================================
     OPTIMIZED STREAMING
     ========================================================= */

  function streamText(
    textEl,
    fullText
  ) {
    return new Promise(
      (resolve) => {
        const len =
          fullText.length;

        const duration =
          Math.min(
            4000,
            Math.max(
              900,
              len * 16
            )
          );

        const start =
          performance.now();

        /*
          Instead of parsing Markdown on every
          animation frame, update approximately
          30 times/sec.
        */

        let lastRender = 0;

        function tick(now) {
          const elapsed =
            now - start;

          const p =
            Math.min(
              1,
              elapsed / duration
            );

          const eased =
            1 -
            Math.pow(
              1 - p,
              2
            );

          const cut =
            Math.floor(
              len * eased
            );

          if (
            now - lastRender >= 32 ||
            p >= 1
          ) {
            renderMarkdown(
              textEl,
              fullText.slice(
                0,
                cut
              ),
              p < 1
            );

            lastRender = now;

            threadEl.scrollTop =
              threadEl.scrollHeight;
          }

          if (p < 1) {
            requestAnimationFrame(
              tick
            );
          } else {
            renderMarkdown(
              textEl,
              fullText,
              false
            );

            highlightCode(textEl);

            threadEl.scrollTop =
              threadEl.scrollHeight;

            resolve();
          }
        }

        requestAnimationFrame(tick);
      }
    );
  }

  /* =========================================================
     TYPING
     ========================================================= */

  function showTyping() {
    brandDot.classList.add(
      "thinking"
    );

    emptyStateEl.style.display =
      "none";

    const wrap =
      document.createElement("div");

    wrap.className =
      "msg model";

    wrap.id = "typingRow";

    wrap.innerHTML = `
      <div class="msg-body">
        <div class="typing">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;

    messagesEl.appendChild(wrap);

    scrollThreadToBottom();
  }

  function hideTyping() {
    brandDot.classList.remove(
      "thinking"
    );

    const row =
      $("typingRow");

    if (row) row.remove();
  }

  /* =========================================================
     SEND
     ========================================================= */

  function autoResizeInput() {
    messageInput.style.height =
      "auto";

    messageInput.style.height =
      Math.min(
        messageInput.scrollHeight,
        180
      ) + "px";
  }

  function updateSendBtnState() {
    sendBtn.disabled =
      messageInput.value.trim()
        .length === 0 ||
      isGenerating;
  }

  async function sendMessage() {
    const text =
      messageInput.value.trim();

    if (!text || isGenerating)
      return;

    const chat =
      getActiveChat();

    if (
      chat.messages.length === 0 &&
      chat.title.startsWith("Чат")
    ) {
      chat.title =
        text.slice(0, 32) +
        (text.length > 32
          ? "…"
          : "");
    }

    chat.messages.push({
      role: "user",
      text,
      createdAt: Date.now(),
    });

    save();

    renderChatList();
    renderMessages();

    messageInput.value = "";

    autoResizeInput();
    updateSendBtnState();

    isGenerating = true;

    showTyping();

    try {
      const {
        answer,
        reasoning
      } = await getReply(chat);

      hideTyping();

      const msg = {
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        role: "model",
        text: answer,

        reasoning:
          reasoning || undefined,

        createdAt: Date.now(),
      };

      chat.messages.push(msg);

      save();

      const {
        wrap,
        textEl
      } =
        buildMessageShell(msg);

      messagesEl.appendChild(wrap);

      ensureVariantData(msg);

      scrollThreadToBottom();

      await streamText(
        textEl,
        answer
      );

    } catch (err) {
      console.error(
        "WAW: reply failed",
        err
      );

      hideTyping();

      const msg = {
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        role: "model",

        text:
          "не удалось получить ответ. попробуй ещё раз чуть позже",

        createdAt: Date.now(),
      };

      chat.messages.push(msg);

      save();

      const {
        wrap,
        textEl
      } =
        buildMessageShell(msg);

      messagesEl.appendChild(wrap);

      ensureVariantData(msg);

      await streamText(
        textEl,
        msg.text
      );

    } finally {
      isGenerating = false;

      updateSendBtnState();

      messageInput.focus();
    }
  }

  /* =========================================================
     API
     ========================================================= */

  function buildSystemPrompt() {
    const parts = [
      "Ты — WAW, дружелюбный ИИ-ассистент. Отвечай на языке пользователя, используй Markdown: заголовки, списки, **жирный**, код в ```блоках``` где уместно.",
    ];

    if (
      state.settings
        .personalInstruction
    ) {
      parts.push(
        "Персональная инструкция пользователя: " +
        state.settings
          .personalInstruction
      );
    }

    if (roleplayOn) {
      parts.push(
        "Стиль: живой, образный, с лёгкой эмоциональной окраской, как разговор с хорошим другом."
      );
    }

    if (reasoningOn) {
      parts.push(
        "Перед ответом напиши краткое рассуждение (1–2 предложения) в формате «Рассуждение: …», затем сам ответ после слова «Ответ: »."
      );
    }

    return parts.join("\n");
  }

  async function getReply(chat) {
    if (!API_ENDPOINT) {
      return demoReply(chat);
    }

    const history =
      chat.messages
        .filter((m) => m.text)
        .map((m) => ({
          role:
            m.role === "model"
              ? "assistant"
              : "user",

          content: m.text,
        }));

    const res =
      await fetch(
        API_ENDPOINT,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json",
          },

          body: JSON.stringify({
            messages: history,

            personalInstruction:
              state.settings
                .personalInstruction ||
              null,

            reasoning: reasoningOn,
            roleplay: roleplayOn,
          }),
        }
      );

    if (!res.ok) {
      const detail =
        await res
          .text()
          .catch(() => "");

      throw new Error(
        `API вернул ${res.status}: ${detail.slice(
          0,
          200
        )}`
      );
    }

    const data =
      await res.json();

    return parseReasoning(
      data.text ??
        "пустой ответ"
    );
  }

  function parseReasoning(raw) {
    if (!reasoningOn) {
      return {
        answer: raw.trim(),
        reasoning: undefined,
      };
    }

    const match =
      raw.match(
        /(?:рассуждение|reasoning|мысли|thinking)\s*:\s*([\s\S]*?)\s*(?:ответ|answer)\s*:\s*([\s\S]*)/i
      );

    if (match) {
      return {
        reasoning:
          match[1].trim(),

        answer:
          match[2].trim(),
      };
    }

    return {
      answer: raw.trim(),
      reasoning: undefined,
    };
  }

  function demoReply(chat) {
    const lastUser =
      [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "user"
        );

    const userText =
      lastUser
        ? lastUser.text
        : "";

    const delay =
      500 +
      Math.random() * 700;

    const openers =
      roleplayOn
        ? [
            "хм, дай подумать вместе с тобой —",
            "о, интересный вопрос!",
            "ладно, слушай сюда:",
          ]
        : ["", "", ""];

    const opener =
      openers[
        Math.floor(
          Math.random() *
            openers.length
        )
      ];

    const answer = `это **демо-режим** WAW прямо в браузере. скоро подключим настоящий API, и я буду отвечать как живой. ${
      opener
        ? opener + " "
        : ""
    }пока могу только отразить то, что ты написал: «${truncate(
      userText,
      160
    )}»

\`\`\`
подключение появится позже
\`\`\``;

    let reasoning;

    if (reasoningOn) {
      reasoning =
        "пока нет подключённого API — формирую заглушку на основе последнего сообщения";
    }

    return new Promise(
      (resolve) => {
        setTimeout(
          () =>
            resolve({
              answer,
              reasoning,
            }),
          delay
        );
      }
    );
  }

  function truncate(str, n) {
    return str.length > n
      ? str.slice(0, n).trim() +
          "…"
      : str;
  }

  /* =========================================================
     TOGGLES
     ========================================================= */

  function setToggle(
    btn,
    on
  ) {
    btn.setAttribute(
      "aria-pressed",
      on ? "true" : "false"
    );
  }

  reasoningToggle.addEventListener(
    "click",
    () => {
      reasoningOn =
        !reasoningOn;

      setToggle(
        reasoningToggle,
        reasoningOn
      );
    }
  );

  roleplayToggle.addEventListener(
    "click",
    () => {
      roleplayOn =
        !roleplayOn;

      setToggle(
        roleplayToggle,
        roleplayOn
      );
    }
  );

  /* =========================================================
     SIDEBAR
     ========================================================= */

  function openSidebar() {
    sidebarEl.classList.add(
      "open"
    );

    sidebarScrim.classList.add(
      "open"
    );
  }

  function closeSidebar() {
    sidebarEl.classList.remove(
      "open"
    );

    sidebarScrim.classList.remove(
      "open"
    );
  }

  function closeSidebarOnMobile() {
    if (
      window.innerWidth <= 840
    ) {
      closeSidebar();
    }
  }

  openSidebarBtn.addEventListener(
    "click",
    openSidebar
  );

  closeSidebarBtn.addEventListener(
    "click",
    closeSidebar
  );

  sidebarScrim.addEventListener(
    "click",
    closeSidebar
  );

  /* =========================================================
     SETTINGS
     ========================================================= */

  function openSettings() {
    populateSettingsForm();

    settingsPanel.classList.add(
      "open"
    );

    settingsPanel.setAttribute(
      "aria-hidden",
      "false"
    );

    settingsScrim.classList.add(
      "open"
    );
  }

  function closeSettings() {
    settingsPanel.classList.remove(
      "open"
    );

    settingsPanel.setAttribute(
      "aria-hidden",
      "true"
    );

    settingsScrim.classList.remove(
      "open"
    );
  }

  settingsBtn.addEventListener(
    "click",
    openSettings
  );

  closeSettingsBtn.addEventListener(
    "click",
    closeSettings
  );

  settingsScrim.addEventListener(
    "click",
    closeSettings
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        closeSettings();
        closeSidebar();
      }
    }
  );

  /* =========================================================
     SETTINGS UI
     ========================================================= */

  function populateSettingsForm() {
    displayNameInput.value =
      state.settings.displayName;

    personalInstructionInput.value =
      state.settings
        .personalInstruction;

    piCount.textContent =
      String(
        state.settings
          .personalInstruction
          .length
      );

    themeSegmented
      .querySelectorAll(
        "button"
      )
      .forEach((b) => {
        b.classList.toggle(
          "active",
          b.dataset.theme ===
            state.settings.theme
        );
      });

    themeSegmented.dataset.active =
      state.settings.theme;

    document
      .querySelectorAll(
        ".swatch"
      )
      .forEach((sw) => {
        sw.classList.toggle(
          "active",
          sw.dataset.accent ===
            state.settings.accent
        );
      });

    setSwitch(
      reasoningDefaultSwitch,
      state.settings
        .reasoningDefault
    );

    setSwitch(
      roleplayDefaultSwitch,
      state.settings
        .roleplayDefault
    );
  }

  function setSwitch(
    el,
    on
  ) {
    el.setAttribute(
      "aria-checked",
      on ? "true" : "false"
    );
  }

  displayNameInput.addEventListener(
    "input",
    () => {
      state.settings.displayName =
        displayNameInput.value.trim() ||
        "Ты";

      save();

      applyProfileToUI();
    }
  );

  personalInstructionInput.addEventListener(
    "input",
    () => {
      const val =
        personalInstructionInput.value.slice(
          0,
          2000
        );

      state.settings.personalInstruction =
        val;

      piCount.textContent =
        String(val.length);

      save();
    }
  );

  /* =========================================================
     THEME RIPPLE
     ========================================================= */

  function getRippleColor(theme) {
    if (theme === "light") {
      return getComputedStyle(
        document.documentElement
      ).getPropertyValue(
        "--surface"
      );
    }

    return getComputedStyle(
      document.documentElement
    ).getPropertyValue(
      "--bg"
    );
  }

  function createThemeRipple(
    x,
    y,
    color
  ) {
    const ripple =
      document.createElement(
        "div"
      );

    ripple.className =
      "theme-ripple";

    ripple.style.left =
      `${x}px`;

    ripple.style.top =
      `${y}px`;

    ripple.style.setProperty(
      "--theme-ripple-color",
      color
    );

    document.body.appendChild(
      ripple
    );

    ripple.addEventListener(
      "animationend",
      () => ripple.remove(),
      { once: true }
    );
  }

  function animateThemeChange(
  sourceElement,
  apply
) {
  const rect =
    sourceElement?.getBoundingClientRect();

  // Сначала применяем НОВУЮ тему
  apply();

  if (!rect) return;

  // Теперь получаем цвет уже НОВОЙ темы
  const newBg =
    getComputedStyle(
      document.body
    ).backgroundColor;

  createThemeRipple(
    rect.left +
      rect.width / 2,

    rect.top +
      rect.height / 2,

    newBg
  );
}

  /* =========================================================
     THEME CHANGE
     ========================================================= */

  themeSegmented.addEventListener(
    "click",
    (e) => {
      const btn =
        e.target.closest(
          "button[data-theme]"
        );

      if (!btn) return;

      const nextTheme =
        btn.dataset.theme;

      if (
        nextTheme ===
        state.settings.theme
      ) {
        return;
      }

      animateThemeChange(
        btn,
        () => {
          state.settings.theme =
            nextTheme;

          save();

          applyTheme();
          populateSettingsForm();
        }
      );
    }
  );

  /* =========================================================
     ACCENT CHANGE
     ========================================================= */

  accentSwatches.addEventListener(
    "click",
    (e) => {
      const btn =
        e.target.closest(
          ".swatch"
        );

      if (!btn) return;

      const nextAccent =
        btn.dataset.accent;

      if (
        nextAccent ===
        state.settings.accent
      ) {
        return;
      }

      /*
        Небольшая волна от выбранного
        прямоугольника. Сам selector
        при этом плавно перестраивается.
      */

      animateAccentChange(
        btn,
        () => {
          state.settings.accent =
            nextAccent;

          save();

          applyTheme();
          populateSettingsForm();
        }
      );
    }
  );

function animateAccentChange(
  sourceElement,
  apply
) {
  const rect =
    sourceElement.getBoundingClientRect();

  // Сначала применяем НОВЫЙ акцент
  apply();

  // Получаем уже НОВЫЙ цвет
  const newAccent =
    getComputedStyle(
      document.documentElement
    ).getPropertyValue(
      "--accent"
    );

  const pulse =
    document.createElement(
      "div"
    );

  pulse.className =
    "theme-ripple";

  pulse.style.left =
    `${rect.left +
      rect.width / 2}px`;

  pulse.style.top =
    `${rect.top +
      rect.height / 2}px`;

  pulse.style.setProperty(
    "--theme-ripple-color",
    newAccent
  );

  document.body.appendChild(
    pulse
  );

  pulse.addEventListener(
    "animationend",
    () => pulse.remove(),
    { once: true }
  );
}

  /* =========================================================
     DEFAULT SWITCHES
     ========================================================= */

  reasoningDefaultSwitch.addEventListener(
    "click",
    () => {
      const on =
        reasoningDefaultSwitch.getAttribute(
          "aria-checked"
        ) !== "true";

      state.settings.reasoningDefault =
        on;

      save();

      setSwitch(
        reasoningDefaultSwitch,
        on
      );
    }
  );

  roleplayDefaultSwitch.addEventListener(
    "click",
    () => {
      const on =
        roleplayDefaultSwitch.getAttribute(
          "aria-checked"
        ) !== "true";

      state.settings.roleplayDefault =
        on;

      save();

      setSwitch(
        roleplayDefaultSwitch,
        on
      );
    }
  );

  /* =========================================================
     WIPE DATA
     ========================================================= */

  wipeDataBtn.addEventListener(
    "click",
    () => {
      if (
        !confirm(
          "Удалить все чаты и настройки без возможности восстановления?"
        )
      ) {
        return;
      }

      localStorage.removeItem(
        STORAGE_KEY
      );

      responseVariants.clear();

      state =
        defaultState();

      reasoningOn =
        state.settings
          .reasoningDefault;

      roleplayOn =
        state.settings
          .roleplayDefault;

      save();

      closeSettings();

      applyTheme();
      applyProfileToUI();

      renderAll();
    }
  );

  /* =========================================================
     APPLY THEME
     ========================================================= */

  function applyTheme() {
    document.documentElement.setAttribute(
      "data-accent",
      state.settings.accent
    );

    document.body.classList.toggle(
      "light",
      state.settings.theme ===
        "light"
    );

    themeSegmented.dataset.active =
      state.settings.theme;
  }

  /* =========================================================
     PROFILE
     ========================================================= */

  function applyProfileToUI() {
    userDisplayName.textContent =
      state.settings
        .displayName || "Ты";

    userAvatar.textContent =
      (
        state.settings
          .displayName ||
        "Т"
      )
        .trim()
        .charAt(0)
        .toUpperCase() || "Т";
  }

  /* =========================================================
     CHAT CONTROLS
     ========================================================= */

  newChatBtn.addEventListener(
    "click",
    createChat
  );

  deleteChatBtn.addEventListener(
    "click",
    () => {
      const chat =
        getActiveChat();

      if (
        confirm(
          `Удалить «${chat.title}»?`
        )
      ) {
        deleteChat(
          state.activeChatId
        );
      }
    }
  );

  messageInput.addEventListener(
    "input",
    () => {
      autoResizeInput();
      updateSendBtnState();
    }
  );

  messageInput.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Enter" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        sendMessage();
      }
    }
  );

  sendBtn.addEventListener(
    "click",
    sendMessage
  );

  /* =========================================================
     INIT
     ========================================================= */

  function renderAll() {
    renderChatList();
    renderMessages();
  }

  applyTheme();
  applyProfileToUI();

  setToggle(
    reasoningToggle,
    reasoningOn
  );

  setToggle(
    roleplayToggle,
    roleplayOn
  );

  renderAll();
  updateSendBtnState();

})();