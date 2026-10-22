/* ===========================================================
   WAW — Supabase: авторизация, экран входа, облачная история.
   Здесь только ПУБЛИЧНЫЙ publishable-ключ (безопасен для фронтенда:
   доступ к данным ограничивает RLS). Секретных ключей тут нет.
   =========================================================== */
(() => {
  "use strict";

  const SUPABASE_URL = "https://aynvudaskzjmvteyszvi.supabase.co";
  const SUPABASE_KEY = "sb_publishable_XoJVX6fPsa5vQxEgqGYTZA_9Wby2h26";

  const $ = (id) => document.getElementById(id);

  // Адрес возврата после OAuth / подтверждения email (без index.html и хвоста).
  function siteUrl() {
    const { origin, pathname } = window.location;
    return origin + pathname.replace(/index\.html$/, "");
  }

  // Ошибки и код из ссылки читаем ДО создания клиента — он сам чистит URL.
  const urlInfo = (() => {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      hadCode: q.has("code"),
      errorCode: q.get("error_code") || h.get("error_code") || "",
      errorDesc: q.get("error_description") || h.get("error_description") || "",
      hasError: !!(q.get("error") || h.get("error") || q.get("error_description") || h.get("error_description")),
    };
  })();

  let client = null;
  try {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
  } catch (e) {
    console.error("WAW: supabase init failed", e);
    client = null;
  }

  let session = null;

  /* =========================================================
     ЭКРАН ВХОДА
     ========================================================= */
  const screen = $("authScreen");
  const loadingText = $("authLoadingText");
  const tabs = $("authTabs");
  const form = $("authForm");
  const emailInput = $("authEmail");
  const passInput = $("authPassword");
  const msgEl = $("authMsg");
  const submitBtn = $("authSubmit");
  const googleBtn = $("authGoogle");
  const errorText = $("authErrorText");
  const retryBtn = $("authRetryBtn");
  const logoutBtn = $("authLogoutBtn");

  let mode = "signin";
  let busy = false;
  let retryHandler = null;

  function setScreen(state) {
    screen.dataset.state = state;
    screen.hidden = state === "hidden";
    document.body.classList.toggle("auth-open", state !== "hidden");
  }

  function setMsg(text, kind) {
    msgEl.textContent = text || "";
    msgEl.dataset.kind = text ? kind || "info" : "";
  }

  function setBusy(on) {
    busy = on;
    submitBtn.disabled = on;
    googleBtn.disabled = on;
    screen.classList.toggle("busy", on);
  }

  function setMode(next) {
    mode = next;
    tabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === next);
    });
    tabs.dataset.active = next;
    submitBtn.textContent = next === "signin" ? "Войти" : "Создать аккаунт";
    passInput.autocomplete = next === "signin" ? "current-password" : "new-password";
    setMsg("");
  }

  function mapAuthError(err) {
    const code = (err && err.code) || "";
    const msg = (err && err.message) || "";
    if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
      return "Неверный email или пароль";
    }
    if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
      return "Email ещё не подтверждён — открой письмо и перейди по ссылке";
    }
    if (code === "user_already_exists" || /already registered/i.test(msg)) {
      return "Этот email уже зарегистрирован — войди в аккаунт";
    }
    if (code === "weak_password" || /password should be/i.test(msg)) {
      return "Слишком простой пароль — используй минимум 8 символов";
    }
    if (code === "signup_disabled") return "Регистрация сейчас отключена";
    if (/rate_limit/.test(code) || /rate limit|too many/i.test(msg)) {
      return "Слишком много попыток — подожди минуту и попробуй снова";
    }
    if (/failed to fetch|networkerror|network request/i.test(msg)) {
      return "Нет соединения с сервером. Проверь интернет";
    }
    return msg || "Не удалось выполнить действие";
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy || !client) return;

    const email = emailInput.value.trim();
    const password = passInput.value;

    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("Введи корректный email", "error");
    if (!password) return setMsg("Введи пароль", "error");
    if (mode === "signup" && password.length < 8) {
      return setMsg("Пароль — минимум 8 символов", "error");
    }

    setBusy(true);
    setMsg("");

    try {
      if (mode === "signin") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // дальше сессию подхватит onAuthStateChange
        showLoading("Входим…");
      } else {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: siteUrl() },
        });
        if (error) throw error;

        if (data.session) {
          showLoading("Создаём аккаунт…");
        } else if (
          data.user &&
          Array.isArray(data.user.identities) &&
          data.user.identities.length === 0
        ) {
          setMode("signin");
          setMsg("Этот email уже зарегистрирован — войди в аккаунт", "error");
        } else {
          setMode("signin");
          passInput.value = "";
          setMsg(
            "Мы отправили письмо на " + email + ". Подтверди email по ссылке и войди в аккаунт.",
            "ok"
          );
        }
      }
    } catch (err) {
      setMsg(mapAuthError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (busy || !client) return;
    setBusy(true);
    setMsg("");
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: siteUrl(),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      // браузер уходит на страницу Google — busy оставляем
    } catch (err) {
      setMsg(mapAuthError(err), "error");
      setBusy(false);
    }
  }

  if (screen) {
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b && b.dataset.mode !== mode) setMode(b.dataset.mode);
    });
    form.addEventListener("submit", onSubmit);
    googleBtn.addEventListener("click", onGoogle);
    retryBtn.addEventListener("click", () => {
      if (retryHandler) retryHandler();
      else window.location.reload();
    });
    logoutBtn.addEventListener("click", () => signOut());
    // «Назад» из Google возвращает страницу из bfcache с залипшим busy
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) setBusy(false);
    });
  }

  function showAuth() {
    setBusy(false);
    setScreen("form");
  }
  function showLoading(text) {
    loadingText.textContent = text || "Загрузка…";
    setScreen("loading");
  }
  function showError(text, onRetry) {
    errorText.textContent = text;
    retryHandler = onRetry || null;
    setScreen("error");
  }
  function hideAuth() {
    setScreen("hidden");
  }

  /* =========================================================
     СЕССИЯ
     ========================================================= */
  async function start(handlers) {
    if (!client) {
      showError(
        "Не удалось загрузить модуль Supabase. Проверь интернет или отключи блокировщик и обнови страницу.",
        () => window.location.reload()
      );
      return;
    }

    client.auth.onAuthStateChange((event, sess) => {
      session = sess;
      // нельзя вызывать запросы Supabase прямо внутри колбэка — уводим из него
      setTimeout(() => handlers.onSession(sess, event), 0);
    });

    let sess = null;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      sess = data.session;
    } catch (e) {
      console.warn("WAW: getSession failed", e);
    }
    session = sess;

    // убираем ?code=…, #error=… из адресной строки
    if (
      urlInfo.hadCode ||
      urlInfo.hasError ||
      /access_token|refresh_token|error/.test(window.location.hash)
    ) {
      try {
        window.history.replaceState(null, "", siteUrl());
      } catch (e) {}
    }

    await handlers.onSession(sess, "INIT");

    if (!sess) {
      if (urlInfo.hasError) {
        const expired = urlInfo.errorCode === "otp_expired";
        setMsg(
          expired
            ? "Ссылка из письма устарела или уже использована. Войди с паролем или зарегистрируйся заново."
            : urlInfo.errorDesc.replace(/\+/g, " ") || "Не удалось завершить вход",
          "error"
        );
      } else if (urlInfo.hadCode) {
        setMsg(
          "Не удалось завершить вход по ссылке (её нужно открывать в том же браузере, где ты регистрировался). Если почта подтверждена — просто войди с паролем.",
          "info"
        );
      }
    }
  }

  async function signOut() {
    if (!client) return;
    try {
      // scope: local — выходим только на этом устройстве
      await client.auth.signOut({ scope: "local" });
    } catch (e) {
      console.warn("WAW: signOut failed", e);
    }
  }

  async function getAccessToken(forceRefresh) {
    if (!client) return null;
    try {
      if (forceRefresh) {
        const { data, error } = await client.auth.refreshSession();
        if (error) return null;
        session = data.session;
        return data.session ? data.session.access_token : null;
      }
      const { data } = await client.auth.getSession();
      session = data.session;
      return data.session ? data.session.access_token : null;
    } catch (e) {
      return null;
    }
  }

  async function requireUserId() {
    if (session && session.user) return session.user.id;
    const { data } = await client.auth.getSession();
    if (data.session) {
      session = data.session;
      return data.session.user.id;
    }
    throw new Error("Нет активной сессии");
  }

  /* =========================================================
     ДАННЫЕ (всё под RLS: видны и меняются только свои строки)
     ========================================================= */
  function rowToMessage(r) {
    const m = {
      id: r.id,
      role: r.role === "model" ? "model" : "user",
      text: r.content || "",
      image: r.image || null,
      createdAt: new Date(r.created_at).getTime(),
    };
    if (r.reasoning) m.reasoning = r.reasoning;
    if (r.is_error) m.error = true;
    if (r.model) m.model = r.model;
    if (Array.isArray(r.variants) && r.variants.length) {
      m.variants = r.variants;
      m.vIndex =
        typeof r.v_index === "number" && r.v_index >= 0 && r.v_index < r.variants.length
          ? r.v_index
          : r.variants.length - 1;
    }
    return m;
  }

  function messageToRow(conversationId, m, userId) {
    return {
      id: m.id,
      conversation_id: conversationId,
      user_id: userId,
      role: m.role === "model" ? "model" : "user",
      content: m.text || "",
      reasoning: m.reasoning || null,
      image: m.image || null,
      variants: Array.isArray(m.variants) ? m.variants : null,
      v_index: typeof m.vIndex === "number" ? m.vIndex : null,
      is_error: !!m.error,
      model: m.model || null,
      created_at: new Date(m.createdAt || Date.now()).toISOString(),
    };
  }

  async function fetchAll(build, pageSize) {
    const out = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < pageSize) break;
    }
    return out;
  }

  async function listConversations() {
    const userId = await requireUserId();
    return fetchAll(
      () =>
        client
          .from("conversations")
          .select("id,title,created_at,updated_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      500
    );
  }

  async function loadMessages(conversationId) {
    const rows = await fetchAll(
      () =>
        client
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      100
    );
    return rows.map(rowToMessage);
  }

  async function upsertConversation(chat) {
    const userId = await requireUserId();
    const { error } = await client.from("conversations").upsert(
      {
        id: chat.id,
        user_id: userId,
        title: String(chat.title || "Диалог").slice(0, 200),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  async function renameConversation(id, title) {
    const { error } = await client
      .from("conversations")
      .update({ title: String(title || "Диалог").slice(0, 200) })
      .eq("id", id);
    if (error) throw error;
  }

  async function deleteConversation(id) {
    // сообщения явно, потом диалог (не зависим от каскада в схеме)
    const r1 = await client.from("messages").delete().eq("conversation_id", id);
    if (r1.error) throw r1.error;
    const r2 = await client.from("conversations").delete().eq("id", id);
    if (r2.error) throw r2.error;
  }

  async function deleteAllConversations() {
    const userId = await requireUserId();
    const r1 = await client.from("messages").delete().eq("user_id", userId);
    if (r1.error) throw r1.error;
    const r2 = await client.from("conversations").delete().eq("user_id", userId);
    if (r2.error) throw r2.error;
  }

  async function deleteMessages(ids) {
    if (!ids.length) return;
    const { error } = await client.from("messages").delete().in("id", ids);
    if (error) throw error;
  }

  async function upsertMessage(conversationId, m) {
    const userId = await requireUserId();
    const { error } = await client
      .from("messages")
      .upsert(messageToRow(conversationId, m, userId), { onConflict: "id" });
    if (error) throw error;
  }

  // точечное обновление без повторной отправки картинки
  async function patchMessage(m) {
    const { error } = await client
      .from("messages")
      .update({
        content: m.text || "",
        reasoning: m.reasoning || null,
        variants: Array.isArray(m.variants) ? m.variants : null,
        v_index: typeof m.vIndex === "number" ? m.vIndex : null,
        is_error: !!m.error,
      })
      .eq("id", m.id);
    if (error) throw error;
  }

  /* =========================================================
     МИГРАЦИЯ ЛОКАЛЬНОЙ ИСТОРИИ
     Оригиналы в localStorage НЕ меняются и НЕ удаляются.
     id детерминированные (SHA-256 от user+локальный id) -> upsert
     идемпотентен: повторный запуск не создаёт дубликатов.
     ========================================================= */
  async function seededUuid(seed) {
    const bytes = new TextEncoder().encode(seed);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const hex = Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" + hex.slice(20, 32)
    );
  }

  // Возвращает число картинок, которые не удалось сохранить (слишком тяжёлые).
  async function upsertRows(rows) {
    let dropped = 0;
    const chunks = [];
    let cur = [];
    let size = 0;

    for (const r of rows) {
      const s = (r.image ? r.image.length : 0) + (r.content ? r.content.length : 0) + 500;
      if (cur.length && (size + s > 1500000 || cur.length >= 25)) {
        chunks.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(r);
      size += s;
    }
    if (cur.length) chunks.push(cur);

    for (const chunk of chunks) {
      const { error } = await client.from("messages").upsert(chunk, { onConflict: "id" });
      if (!error) continue;

      for (const r of chunk) {
        let res = await client.from("messages").upsert(r, { onConflict: "id" });
        if (res.error && r.image) {
          dropped++;
          res = await client
            .from("messages")
            .upsert(Object.assign({}, r, { image: null }), { onConflict: "id" });
        }
        if (res.error) throw res.error;
      }
    }
    return dropped;
  }

  async function importLocalChats(chats, onProgress) {
    const userId = await requireUserId();
    const results = [];

    for (let i = 0; i < chats.length; i++) {
      const c = chats[i];
      const r = { localId: c.id, ok: false, droppedImages: 0, error: null };

      try {
        const convId = await seededUuid(userId + ":conv:" + c.id);
        const msgs = (c.messages || []).filter((m) => m && typeof m.text === "string");
        if (!msgs.length) throw new Error("пустой диалог");

        let prev =
          typeof msgs[0].createdAt === "number" ? msgs[0].createdAt - 1 : Date.now() - msgs.length - 1;
        const rows = [];

        for (let j = 0; j < msgs.length; j++) {
          const m = msgs[j];
          const ts = Math.max(typeof m.createdAt === "number" ? m.createdAt : 0, prev + 1);
          prev = ts;
          const id = await seededUuid(userId + ":msg:" + c.id + ":" + j);
          rows.push(messageToRow(convId, Object.assign({}, m, { id: id, createdAt: ts }), userId));
        }

        const up = await client.from("conversations").upsert(
          {
            id: convId,
            user_id: userId,
            title: String(c.title || "Диалог").slice(0, 200),
            created_at: rows[0].created_at,
          },
          { onConflict: "id" }
        );
        if (up.error) throw up.error;

        r.droppedImages = await upsertRows(rows);
        r.ok = true;
      } catch (e) {
        r.error = (e && e.message) || String(e);
      }

      results.push(r);
      if (onProgress) onProgress(i + 1, chats.length);
    }
    return results;
  }

  window.WAWCloud = {
    available: !!client,
    start,
    showAuth,
    showLoading,
    showError,
    hideAuth,
    signOut,
    getAccessToken,
    listConversations,
    loadMessages,
    upsertConversation,
    renameConversation,
    deleteConversation,
    deleteAllConversations,
    deleteMessages,
    upsertMessage,
    patchMessage,
    importLocalChats,
  };
})();
