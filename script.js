(() => {
  "use strict";

  const STORAGE_KEY = "waw_web_state_v1";
  const SETTINGS_KEY = "waw_settings_v1";
  const MIGRATED_KEY = "waw_migrated_v1";
  const DECLINED_KEY = "waw_migration_declined_v1";
  const LAST_CHAT_KEY = "waw_last_chat_v1";
  const API_ENDPOINT = "https://forwaw-ai.ervin-mandarin.workers.dev/chat";
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1280;
  const MAX_PDF_BYTES = 4 * 1024 * 1024;
  const MAX_TEXT_FILE_BYTES = 300 * 1024;
  const MAX_TEXT_CHARS = 30000;
  const MAX_ATTACH_CHARS = 8500000;
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|toml|ini|log|html?|css|scss|jsx?|mjs|tsx?|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|swift|sh|bat|sql|lua|dart|vue|svelte|tex|srt)$/i;

  const ACCENT_ICONS = {
    violet: "mainicon2.png",
    magenta: "mainicon3.png",
    indigo: "mainicon5.png",
    pine: "mainicon.png",
    cosmic: "mainicon6.png",
    rose: "mainicon4.png",
  };

  const uid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  let lastTs = 0;
  const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1));

  /* ===== МОДЕЛИ ===== */
  const MODELS = [
    { id: "waw-1.3", name: "WAW 1.3", tier: "fast", badge: "быстрая", desc: "самые быстрые и короткие ответы" },
    { id: "waw-1.7-extra", name: "WAW 1.7 Extra", tier: "std", badge: "", desc: "универсальная модель для повседневных задач" },
    { id: "waw-2.0-pro", name: "WAW 2.0 Pro", tier: "pro", badge: "новая", desc: "самая продвинутая и новая модель", note: "может быть занята в пиковые часы" },
  ];
  const DEFAULT_MODEL = "waw-1.3";

  /* ===== STORAGE ===== */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.chats) || parsed.chats.length === 0) return null;
        parsed.settings = Object.assign(defaultState().settings, parsed.settings || {});
        if (!parsed.chats.some((c) => c.id === parsed.activeChatId)) parsed.activeChatId = parsed.chats[0].id;
        parsed.chats.forEach((c) => { if (!Array.isArray(c.messages)) c.messages = []; });
        return parsed;
      }
    } catch (e) { console.warn("WAW: failed to read stored state", e); }
    return null;
  }

  function makeChat(index) { return { id: uid(), title: `Диалог ${index}`, messages: [] }; }

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
        model: DEFAULT_MODEL,
        streamingEnabled: true,
      },
    };
  }

  let state = loadState() || defaultState();

  try {
    const ov = localStorage.getItem(SETTINGS_KEY);
    if (ov) Object.assign(state.settings, JSON.parse(ov));
  } catch (e) { console.warn("WAW: bad settings override", e); }

  if (typeof state.settings.streamingEnabled !== "boolean") {
    state.settings.streamingEnabled = true;
  }

  const localChatsOriginal = (state.chats || []).filter((c) => c && Array.isArray(c.messages) && c.messages.length > 0);

  {
    const blank = makeChat(1);
    state.chats = [blank];
    state.activeChatId = blank.id;
  }
  if (!MODELS.some((m) => m.id === state.settings.model)) state.settings.model = DEFAULT_MODEL;

  let reasoningOn = state.settings.reasoningDefault;
  let roleplayOn = state.settings.roleplayDefault;
  let isGenerating = false;
  let typingChatId = null;
  let pendingImage = null;
  let cloudUser = null;
  let bootstrapId = null;
  let currentThinkingEl = null;
  let currentAbortController = null;
  const chatQueues = new WeakMap();
  const loadingChats = new WeakMap();
  const Cloud = window.WAWCloud;

  function save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
    catch (e) { console.warn("WAW: failed to persist settings", e); }
  }

  function getActiveChat() {
    return state.chats.find((c) => c.id === state.activeChatId) || state.chats[0];
  }

  const PINNED_KEY = "waw_pinned_v1";
  function pinnedMap() { return readJson(PINNED_KEY, {}); }
  function orderedChats() {
    const p = pinnedMap();
    return [...state.chats].sort((a, b) => (p[b.id] ? 1 : 0) - (p[a.id] ? 1 : 0));
  }
  function togglePin(id) {
    const p = pinnedMap();
    if (p[id]) delete p[id]; else p[id] = true;
    writeJson(PINNED_KEY, p);
    renderChatList();
  }

  /* ===== DOM ===== */
  const $ = (id) => document.getElementById(id);

  const chatListEl = $("chatList");
  const messagesEl = $("messages");
  const emptyStateEl = $("emptyState");
  const threadEl = $("thread");
  const topbarTitleEl = $("topbarTitle");
  const messageInput = $("messageInput");
  const sendBtn = $("sendBtn");
  const brandDot = document.querySelector(".brand-dot");
  const mainEl = document.querySelector(".main");
  const composerWrap = document.querySelector(".composer-wrap");

  const modelBtn = $("modelBtn");
  const modelLabel = $("modelLabel");
  const modelScrim = $("modelScrim");
  const modelSheet = $("modelSheet");
  const modelList = $("modelList");

  const sidebarEl = $("sidebar");
  const sidebarScrim = $("sidebarScrim");
  const openSidebarBtn = $("openSidebarBtn");
  const closeSidebarBtn = $("closeSidebarBtn");

  const newChatBtn = $("newChatBtn");
  const deleteChatBtn = $("deleteChatBtn");

  const reasoningToggle = $("reasoningToggle");
  const roleplayToggle = $("roleplayToggle");

  const attachBtn = $("attachBtn");
  const fileInput = $("fileInput");
  const cameraInput = $("cameraInput");
  const cameraBtn = $("cameraBtn");
  const attachPreview = $("attachPreview");
  const attachPreviewImg = $("attachPreviewImg");
  const attachFile = $("attachFile");
  const attachFileName = $("attachFileName");
  const attachEdit = $("attachEdit");
  const attachRemove = $("attachRemove");

  const settingsBtn = $("settingsBtn");
  const settingsScrim = $("settingsScrim");
  const settingsPanel = $("settingsPanel");
  const closeSettingsBtn = $("closeSettingsBtn");

  const displayNameInput = $("displayNameInput");
  const userDisplayName = $("userDisplayName");
  const userAvatar = $("userAvatar");

  const personalInstructionInput = $("personalInstructionInput");
  const piCount = $("piCount");
  const accentSwatches = $("accentSwatches");
  const themeSegmented = $("themeSegmented");

  const streamingSwitch = $("streamingSwitch");
  const reasoningDefaultSwitch = $("reasoningDefaultSwitch");
  const roleplayDefaultSwitch = $("roleplayDefaultSwitch");

  const wipeDataBtn = $("wipeDataBtn");
  const accountEmailEl = $("accountEmail");
  const signOutBtn = $("signOutBtn");
  const importLocalBtn = $("importLocalBtn");
  const toastEl = $("wawToast");

  const wawModalScrim = $("wawModalScrim");
  const wawModalTitle = $("wawModalTitle");
  const wawModalText = $("wawModalText");
  const wawModalCancel = $("wawModalCancel");
  const wawModalConfirm = $("wawModalConfirm");

  let modalResolver = null;

  function showConfirm(title, text, confirmLabel, opts) {
    const o = opts || {};
    wawModalTitle.textContent = title;
    wawModalText.textContent = text;
    wawModalConfirm.textContent = confirmLabel || "Удалить";
    wawModalConfirm.classList.toggle("danger", !o.primary);
    wawModalConfirm.classList.toggle("primary", !!o.primary);
    wawModalCancel.textContent = o.cancelLabel || "Отмена";
    wawModalScrim.classList.add("open");
    return new Promise((resolve) => { modalResolver = resolve; });
  }

  function closeModal(result) {
    wawModalScrim.classList.remove("open");
    if (modalResolver) { modalResolver(result); modalResolver = null; }
  }

  wawModalCancel.addEventListener("click", () => closeModal(false));
  wawModalConfirm.addEventListener("click", () => closeModal(true));
  wawModalScrim.addEventListener("click", (e) => {
    if (e.target === wawModalScrim) closeModal(false);
  });

  /* ===== MARKDOWN ===== */
  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function renderMarkdown(el, text, withCaret) {
    const caret = withCaret ? '<span class="stream-caret"></span>' : "";
    if (window.marked && window.DOMPurify) {
      const parse = marked.parse || marked;
      const html = parse(text, { breaks: true, gfm: true });
      el.innerHTML = DOMPurify.sanitize(html, {
        ADD_ATTR: ["target", "data-icon"],
        ADD_TAGS: ["i"],
      }) + caret;
      if (window.WAW_enhanceIcons) window.WAW_enhanceIcons(el);
    } else {
      el.textContent = text + (withCaret ? "▌" : "");
    }
  }

  function highlightCode(root) {
    if (!window.hljs) return;
    root.querySelectorAll("pre code").forEach((block) => {
      try { hljs.highlightElement(block); } catch (e) {}
    });
    addCodeCopyButtons(root);
  }

  function addCodeCopyButtons(root) {
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy-btn";
      btn.setAttribute("aria-label", "Скопировать код");
      btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const code = pre.querySelector("code");
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code.textContent);
          btn.classList.add("copied");
          btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>';
          setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
          }, 1500);
        } catch (err) { console.warn("WAW: copy code failed", err); }
      });

      pre.style.position = "relative";
      pre.appendChild(btn);
    });
  }

  /* ===== RENAME ===== */
  function startRenameChat(chat, titleEl) {
    const current = chat.title;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-rename-input";
    input.value = current;
    input.maxLength = 60;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    function commit(ok) {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (ok && val && val !== current) {
        chat.title = val;
        save();
        cloudRename(chat);
        if (chat.id === state.activeChatId) topbarTitleEl.textContent = chat.title;
      }
      renderChatList();
    }

    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  /* ===== CHAT LIST ===== */
  function renderChatList() {
    chatListEl.innerHTML = "";
    orderedChats().forEach((chat) => {
      const item = document.createElement("div");
      item.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
      item.tabIndex = 0;
      item.setAttribute("role", "button");

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = chat.title;

      const actions = document.createElement("div");
      actions.className = "chat-actions";

      const edit = document.createElement("button");
      edit.className = "chat-action edit";
      edit.setAttribute("aria-label", "Переименовать диалог");
      edit.title = "Переименовать";
      edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      edit.addEventListener("click", (e) => { e.stopPropagation(); startRenameChat(chat, title); });

      const del = document.createElement("button");
      del.className = "chat-action del";
      del.setAttribute("aria-label", "Удалить диалог");
      del.title = "Удалить";
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/></svg>';
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm("Удалить диалог?", `«${chat.title}» будет удалён вместе с историей.`, "Удалить");
        if (ok) deleteChat(chat.id);
      });

      if (pinnedMap()[chat.id]) item.classList.add("pinned");

      const pin = document.createElement("button");
      pin.className = "chat-action pin" + (pinnedMap()[chat.id] ? " on" : "");
      pin.setAttribute("aria-label", "Закрепить диалог");
      pin.title = "Закрепить";
      pin.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/></svg>';
      pin.addEventListener("click", (e) => { e.stopPropagation(); togglePin(chat.id); });
      actions.appendChild(pin);
      actions.appendChild(edit);
      actions.appendChild(del);
      item.appendChild(title);
      item.appendChild(actions);

      item.addEventListener("click", () => selectChat(chat.id));
      item.addEventListener("keydown", (e) => {
        if (e.target !== item) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectChat(chat.id); }
      });

      chatListEl.appendChild(item);
    });
  }

  function selectChat(chatId) {
    state.activeChatId = chatId;
    const chat = getActiveChat();
    if (chat) chat.loadFailed = false;
    rememberActiveChat();
    save();
    renderAllAndLoad();
    closeSidebarOnMobile();
  }

  function createChat() {
    const empty = state.chats.find((c) => !c.persisted && c.messages.length === 0);
    if (empty) {
      state.activeChatId = empty.id;
      renderAll();
      closeSidebarOnMobile();
      messageInput.focus();
      return;
    }
    const chat = makeChat(state.chats.length + 1);
    state.chats.push(chat);
    state.activeChatId = chat.id;
    save();
    renderAll();
    closeSidebarOnMobile();
    messageInput.focus();
  }

  function deleteChat(chatId) {
    const target = state.chats.find((c) => c.id === chatId);
    if (target) cloudDelete(target);
    const wasActive = chatId === state.activeChatId;
    state.chats = state.chats.filter((c) => c.id !== chatId);
    if (state.chats.length === 0) {
      const replacement = makeChat(1);
      state.chats = [replacement];
      state.activeChatId = replacement.id;
    } else if (wasActive) {
      state.activeChatId = state.chats[0].id;
    }
    save();
    renderAllAndLoad();
  }

  /* ===== VARIANTS ===== */
  function ensureVariants(m) {
    if (!Array.isArray(m.variants) || m.variants.length === 0) {
      m.variants = [{ text: m.text, reasoning: m.reasoning }];
      m.vIndex = 0;
    }
    if (typeof m.vIndex !== "number") m.vIndex = m.variants.length - 1;
    return m;
  }

  function setVariant(m, i) {
    ensureVariants(m);
    m.vIndex = i;
    m.text = m.variants[i].text;
    m.reasoning = m.variants[i].reasoning;
  }

  /* ===== MESSAGE SHELL ===== */
  function buildMessageShell(m) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "model");
    if (m.role === "model") wrap.dataset.messageId = m.id || "";

    const body = document.createElement("div");
    body.className = "msg-body";

    if (m.image && m.image.startsWith("data:image/")) {
      const img = document.createElement("img");
      img.src = m.image;
      img.className = "msg-image";
      img.alt = "";
      body.appendChild(img);
    }

    if (m.reasoning) {
      const reasoning = document.createElement("div");
      reasoning.className = "reasoning-block";
      reasoning.textContent = m.reasoning;
      body.appendChild(reasoning);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    body.appendChild(textEl);

    wrap.appendChild(body);

    if (m.role === "model") {
      body.appendChild(createMessageActions(m, body));
    } else if (m.role === "user") {
      body.appendChild(createUserActions(m, body));
    }

    return { wrap, body, textEl };
  }

  function createIcon(path) { return `<svg viewBox="0 0 24 24">${path}</svg>`; }

  function createUserActions(message, body) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "msg-action";
    editBtn.title = "Редактировать";
    editBtn.setAttribute("aria-label", "Редактировать");
    editBtn.innerHTML = createIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>');
    editBtn.addEventListener("click", () => startEditUserMessage(message, body));
    actions.appendChild(editBtn);

    return actions;
  }

  function createMessageActions(message, body) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action";
    copyBtn.title = "Скопировать";
    copyBtn.innerHTML = createIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>');
    copyBtn.addEventListener("click", () => copyMessage(message, body, copyBtn));

    const likeBtn = document.createElement("button");
    likeBtn.className = "msg-action";
    likeBtn.title = "Нравится";
    likeBtn.innerHTML = createIcon('<path d="M7 10v10H4a2 2 0 01-2-2v-6a2 2 0 012-2h3z"/><path d="M7 20h9.5a2 2 0 001.9-1.4l2-7A2 2 0 0018.5 9H14l.7-3.2A2.3 2.3 0 0012.5 3L7 10"/>');

    const dislikeBtn = document.createElement("button");
    dislikeBtn.className = "msg-action";
    dislikeBtn.title = "Не нравится";
    dislikeBtn.innerHTML = createIcon('<path d="M7 14V4H4a2 2 0 00-2 2v6a2 2 0 002 2h3z"/><path d="M7 4h9.5a2 2 0 011.9 1.4l2 7A2 2 0 0118.5 15H14l.7 3.2a2.3 2.3 0 01-2.2 2.8L7 14"/>');

    likeBtn.addEventListener("click", () => {
      likeBtn.classList.toggle("active-like");
      dislikeBtn.classList.remove("active-dislike");
    });
    dislikeBtn.addEventListener("click", () => {
      dislikeBtn.classList.toggle("active-dislike");
      likeBtn.classList.remove("active-like");
    });

    const retryBtn = document.createElement("button");
    retryBtn.className = "msg-action retry";
    retryBtn.title = "Переписать ответ";
    retryBtn.innerHTML = createIcon('<path d="M20 11a8.1 8.1 0 00-14.9-4L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8.1 8.1 0 0014.9 4L21 14"/><path d="M21 20v-6h-6"/>');
    retryBtn.addEventListener("click", () => retryMessage(message));

    const versions = document.createElement("div");
    versions.className = "msg-versions";
    const prevBtn = document.createElement("button");
    prevBtn.className = "msg-version-arrow";
    prevBtn.innerHTML = "‹";
    const count = document.createElement("span");
    count.className = "msg-version-count";
    const nextBtn = document.createElement("button");
    nextBtn.className = "msg-version-arrow";
    nextBtn.innerHTML = "›";
    versions.appendChild(prevBtn);
    versions.appendChild(count);
    versions.appendChild(nextBtn);

    function updateVersionControls() {
      const total = message.variants ? message.variants.length : 1;
      if (total <= 1) { versions.style.display = "none"; return; }
      const cur = message.vIndex ?? total - 1;
      versions.style.display = "flex";
      count.textContent = `${cur + 1}/${total}`;
      prevBtn.disabled = cur <= 0;
      nextBtn.disabled = cur >= total - 1;
    }

    function shift(delta) {
      ensureVariants(message);
      const next = message.vIndex + delta;
      if (next < 0 || next >= message.variants.length) return;
      setVariant(message, next);
      save();
      cloudPatchMessage(message);
      renderVariantInPlace(message, body);
      updateVersionControls();
    }

    prevBtn.addEventListener("click", () => shift(-1));
    nextBtn.addEventListener("click", () => shift(1));
    body._updateVersions = updateVersionControls;

    actions.appendChild(copyBtn);
    actions.appendChild(likeBtn);
    actions.appendChild(dislikeBtn);
    actions.appendChild(retryBtn);
    actions.appendChild(versions);

    updateVersionControls();
    return actions;
  }

  function renderVariantInPlace(message, body, withCaret) {
    const textEl = body.querySelector(".msg-text");
    if (!textEl) return;

    let reasoning = body.querySelector(".reasoning-block");
    if (message.reasoning) {
      if (!reasoning) {
        reasoning = document.createElement("div");
        reasoning.className = "reasoning-block";
        body.insertBefore(reasoning, textEl);
      }
      reasoning.textContent = message.reasoning;
    } else if (reasoning) {
      reasoning.remove();
    }

    renderMarkdown(textEl, message.text || "", !!withCaret);
    if (!withCaret) highlightCode(textEl);
  }

  async function copyMessage(message, body, button) {
    try {
      await navigator.clipboard.writeText(message.text);
      body.classList.remove("copy-flash");
      void body.offsetWidth;
      body.classList.add("copy-flash");
      setTimeout(() => body.classList.remove("copy-flash"), 850);
      const old = button.innerHTML;
      button.innerHTML = createIcon('<path d="M5 12l4 4L19 6"/>');
      setTimeout(() => { button.innerHTML = old; }, 1000);
    } catch (err) { console.warn("WAW: clipboard failed", err); }
  }

  /* ===== EDIT USER MESSAGE ===== */
  function startEditUserMessage(message, body) {
    if (isGenerating) { toast("дождись окончания ответа", true); return; }
    const textEl = body.querySelector(".msg-text");
    if (!textEl) return;
    const current = message.text;
    const ta = document.createElement("textarea");
    ta.className = "edit-textarea";
    ta.value = current;
    ta.rows = Math.min(6, Math.max(2, current.split("\n").length));

    textEl.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML = '<button class="edit-save" type="button">Сохранить</button><button class="edit-cancel" type="button">Отмена</button>';
    body.appendChild(actions);

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
    });

    actions.querySelector(".edit-save").addEventListener("click", commit);
    actions.querySelector(".edit-cancel").addEventListener("click", cancel);

    function cleanup() {
      ta.remove();
      actions.remove();
    }

    function cancel() {
      cleanup();
      textEl.textContent = current;
      body.insertBefore(textEl, body.firstChild);
      renderMarkdown(textEl, current, false);
      highlightCode(textEl);
    }

    async function commit() {
      const newText = ta.value.trim();
      if (!newText || newText === current) { cancel(); return; }
      cleanup();
      textEl.textContent = newText;
      body.insertBefore(textEl, body.firstChild);
      renderMarkdown(textEl, newText, false);
      highlightCode(textEl);

      message.text = newText;

      const chat = getActiveChat();
      const idx = chat.messages.findIndex((m) => m.id === message.id);
      const dropped = idx >= 0 ? chat.messages.slice(idx + 1) : [];
      if (idx >= 0) chat.messages = chat.messages.slice(0, idx + 1);
      save();
      cloudPatchMessage(message);
      cloudDeleteMessages(chat, dropped.map((m) => m.id).filter(Boolean));
      renderChatList();
      renderMessages();

      isGenerating = true;
      typingChatId = chat.id;
      updateSendBtnState();
      renderMessages();

      const modelMsg = {
        id: uid(),
        role: "model",
        text: "",
        model: state.settings.model,
        createdAt: nextTs(),
      };

      let shell = null;

      const painter = createLivePainter((raw) => {
        if (state.activeChatId !== chat.id) return;
        if (shell && !shell.wrap.isConnected) shell = null;
        const live = splitReasoning(raw, true);
        if (!shell) {
          hideTyping();
          shell = buildMessageShell(modelMsg);
          shell.wrap.classList.add("streaming");
          messagesEl.appendChild(shell.wrap);
        }
        const stick = isNearBottom();
        renderVariantInPlace({ text: live.answer, reasoning: live.reasoning }, shell.body, true);
        if (stick) threadEl.scrollTop = threadEl.scrollHeight;
      });

      try {
        const raw = await requestReply(chat, null, painter.push);
        painter.stop();
        const res = splitReasoning(raw, false);
        modelMsg.text = res.answer;
        modelMsg.reasoning = res.reasoning;
        ensureVariants(modelMsg);
        chat.messages.push(modelMsg);
        save();
        cloudSaveMessage(chat, modelMsg);

        if (state.activeChatId !== chat.id) return;
        hideTyping();
        if (shell && !shell.wrap.isConnected) shell = null;
        if (!shell) { shell = buildMessageShell(modelMsg); messagesEl.appendChild(shell.wrap); }
        shell.wrap.classList.remove("streaming");
        renderVariantInPlace(modelMsg, shell.body, false);
        scrollThreadToBottom();
      } catch (err) {
        painter.stop();
        console.error("WAW: edit->reply failed", err);
        hideTyping();
        if (!(err && err.name === "AbortError")) toast("не удалось получить ответ: " + (err && err.message ? err.message : "ошибка"), true);
      } finally {
        painter.stop();
        hideTyping();
        isGenerating = false;
        typingChatId = null;
        updateSendBtnState();
      }
    }
  }

  async function retryMessage(originalMessage) {
    if (isGenerating) return;
    const chat = getActiveChat();
    const index = chat.messages.findIndex((m) => m.id === originalMessage.id);
    if (index === -1) return;
    if (!chat.messages.slice(0, index).some((m) => m.role === "user")) return;

    const wrap = messagesEl.querySelector(`.msg[data-message-id="${originalMessage.id}"]`);
    const body = wrap && wrap.querySelector(".msg-body");
    const textEl = wrap && wrap.querySelector(".msg-text");
    if (!body || !textEl) return;

    isGenerating = true;
    updateSendBtnState();
    wrap.classList.add("streaming");
    textEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;

    const painter = createLivePainter((raw) => {
      if (!wrap.isConnected) return;
      const live = splitReasoning(raw, true);
      const stick = isNearBottom();
      renderVariantInPlace({ text: live.answer, reasoning: live.reasoning }, body, true);
      if (stick) threadEl.scrollTop = threadEl.scrollHeight;
    });

    try {
      const raw = await requestReply(chat.messages.slice(0, index), null, painter.push);
      painter.stop();
      const result = splitReasoning(raw, false);
      const variant = { text: result.answer, reasoning: result.reasoning };

      if (originalMessage.error) {
        originalMessage.error = false;
        originalMessage.variants = [variant];
        originalMessage.vIndex = 0;
      } else {
        ensureVariants(originalMessage);
        originalMessage.variants.push(variant);
        originalMessage.vIndex = originalMessage.variants.length - 1;
      }
      setVariant(originalMessage, originalMessage.vIndex);
      cloudPatchMessage(originalMessage);

      renderVariantInPlace(originalMessage, body, false);
      if (body._updateVersions) body._updateVersions();
      save();
      scrollThreadToBottom();
    } catch (err) {
      painter.stop();
      console.error("WAW: retry failed", err);
      renderVariantInPlace(originalMessage, body, false);
      if (!(err && err.name === "AbortError")) toast("не удалось переписать ответ: " + (err && err.message ? err.message : "ошибка"), true);
    } finally {
      wrap.classList.remove("streaming");
      isGenerating = false;
      updateSendBtnState();
    }
  }

  /* ===== ПРИВЕТСТВИЕ ===== */
  const EMPTY_GREETINGS = [
    "не хочешь поговорить?", "о чём поговорим?", "с чего начнём?", "я тут. что скажешь?",
    "есть что обсудить?", "давай поболтаем", "как ты сегодня?", "что на душе?",
    "как настроение?", "что нового?", "ну что, поговорим?", "я слушаю",
    "давай, удиви меня", "рассказывай", "о чём думаешь?", "что тебя занимает?",
    "есть мысли?", "я на связи", "waw тут. чем займёмся?", "я готов слушать",
  ];

  function pickGreeting() {
    const name = state.settings.displayName && state.settings.displayName !== "Ты"
      ? state.settings.displayName : null;
    const phrase = EMPTY_GREETINGS[Math.floor(Math.random() * EMPTY_GREETINGS.length)];
    if (name && Math.random() < 0.3) return `${name}, ${phrase}`;
    return phrase;
  }

  /* ===== RENDER MESSAGES ===== */
  function renderMessages() {
    const chat = getActiveChat();
    topbarTitleEl.textContent = chat.title;
    messagesEl.innerHTML = "";
    currentThinkingEl = null;

    if (chat.persisted && !chat.loaded) {
      emptyStateEl.style.display = "none";
      const note = document.createElement("div");
      note.className = "chat-loading";
      note.textContent = chat.loadFailed ? "не получилось загрузить диалог. выбери его ещё раз" : "загружаю диалог…";
      messagesEl.appendChild(note);
      return;
    }

    if (chat.messages.length === 0) {
      emptyStateEl.style.display = "block";
      const greeting = $("emptyGreeting");
      if (greeting) greeting.textContent = pickGreeting();
      return;
    }
    emptyStateEl.style.display = "none";

    chat.messages.forEach((m) => {
      if (m.role === "model" && !m.id) m.id = uid();
      const { wrap, textEl } = buildMessageShell(m);
      renderMarkdown(textEl, m.text, false);
      highlightCode(textEl);
      messagesEl.appendChild(wrap);
    });

    if (isGenerating && typingChatId === chat.id) showTyping();
    scrollThreadToBottom();
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => { threadEl.scrollTop = threadEl.scrollHeight; });
  }

  function isNearBottom() {
    return (threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 140);
  }

  function createLivePainter(paint) {
    let latest = "";
    let raf = 0;
    return {
      push(raw) {
        latest = raw;
        if (!state.settings.streamingEnabled) return;
        if (!raf) {
          raf = requestAnimationFrame(() => { raf = 0; paint(latest); });
        }
      },
      stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    };
  }

  function updateThinkingPhrase(phrase) {
    if (!currentThinkingEl) return;
    const t = currentThinkingEl.querySelector(".thinking-text");
    if (t) t.textContent = phrase;
  }

  function showTyping() {
    if ($("typingRow")) {
      currentThinkingEl = $("typingRow");
      return;
    }
    brandDot.classList.add("thinking");
    emptyStateEl.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "msg model";
    wrap.id = "typingRow";
    wrap.innerHTML =
      '<div class="msg-body">' +
        '<div class="thinking">' +
          '<span class="thinking-text">думаю…</span>' +
          '<span class="thinking-dots"><span></span><span></span><span></span></span>' +
        '</div>' +
        '<div class="thinking-actions">' +
          '<button type="button" class="stream-stop-btn" id="streamStopBtn">' +
            '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' +
            'Прервать' +
          '</button>' +
        '</div>' +
      '</div>';
    messagesEl.appendChild(wrap);
    currentThinkingEl = wrap;

    const stopBtn = wrap.querySelector("#streamStopBtn");
    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        if (currentAbortController) currentAbortController.abort();
      });
    }

    scrollThreadToBottom();
  }

  function hideTyping() {
    brandDot.classList.remove("thinking");
    const row = $("typingRow");
    if (row) row.remove();
    currentThinkingEl = null;
  }

  /* ===== ВЛОЖЕНИЯ ===== */
  function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const original = reader.result;
        const img = new Image();
        img.onerror = () => resolve(original);
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve(canvas.toDataURL("image/jpeg", 0.85)); }
          catch (e) { resolve(original); }
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }

  const readAsDataUrl = (file) => new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });

  function setPending(att) {
    pendingImage = att;
    attachPreviewImg.src = att.kind === "image" ? att.dataUrl : "";
    attachPreviewImg.hidden = att.kind !== "image";
    attachEdit.hidden = att.kind !== "image";
    attachFile.hidden = att.kind === "image";
    attachFileName.textContent = att.name || "файл";
    attachPreview.hidden = false;
    updateSendBtnState();
  }

  async function handleFile(file) {
    if (!file) return;
    const isImg = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isText = !isImg && !isPdf && (file.type.startsWith("text/") || TEXT_EXT.test(file.name));
    if (!isImg && !isPdf && !isText) { toast("поддерживаются картинки, PDF и текст/код", true); return; }

    if (isImg) {
      if (file.size > MAX_IMAGE_BYTES) { toast("максимум 10 МБ", true); return; }
      const dataUrl = await compressImage(file);
      if (!dataUrl) { toast("не удалось прочитать изображение", true); return; }
      setPending({ kind: "image", dataUrl: dataUrl, name: file.name });
    } else if (isPdf) {
      if (file.size > MAX_PDF_BYTES) { toast("PDF больше 4 МБ", true); return; }
      let dataUrl = await readAsDataUrl(file);
      if (!dataUrl) { toast("не удалось прочитать файл", true); return; }
      dataUrl = dataUrl.replace(/^data:[^;]*;/, "data:application/pdf;");
      setPending({ kind: "pdf", dataUrl: dataUrl, name: file.name });
    } else {
      if (file.size > MAX_TEXT_FILE_BYTES) { toast("текстовый файл больше 300 КБ", true); return; }
      let text = "";
      try { text = await file.text(); } catch (e) { toast("не удалось прочитать файл", true); return; }
      if (text.includes("\u0000")) { toast("похоже на бинарный файл", true); return; }
      setPending({ kind: "text", name: file.name, text: text.slice(0, MAX_TEXT_CHARS), cut: text.length > MAX_TEXT_CHARS });
    }
  }

  function composeUserText(text, att) {
    if (!att) return text;
    if (att.kind === "image") return text || "[изображение]";
    const head = text ? text + "\n\n" : "";
    if (att.kind === "pdf") return head + "[файл: " + att.name + "]";
    const longest = (att.text.match(/`+/g) || []).reduce((n, s) => Math.max(n, s.length), 0);
    const fence = "`".repeat(Math.max(3, longest + 1));
    return head + "[файл: " + att.name + "]\n" + fence + "\n" + att.text + (att.cut ? "\n…(файл обрезан)" : "") + "\n" + fence;
  }

  async function editPending() {
    if (!pendingImage || pendingImage.kind !== "image" || !window.WAWEditor) return;
    const name = pendingImage.name;
    const out = await WAWEditor.open(pendingImage.dataUrl);
    if (out && pendingImage) setPending({ kind: "image", dataUrl: out, name: name });
  }

  function clearPendingImage() {
    pendingImage = null;
    attachPreview.hidden = true;
    attachPreviewImg.src = "";
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  cameraBtn.addEventListener("click", () => cameraInput.click());
  attachEdit.addEventListener("click", editPending);
  attachPreviewImg.addEventListener("click", editPending);
  [fileInput, cameraInput].forEach((inp) =>
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0];
      inp.value = "";
      handleFile(f);
    })
  );
  messageInput.addEventListener("paste", (e) => {
    const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (f) { e.preventDefault(); handleFile(f); }
  });

  attachRemove.addEventListener("click", () => {
    clearPendingImage();
    updateSendBtnState();
  });

  /* ===== SEND ===== */
  function autoResizeInput() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
  }

  function updateSendBtnState() {
    const hasText = messageInput.value.trim().length > 0;
    const hasImage = !!pendingImage;
    sendBtn.disabled = (!hasText && !hasImage) || isGenerating;
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    const imageToSend = pendingImage;
    if ((!text && !imageToSend) || isGenerating) return;

    const chat = getActiveChat();
    if (!cloudUser || (chat.persisted && !chat.loaded)) return;

    if (chat.messages.length === 0 && chat.title.startsWith("Диалог")) {
      const base = text || (imageToSend && imageToSend.name) || "Вложение";
      chat.title = base.slice(0, 32) + (base.length > 32 ? "…" : "");
    }

    const userMsg = {
      id: uid(),
      role: "user",
      text: composeUserText(text, imageToSend),
      image: (imageToSend && imageToSend.dataUrl) || null,
      createdAt: nextTs(),
    };
    chat.messages.push(userMsg);
    cloudSaveMessage(chat, userMsg);
    clearPendingImage();

    save();
    renderChatList();

    isGenerating = true;
    typingChatId = chat.id;
    renderMessages();

    messageInput.value = "";
    autoResizeInput();
    updateSendBtnState();

    const stillThere = () => state.chats.includes(chat);
    const isVisible = () => stillThere() && state.activeChatId === chat.id;

    const msg = {
      id: uid(),
      role: "model",
      text: "",
      model: state.settings.model,
      createdAt: nextTs(),
    };
    let shell = null;

    const painter = createLivePainter((raw) => {
      if (!isVisible()) return;
      if (shell && !shell.wrap.isConnected) shell = null;
      const live = splitReasoning(raw, true);
      if (!shell) {
        hideTyping();
        shell = buildMessageShell(msg);
        shell.wrap.classList.add("streaming");
        messagesEl.appendChild(shell.wrap);
      }
      const stick = isNearBottom();
      renderVariantInPlace({ text: live.answer, reasoning: live.reasoning }, shell.body, true);
      if (stick) threadEl.scrollTop = threadEl.scrollHeight;
    });

    const finalize = (raw, isError, interrupted) => {
      painter.stop();
      if (!stillThere()) return;
      const res = isError ? { answer: raw, reasoning: undefined } : splitReasoning(raw, false);
      msg.text = res.answer;
      msg.reasoning = res.reasoning;
      if (isError) msg.error = true;
      if (interrupted) msg.interrupted = true;
      ensureVariants(msg);
      chat.messages.push(msg);
      save();
      cloudSaveMessage(chat, msg);

      if (!isVisible()) return;
      hideTyping();
      if (shell && !shell.wrap.isConnected) shell = null;
      if (!shell) {
        shell = buildMessageShell(msg);
        messagesEl.appendChild(shell.wrap);
      }
      shell.wrap.classList.remove("streaming");
      const stick = isNearBottom();
      renderVariantInPlace(msg, shell.body, false);
      if (interrupted) showContinueButton(msg, shell.body);
      if (stick) scrollThreadToBottom();
    };

    try {
      const raw = await requestReply(chat, imageToSend, painter.push);
      finalize(raw, false, false);
    } catch (err) {
      console.error("WAW: reply failed", err);
      const isAbort = err && err.name === "AbortError";
      const partial = err && err.partial ? err.partial : "";

      if (isAbort) {
        const has = !!partial.trim();
        finalize(has ? partial : "(остановлено)", !has, has);
      } else if (partial.trim()) {
        finalize(partial + "\n\n_…ответ оборвался_", false, false);
      } else {
        finalize(
          "не удалось получить ответ (" +
            (err && err.message ? err.message : "неизвестная ошибка") +
            "). попробуй ещё раз чуть позже",
          true,
          false
        );
      }
    } finally {
      painter.stop();
      hideTyping();
      isGenerating = false;
      typingChatId = null;
      currentAbortController = null;
      updateSendBtnState();
      if (!isMobile()) messageInput.focus();
    }
  }

  function showContinueButton(msg, body) {
    if (!body) return;
    if (body.querySelector(".stream-continue-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stream-continue-btn";
    btn.textContent = "Продолжить";
    btn.addEventListener("click", async () => {
      btn.remove();
      if (isGenerating) return;
      msg.interrupted = false;
      messageInput.value = "продолжи";
      sendMessage();
    });
    body.appendChild(btn);
  }

  /* ===== API ===== */
  async function requestReply(source, imagePayload, onUpdate) {
    const chatMessages = Array.isArray(source) ? source : source.messages;
    const usable = chatMessages.filter((m) => m.text && !m.error);

    const history = usable.map((m) => ({
      role: m.role === "model" ? "assistant" : "user",
      text: m.text,
    }));

    // вложения: максимум 4 последних и не больше лимита по размеру
    let budget = MAX_ATTACH_CHARS, left = 4;
    for (let i = usable.length - 1; i >= 0 && left > 0; i--) {
      const img = usable[i].role === "user" && usable[i].image;
      if (img && img.length <= budget) { history[i].image = img; budget -= img.length; left--; }
    }

    const payload = JSON.stringify({
      history: history,
      personalInstruction: state.settings.personalInstruction || "",
      reasoning: reasoningOn,
      roleplay: roleplayOn,
      model: state.settings.model,
      image: null,
      stream: true,
    });

    const abort = new AbortController();
    currentAbortController = abort;

    const post = (token) =>
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: payload,
        signal: abort.signal,
      });

    let token = await Cloud.getAccessToken(false);
    if (!token) throw new Error("нужно войти в аккаунт");

    let res = await post(token);

    if (res.status === 401) {
      token = await Cloud.getAccessToken(true);
      if (token) res = await post(token);
    }

    if (res.status === 401) {
      Cloud.signOut();
      throw new Error("сессия недействительна — войди заново");
    }

    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch (e) {}
      throw new Error((data && data.error) || `Worker вернул HTTP ${res.status}`);
    }

    let acc = "";
    let finished = false;

    const handleLine = (line) => {
      line = line.trim();
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch (e) { return; }
      if (ev.error) throw new Error(ev.error);
      if (typeof ev.s === "string") updateThinkingPhrase(ev.s);
      if (typeof ev.t === "string") {
        acc += ev.t;
        if (onUpdate) onUpdate(acc);
      }
      if (ev.done) finished = true;
    };

    try {
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            handleLine(line);
          }
        }

        buf += decoder.decode();
        if (buf.trim()) handleLine(buf);
      } else {
        (await res.text()).split("\n").forEach(handleLine);
      }

      if (!finished) throw new Error("соединение оборвалось");
    } catch (err) {
      err.partial = acc;
      throw err;
    } finally {
      currentAbortController = null;
    }

    return acc;
  }

  /* ===== REASONING SPLIT ===== */
  const REASON_HEAD_RE = /^\s*[*_#>\s]*(?:рассуждение|reasoning|мысли|thinking)\s*[*_]*\s*:\s*[*_]*\s*/i;
  const ANSWER_MARK_RE = /[*_#>\s]*(?:ответ|answer)\s*[*_]*\s*:\s*[*_]*\s*/i;
  const MARKER_WORDS = ["рассуждение", "reasoning", "мысли", "thinking"];

  function couldBeMarker(raw) {
    const t = raw.trim().toLowerCase().replace(/^[*_#>\s]+/, "");
    if (!t || t.length > 14) return false;
    return MARKER_WORDS.some((w) => w.startsWith(t));
  }

  function splitReasoning(raw, live) {
    if (!reasoningOn) return { answer: raw.trim(), reasoning: undefined };
    const head = raw.match(REASON_HEAD_RE);
    if (!head) {
      if (live && couldBeMarker(raw)) return { answer: "", reasoning: undefined };
      return { answer: raw.trim(), reasoning: undefined };
    }
    const rest = raw.slice(head[0].length);
    const mark = rest.match(ANSWER_MARK_RE);
    if (!mark) {
      if (live) return { reasoning: rest.trim(), answer: "" };
      return { answer: raw.trim(), reasoning: undefined };
    }
    const reasoning = rest.slice(0, mark.index).trim();
    const answer = rest.slice(mark.index + mark[0].length).trim();
    if (!answer && !live) return { answer: raw.trim(), reasoning: undefined };
    return { reasoning: reasoning || undefined, answer: answer };
  }

  /* ===== TOGGLES ===== */
  function setToggle(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  reasoningToggle.addEventListener("click", () => {
    reasoningOn = !reasoningOn;
    setToggle(reasoningToggle, reasoningOn);
  });

  roleplayToggle.addEventListener("click", () => {
    roleplayOn = !roleplayOn;
    setToggle(roleplayToggle, roleplayOn);
  });

  /* ===== SIDEBAR ===== */
  function openSidebar() { sidebarEl.classList.add("open"); sidebarScrim.classList.add("open"); }
  function closeSidebar() { sidebarEl.classList.remove("open"); sidebarScrim.classList.remove("open"); }
  function closeSidebarOnMobile() { if (window.innerWidth <= 840) closeSidebar(); }

  openSidebarBtn.addEventListener("click", openSidebar);
  closeSidebarBtn.addEventListener("click", closeSidebar);
  sidebarScrim.addEventListener("click", closeSidebar);

  /* ===== SETTINGS ===== */
  function openSettings() {
    populateSettingsForm();
    settingsScrim.classList.add("open");
    settingsPanel.setAttribute("aria-hidden", "false");
  }
  function closeSettings() {
    settingsScrim.classList.remove("open");
    settingsPanel.setAttribute("aria-hidden", "true");
  }

  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsScrim.addEventListener("click", (e) => {
    if (e.target === settingsScrim) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (wawModalScrim.classList.contains("open")) closeModal(false);
      else if (settingsScrim.classList.contains("open")) closeSettings();
      else if (modelSheet.classList.contains("open")) closeModelSheet();
      else closeSidebar();
    }
  });

  function populateSettingsForm() {
    displayNameInput.value = state.settings.displayName;
    personalInstructionInput.value = state.settings.personalInstruction;
    piCount.textContent = String(state.settings.personalInstruction.length);

    themeSegmented.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === state.settings.theme);
    });
    themeSegmented.dataset.active = state.settings.theme;

    document.querySelectorAll(".swatch").forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.accent === state.settings.accent);
    });

    setSwitch(streamingSwitch, state.settings.streamingEnabled);
    setSwitch(reasoningDefaultSwitch, state.settings.reasoningDefault);
    setSwitch(roleplayDefaultSwitch, state.settings.roleplayDefault);

    accountEmailEl.textContent = cloudUser ? cloudUser.email || "аккаунт" : "";
    updateImportButton();
  }

  function setSwitch(el, on) {
    el.setAttribute("aria-checked", on ? "true" : "false");
  }

  displayNameInput.addEventListener("input", () => {
    state.settings.displayName = displayNameInput.value.trim() || "Ты";
    save();
    applyProfileToUI();
  });

  personalInstructionInput.addEventListener("input", () => {
    const val = personalInstructionInput.value.slice(0, 2000);
    state.settings.personalInstruction = val;
    piCount.textContent = String(val.length);
    save();
  });

  streamingSwitch.addEventListener("click", () => {
    const on = streamingSwitch.getAttribute("aria-checked") !== "true";
    state.settings.streamingEnabled = on;
    save();
    setSwitch(streamingSwitch, on);
  });

  function createThemeRipple(x, y, color) {
    const ripple = document.createElement("div");
    ripple.className = "theme-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.setProperty("--theme-ripple-color", color);
    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  }

  function animateThemeChange(sourceElement, apply) {
    const rect = sourceElement && sourceElement.getBoundingClientRect();
    apply();
    if (!rect) return;
    const newBg = getComputedStyle(document.body).backgroundColor;
    createThemeRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, newBg);
  }

  themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    const nextTheme = btn.dataset.theme;
    if (nextTheme === state.settings.theme) return;
    animateThemeChange(btn, () => {
      state.settings.theme = nextTheme;
      save();
      applyTheme();
      populateSettingsForm();
    });
  });

  accentSwatches.addEventListener("click", (e) => {
    const btn = e.target.closest(".swatch");
    if (!btn) return;
    const nextAccent = btn.dataset.accent;
    if (nextAccent === state.settings.accent) return;
    const rect = btn.getBoundingClientRect();
    state.settings.accent = nextAccent;
    save();
    applyTheme();
    populateSettingsForm();
    const newAccent = getComputedStyle(document.documentElement).getPropertyValue("--accent");
    createThemeRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, newAccent);
  });

  reasoningDefaultSwitch.addEventListener("click", () => {
    const on = reasoningDefaultSwitch.getAttribute("aria-checked") !== "true";
    state.settings.reasoningDefault = on;
    save();
    setSwitch(reasoningDefaultSwitch, on);
  });

  roleplayDefaultSwitch.addEventListener("click", () => {
    const on = roleplayDefaultSwitch.getAttribute("aria-checked") !== "true";
    state.settings.roleplayDefault = on;
    save();
    setSwitch(roleplayDefaultSwitch, on);
  });

  wipeDataBtn.addEventListener("click", async () => {
    const ok = await showConfirm(
      "Удалить всё?",
      "Все твои диалоги в облаке и настройки будут удалены без возможности восстановления. Старая локальная копия истории на этом устройстве не затрагивается.",
      "Удалить всё"
    );
    if (!ok) return;
    try { await Cloud.deleteAllConversations(); }
    catch (e) {
      console.error("WAW: wipe failed", e);
      toast("не удалось удалить диалоги в облаке: " + (e && e.message ? e.message : "ошибка"));
      return;
    }
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
    state.settings = defaultState().settings;
    const blank = makeChat(1);
    state.chats = [blank];
    state.activeChatId = blank.id;
    reasoningOn = state.settings.reasoningDefault;
    roleplayOn = state.settings.roleplayDefault;
    clearPendingImage();
    save();
    closeSettings();
    setToggle(reasoningToggle, reasoningOn);
    setToggle(roleplayToggle, roleplayOn);
    renderModelUI();
    applyTheme();
    applyProfileToUI();
    renderAll();
    updateSendBtnState();
  });

  function resolveTheme() {
    const t = state.settings.theme;
    if (t === "system") return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    return t;
  }

  function updateLogo() {
    const src = ACCENT_ICONS[state.settings.accent] || ACCENT_ICONS.violet;
    const logo = document.getElementById("emptyLogo");
    if (logo && logo.getAttribute("src") !== src) logo.setAttribute("src", src);
    const fav = document.querySelector('link[rel="icon"]');
    if (fav && fav.getAttribute("href") !== src) fav.setAttribute("href", src);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-accent", state.settings.accent);
    const resolved = resolveTheme();
    document.body.classList.toggle("light", resolved === "light");
    themeSegmented.dataset.active = state.settings.theme;
    const barColor = resolved === "light" ? "#FFFFFF" : "#0E0B19";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", barColor));
    updateLogo();
  }

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });

  function applyProfileToUI() {
    userDisplayName.textContent = state.settings.displayName || "Ты";
    userAvatar.textContent = (state.settings.displayName || "Т").trim().charAt(0).toUpperCase() || "Т";
    const sub = document.querySelector(".profile-sub");
    if (sub) sub.textContent = cloudUser && cloudUser.email ? cloudUser.email : "настройки и персонализация";
  }

  newChatBtn.addEventListener("click", createChat);

  deleteChatBtn.addEventListener("click", async () => {
    const chat = getActiveChat();
    const ok = await showConfirm("Удалить диалог?", `«${chat.title}» будет удалён вместе с историей.`, "Удалить");
    if (ok) deleteChat(chat.id);
  });

  messageInput.addEventListener("input", () => {
    autoResizeInput();
    updateSendBtnState();
  });

  messageInput.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.isComposing &&
      !window.matchMedia("(pointer: coarse)").matches
    ) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

  /* ===== MODEL SHEET ===== */
  function isMobile() { return window.innerWidth <= 840; }
  function currentModel() { return MODELS.find((m) => m.id === state.settings.model) || MODELS[0]; }

  function renderModelUI() {
    const cur = currentModel();
    modelLabel.textContent = cur.name;
    modelBtn.dataset.tier = cur.tier;
    modelList.innerHTML = "";

    MODELS.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-option" + (m.id === cur.id ? " active" : "");
      btn.dataset.tier = m.tier;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", m.id === cur.id ? "true" : "false");
      btn.innerHTML =
        '<span class="model-orb"></span>' +
        '<span class="model-info">' +
        '<span class="model-name">' + m.name +
        (m.badge ? '<em class="model-badge">' + m.badge + "</em>" : "") +
        "</span>" +
        '<span class="model-desc">' + m.desc + "</span>" +
        (m.note ? '<span class="model-note">' + m.note + "</span>" : "") +
        "</span>" +
        '<svg class="model-check" viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>';
      btn.addEventListener("click", () => {
        state.settings.model = m.id;
        save();
        renderModelUI();
        closeModelSheet();
      });
      modelList.appendChild(btn);
    });
  }

  function openModelSheet() {
    if (isMobile()) { modelSheet.style.left = ""; modelSheet.style.top = ""; }
    else {
      const r = modelBtn.getBoundingClientRect();
      const w = 340;
      modelSheet.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + "px";
      modelSheet.style.top = r.bottom + 10 + "px";
    }
    modelSheet.style.transform = "";
    modelSheet.classList.add("open");
    modelScrim.classList.add("open");
    modelSheet.setAttribute("aria-hidden", "false");
    modelBtn.setAttribute("aria-expanded", "true");
  }

  function closeModelSheet() {
    modelSheet.classList.remove("open");
    modelScrim.classList.remove("open");
    modelSheet.setAttribute("aria-hidden", "true");
    modelBtn.setAttribute("aria-expanded", "false");
  }

  modelBtn.addEventListener("click", () => {
    if (modelSheet.classList.contains("open")) closeModelSheet();
    else openModelSheet();
  });
  modelScrim.addEventListener("click", closeModelSheet);
  window.addEventListener("resize", () => {
    if (modelSheet.classList.contains("open")) closeModelSheet();
  });

  (function initSheetDrag() {
    let y0 = null;
    let dy = 0;
    modelSheet.addEventListener("touchstart", (e) => {
      if (!isMobile()) return;
      y0 = e.touches[0].clientY; dy = 0;
      modelSheet.style.transition = "none";
    }, { passive: true });
    modelSheet.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      modelSheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      modelSheet.style.transition = "";
      modelSheet.style.transform = "";
      if (dy > 70) closeModelSheet();
      dy = 0;
    };
    modelSheet.addEventListener("touchend", end);
    modelSheet.addEventListener("touchcancel", end);
  })();

  /* ===== SIDEBAR SWIPE ===== */
  function overlayOpen() {
    return (
      settingsScrim.classList.contains("open") ||
      wawModalScrim.classList.contains("open") ||
      modelSheet.classList.contains("open") ||
      !!document.querySelector(".ed-scrim.open")
    );
  }

  (function initSidebarSwipe() {
    let mode = null;
    let sx = 0, sy = 0, lastX = 0, lastT = 0, vx = 0, curX = 0, off = 0;

    const setProgress = (x) => {
      curX = x;
      const p = (x + off) / off;
      sidebarEl.style.transform = `translateX(${x}px)`;
      sidebarEl.style.opacity = String(Math.min(1, p * 1.6));
      sidebarScrim.style.opacity = String(p);
    };

    document.addEventListener("touchstart", (e) => {
      if (!isMobile() || e.touches.length !== 1 || overlayOpen()) { mode = "dead"; return; }
      if (e.target.closest && e.target.closest("textarea, input, pre, table, .composer-row, .attach-preview")) {
        mode = "dead";
        return;
      }
      const t = e.touches[0];
      sx = lastX = t.clientX;
      sy = t.clientY;
      lastT = performance.now();
      vx = 0;
      mode = "pending";
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (mode === null || mode === "dead") return;
      const t = e.touches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;

      if (mode === "pending") {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.3) { mode = "dead"; return; }
        const isOpen = sidebarEl.classList.contains("open");
        if (!isOpen && dx > 0) mode = "open";
        else if (isOpen && dx < 0) mode = "close";
        else { mode = "dead"; return; }
        off = sidebarEl.offsetWidth + 24;
        sidebarEl.style.transition = "none";
        sidebarScrim.style.transition = "none";
        sidebarScrim.style.display = "block";
      }

      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) vx = (t.clientX - lastX) / dt;
      lastX = t.clientX;
      lastT = now;
      const base = mode === "open" ? -off : 0;
      setProgress(Math.max(-off, Math.min(0, base + dx)));
    }, { passive: false });

    const finish = () => {
      if (mode !== "open" && mode !== "close") { mode = null; return; }
      const p = (curX + off) / off;
      const shouldOpen = Math.abs(vx) > 0.4 ? vx > 0 : p > 0.5;
      mode = null;
      sidebarEl.style.transition = "";
      sidebarEl.style.transform = "";
      sidebarEl.style.opacity = "";
      sidebarEl.classList.toggle("open", shouldOpen);
      sidebarScrim.style.transition = "opacity .3s ease";
      sidebarScrim.style.opacity = shouldOpen ? "1" : "0";
      setTimeout(() => {
        sidebarScrim.style.transition = "";
        sidebarScrim.style.opacity = "";
        sidebarScrim.style.display = "";
        sidebarScrim.classList.toggle("open", sidebarEl.classList.contains("open"));
      }, 300);
    };

    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
  })();

  if (window.ResizeObserver && composerWrap && mainEl) {
    new ResizeObserver(() => {
      mainEl.style.setProperty("--composer-h", composerWrap.offsetHeight + "px");
    }).observe(composerWrap);
  }

  /* ===== CLOUD ===== */
  let toastTimer = null;
  let lastToastAt = 0;

  function toast(msg, force) {
    const now = Date.now();
    if (!force && now - lastToastAt < 4000) return;
    lastToastAt = now;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3800);
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === "object" ? v : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function enqueue(chat, fn, label) {
    const prev = chatQueues.get(chat) || Promise.resolve();
    const next = prev.then(fn).catch((e) => {
      console.error("WAW cloud:", label, e);
      toast("не удалось сохранить в облаке (" + label + ")");
    });
    chatQueues.set(chat, next);
    return next;
  }

  async function ensureConversation(chat) {
    if (chat.persisted) return;
    await Cloud.upsertConversation(chat);
    chat.persisted = true;
    chat.loaded = true;
  }

  function cloudSaveMessage(chat, msg) {
    if (!cloudUser) return;
    enqueue(chat, async () => {
      await ensureConversation(chat);
      await Cloud.upsertMessage(chat.id, msg);
    }, "сообщение");
  }

  function chatOfMessage(m) {
    return state.chats.find((c) => c.messages.includes(m));
  }

  function cloudPatchMessage(m) {
    if (!cloudUser) return;
    const chat = chatOfMessage(m);
    if (!chat) return;
    enqueue(chat, async () => {
      await ensureConversation(chat);
      await Cloud.patchMessage(m);
    }, "правка ответа");
  }

  function cloudRename(chat) {
    if (!cloudUser) return;
    enqueue(chat, async () => {
      if (chat.persisted) await Cloud.renameConversation(chat.id, chat.title);
    }, "название");
  }

  function cloudDelete(chat) {
    if (!cloudUser) return;
    enqueue(chat, async () => {
      if (chat.persisted) await Cloud.deleteConversation(chat.id);
    }, "удаление");
  }

  function cloudDeleteMessages(chat, ids) {
    if (!cloudUser || !ids.length) return;
    enqueue(chat, async () => {
      if (chat.persisted) await Cloud.deleteMessages(ids);
    }, "правка");
  }

  function ensureChatLoaded(chat) {
    if (!chat || !cloudUser || !chat.persisted || chat.loaded) return Promise.resolve();
    if (loadingChats.has(chat)) return loadingChats.get(chat);
    chat.loadFailed = false;
    const p = Cloud.loadMessages(chat.id)
      .then((msgs) => { chat.messages = msgs; chat.loaded = true; })
      .catch((e) => {
        chat.loadFailed = true;
        console.error("WAW: load messages failed", e);
        toast("не удалось загрузить диалог", true);
      })
      .finally(() => loadingChats.delete(chat));
    loadingChats.set(chat, p);
    return p;
  }

  function renderAllAndLoad() {
    renderAll();
    const chat = getActiveChat();
    ensureChatLoaded(chat).then(() => {
      if (getActiveChat() === chat) renderMessages();
    });
  }

  function rememberActiveChat() {
    if (!cloudUser) return;
    const chat = getActiveChat();
    if (!chat || !chat.persisted) return;
    const map = readJson(LAST_CHAT_KEY, {});
    map[cloudUser.id] = chat.id;
    writeJson(LAST_CHAT_KEY, map);
  }

  async function loadCloudState() {
    const rows = await Cloud.listConversations();
    const chats = rows.map((r) => ({
      id: r.id,
      title: r.title || "Диалог",
      messages: [],
      persisted: true,
      loaded: false,
    }));
    if (chats.length === 0) chats.push(makeChat(1));
    state.chats = chats;
    const last = readJson(LAST_CHAT_KEY, {})[cloudUser.id];
    const pick = chats.find((c) => c.id === last) || chats[chats.length - 1];
    state.activeChatId = pick.id;
    await ensureChatLoaded(pick);
    if (pick.persisted && !pick.loaded) throw new Error("не удалось загрузить диалог");
  }

  function pendingLocalChats() {
    if (!cloudUser) return [];
    const claimed = readJson(MIGRATED_KEY, {});
    return localChatsOriginal.filter((c) => !claimed[c.id]);
  }

  function updateImportButton() {
    const n = pendingLocalChats().length;
    importLocalBtn.hidden = n === 0;
    importLocalBtn.textContent = `Перенести локальную историю (${n})`;
  }

  async function runMigration() {
    const pending = pendingLocalChats();
    if (!pending.length || !cloudUser) return;
    let results;
    try {
      results = await Cloud.importLocalChats(pending, (done, total) => {
        toast(`переношу историю… ${done}/${total}`, true);
      });
    } catch (e) {
      console.error("WAW: migration failed", e);
      toast("не удалось перенести историю: " + (e && e.message ? e.message : "ошибка"), true);
      return;
    }
    const claimed = readJson(MIGRATED_KEY, {});
    let ok = 0, failed = 0, dropped = 0;
    results.forEach((r) => {
      if (r.ok) { claimed[r.localId] = cloudUser.id; ok++; dropped += r.droppedImages || 0; }
      else failed++;
    });
    writeJson(MIGRATED_KEY, claimed);
    try { await loadCloudState(); renderAllAndLoad(); }
    catch (e) { console.error("WAW: reload after migration failed", e); }
    let text = `перенесено диалогов: ${ok}`;
    if (failed) text += `, не удалось: ${failed}`;
    if (dropped) text += `, пропущено тяжёлых картинок: ${dropped}`;
    toast(text, true);
    updateImportButton();
  }

  async function offerMigration() {
    const pending = pendingLocalChats();
    if (!pending.length) return;
    const declined = readJson(DECLINED_KEY, {});
    if (declined[cloudUser.id]) return;
    const ok = await showConfirm(
      "Перенести историю в облако?",
      `На этом устройстве найдено диалогов: ${pending.length}. Перенести их в твой аккаунт? Оригиналы на устройстве останутся нетронутыми. Позже это можно сделать в настройках.`,
      "Перенести",
      { primary: true, cancelLabel: "Не сейчас" }
    );
    if (!ok) { declined[cloudUser.id] = true; writeJson(DECLINED_KEY, declined); return; }
    await runMigration();
  }

  importLocalBtn.addEventListener("click", async () => {
    if (isGenerating) { toast("дождись окончания ответа", true); return; }
    importLocalBtn.disabled = true;
    try { await runMigration(); }
    finally { importLocalBtn.disabled = false; updateImportButton(); }
  });

  signOutBtn.addEventListener("click", async () => {
    await Cloud.signOut();
    handleSession(null);
  });

  function signedOutCleanup() {
    cloudUser = null;
    bootstrapId = null;
    typingChatId = null;
    const blank = makeChat(1);
    state.chats = [blank];
    state.activeChatId = blank.id;
    clearPendingImage();
    messageInput.value = "";
    autoResizeInput();
    hideTyping();
    closeModal(false);
    closeSettings();
    closeSidebar();
    closeModelSheet();
    applyProfileToUI();
    renderAll();
    updateSendBtnState();
  }

  async function handleSession(session) {
    if (!session || !session.user) {
      if (cloudUser || bootstrapId) signedOutCleanup();
      Cloud.showAuth();
      return;
    }
    const u = session.user;
    if (bootstrapId === u.id) return;
    if (bootstrapId && bootstrapId !== u.id) signedOutCleanup();

    bootstrapId = u.id;
    cloudUser = {
      id: u.id,
      email: u.email || (u.user_metadata && u.user_metadata.email) || "",
    };

    Cloud.showLoading("Загружаем твои диалоги…");
    try { await loadCloudState(); }
    catch (e) {
      console.error("WAW: cloud bootstrap failed", e);
      cloudUser = null;
      bootstrapId = null;
      Cloud.showError(
        "Не удалось загрузить диалоги: " + (e && e.message ? e.message : "ошибка"),
        () => window.location.reload()
      );
      return;
    }

    applyProfileToUI();
    renderAll();
    updateSendBtnState();
    Cloud.hideAuth();
    offerMigration();
  }

  function renderAll() {
    renderChatList();
    renderMessages();
  }

  applyTheme();
  applyProfileToUI();
  setToggle(reasoningToggle, reasoningOn);
  setToggle(roleplayToggle, roleplayOn);
  renderModelUI();
  renderAll();
  updateSendBtnState();

  if (Cloud) {
    Cloud.start({ onSession: handleSession });
  } else {
    const t = document.getElementById("authLoadingText");
    if (t) t.textContent = "Не удалось загрузить модуль входа. Обнови страницу.";
  }
  window.WAWApp = {
    state,
    getActiveChat,
    orderedChats,
    toast,
  };
})();
