const els = {
  runtimeLabel: document.getElementById("runtimeLabel"),
  conversationList: document.getElementById("conversationList"),
  messageList: document.getElementById("messageList"),
  messageInput: document.getElementById("messageInput"),
  composer: document.getElementById("composer"),
  sendButton: document.getElementById("sendButton"),
  stopButton: document.getElementById("stopButton"),
  newConversation: document.getElementById("newConversation"),
  historySearch: document.getElementById("historySearch"),
  projectFilter: document.getElementById("projectFilter"),
  conversationTitle: document.getElementById("conversationTitle"),
  conversationProject: document.getElementById("conversationProject"),
  conversationLabels: document.getElementById("conversationLabels"),
  themeToggle: document.getElementById("themeToggle"),
  saveConversation: document.getElementById("saveConversation"),
  deleteConversation: document.getElementById("deleteConversation"),
  conversationMemory: document.getElementById("conversationMemory"),
  saveConversationMemory: document.getElementById("saveConversationMemory"),
  memoryList: document.getElementById("memoryList"),
  addMemory: document.getElementById("addMemory"),
  promptList: document.getElementById("promptList"),
  addPrompt: document.getElementById("addPrompt"),
  fileInput: document.getElementById("fileInput"),
  attachFiles: document.getElementById("attachFiles"),
  attachmentList: document.getElementById("attachmentList"),
  defaultSystemPrompt: document.getElementById("defaultSystemPrompt"),
  modelOverride: document.getElementById("modelOverride"),
  historyLimit: document.getElementById("historyLimit"),
  includePersonalMemories: document.getElementById("includePersonalMemories"),
  includeConversationMemory: document.getElementById("includeConversationMemory"),
  saveSettings: document.getElementById("saveSettings"),
  statePath: document.getElementById("statePath"),
  messageTemplate: document.getElementById("messageTemplate"),
  editorTemplate: document.getElementById("editorTemplate"),
};

let state = null;
let runtime = null;
let activeConversationId = null;
let busy = false;
let currentAbortController = null;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(await responseErrorDetail(response));
  }
  return response.json();
}

async function loadState() {
  const payload = await fetchJson("/chat/api/state");
  applyState(payload);
  if (!activeConversationId && state.conversations.length) {
    activeConversationId = state.conversations[0].id;
  }
  if (!activeConversationId) {
    await createConversation();
    return;
  }
  render();
}

function applyState(payload) {
  state = payload.state;
  runtime = payload.runtime;
  document.body.dataset.theme = state.settings.theme || "light";
  if (
    activeConversationId &&
    !state.conversations.some((item) => item.id === activeConversationId)
  ) {
    activeConversationId = null;
  }
}

function activeConversation() {
  if (!state) return null;
  return state.conversations.find((item) => item.id === activeConversationId) || null;
}

function render() {
  renderRuntime();
  renderProjectControls();
  renderConversations();
  renderMessages();
  renderConversationForm();
  renderMemories();
  renderPrompts();
  renderAttachments();
  renderSettings();
  renderBusyState();
}

function renderRuntime() {
  const model = runtime?.model || "modelo padrao";
  const provider = runtime?.provider || "provedor";
  els.runtimeLabel.textContent = `${provider} / ${model}`;
  els.statePath.textContent = runtime?.chat_state_path || "";
}

function renderProjectControls() {
  const selectedFilter = els.projectFilter.value || "all";
  replaceOptions(els.projectFilter, [
    { value: "all", label: "Todos os projetos" },
    ...state.projects.map((project) => ({
      value: project.id,
      label: project.title,
    })),
  ]);
  els.projectFilter.value = projectExists(selectedFilter) ? selectedFilter : "all";

  const conversation = activeConversation();
  replaceOptions(els.conversationProject, [
    ...state.projects.map((project) => ({
      value: project.id,
      label: project.title,
    })),
    { value: "__new__", label: "+ Novo projeto" },
  ]);
  els.conversationProject.value = conversation?.project_id || "default";
}

function replaceOptions(select, options) {
  select.innerHTML = "";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
}

function projectExists(projectId) {
  return projectId === "all" || state.projects.some((project) => project.id === projectId);
}

function renderConversations() {
  els.conversationList.innerHTML = "";
  const query = (els.historySearch.value || "").trim().toLowerCase();
  const projectId = els.projectFilter.value || "all";
  for (const conversation of state.conversations) {
    if (conversation.archived) continue;
    if (projectId !== "all" && conversation.project_id !== projectId) continue;
    if (query && !conversationMatches(conversation, query)) continue;

    const item = document.createElement("div");
    item.className = "conversation-item";
    if (conversation.id === activeConversationId) item.classList.add("active");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-button";
    button.innerHTML = `
      <strong></strong>
      <span></span>
      <small></small>
    `;
    const branchPrefix = conversation.parent_id ? "Ramo: " : "";
    button.querySelector("strong").textContent = `${branchPrefix}${conversation.title}`;
    button.querySelector("span").textContent = conversation.messages.length
      ? conversation.messages.at(-1).content
      : "sem mensagens";
    button.querySelector("small").textContent = conversation.labels?.length
      ? conversation.labels.map((label) => `#${label}`).join(" ")
      : projectTitle(conversation.project_id);
    button.addEventListener("click", () => {
      activeConversationId = conversation.id;
      render();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "conversation-delete";
    deleteButton.textContent = "Apagar";
    deleteButton.title = "Apagar conversa";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversationById(conversation.id);
    });

    item.append(button, deleteButton);
    els.conversationList.appendChild(item);
  }
}

function conversationMatches(conversation, query) {
  const fields = [
    conversation.title,
    conversation.memory,
    projectTitle(conversation.project_id),
    ...(conversation.labels || []),
    ...(conversation.messages || []).map((message) => message.content),
    ...(conversation.attachments || []).map((attachment) => attachment.name),
  ];
  return fields.some((field) => String(field || "").toLowerCase().includes(query));
}

function projectTitle(projectId) {
  return state.projects.find((project) => project.id === projectId)?.title || "Geral";
}

function renderMessages() {
  const conversation = activeConversation();
  els.messageList.innerHTML = "";
  if (!conversation || !conversation.messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Comece uma conversa local.";
    els.messageList.appendChild(empty);
    return;
  }
  for (const message of conversation.messages) {
    els.messageList.appendChild(messageNode(message));
  }
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function messageNode(message) {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(message.role);
  if (message.streaming) node.classList.add("streaming");
  if (message.status) node.classList.add(message.status);
  node.querySelector(".message-avatar").textContent =
    message.role === "user" ? "VO" : "AI";
  node.querySelector(".message-meta").textContent = messageMeta(message);
  renderMessageContent(node.querySelector(".message-content"), message);
  node.querySelector(".message-body").appendChild(messageActions(message));
  return node;
}

function messageMeta(message) {
  const base = message.role === "user" ? "Voce" : "Assistente";
  const notes = [];
  if (message.edited_at) notes.push("editado");
  if (message.regenerated_from) notes.push("regenerado");
  if (message.status === "stopped") notes.push("interrompido");
  return notes.length ? `${base} · ${notes.join(" · ")}` : base;
}

function messageActions(message) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  if (message.role === "assistant") {
    actions.appendChild(actionButton("Regenerar", () => regenerateMessage(message)));
  }
  if (message.role === "user") {
    actions.appendChild(actionButton("Editar", () => editMessage(message)));
  }
  actions.appendChild(actionButton("Ramificar", () => branchFromMessage(message)));
  return actions;
}

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action";
  button.textContent = label;
  button.disabled = busy;
  button.addEventListener("click", handler);
  return button;
}

function renderMessageContent(container, message) {
  container.innerHTML = "";
  if (message.streaming && !message.content) {
    const typing = document.createElement("span");
    typing.className = "typing-text";
    typing.textContent = "Respondendo...";
    container.appendChild(typing);
    return;
  }

  const text = message.content || "";
  const codePattern = /```([\w.+-]*)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match = codePattern.exec(text);
  while (match) {
    appendMarkdownBlocks(container, text.slice(lastIndex, match.index));
    appendCodeBlock(container, match[2], match[1]);
    lastIndex = codePattern.lastIndex;
    match = codePattern.exec(text);
  }
  appendMarkdownBlocks(container, text.slice(lastIndex));
}

function appendMarkdownBlocks(container, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const node = document.createElement(`h${level}`);
      appendInlineMarkdown(node, heading[2]);
      container.appendChild(node);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const { table, nextIndex } = tableNode(lines, index);
      container.appendChild(table);
      index = nextIndex;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendInlineMarkdown(item, lines[index].replace(/^\s*[-*]\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendInlineMarkdown(item, lines[index].replace(/^\s*\d+\.\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quote = document.createElement("blockquote");
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s+/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s+/, ""));
        index += 1;
      }
      appendInlineMarkdown(quote, quoteLines.join("\n"));
      container.appendChild(quote);
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      container.appendChild(document.createElement("hr"));
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (
        /^(#{1,6})\s+/.test(lines[index]) ||
        /^\s*[-*]\s+/.test(lines[index]) ||
        /^\s*\d+\.\s+/.test(lines[index]) ||
        /^\s*>\s+/.test(lines[index]) ||
        isTableStart(lines, index)
      ) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    paragraph.className = "text-block";
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"));
    container.appendChild(paragraph);
  }
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    parent.appendChild(inlineNode(match[0]));
    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }
  parent.appendChild(document.createTextNode(text.slice(lastIndex)));
}

function inlineNode(token) {
  if (token.startsWith("`") && token.endsWith("`")) {
    const node = document.createElement("code");
    node.textContent = token.slice(1, -1);
    return node;
  }
  if (token.startsWith("**") && token.endsWith("**")) {
    const node = document.createElement("strong");
    node.textContent = token.slice(2, -2);
    return node;
  }
  if (token.startsWith("*") && token.endsWith("*")) {
    const node = document.createElement("em");
    node.textContent = token.slice(1, -1);
    return node;
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link && /^https?:\/\//i.test(link[2])) {
    const node = document.createElement("a");
    node.href = link[2];
    node.target = "_blank";
    node.rel = "noreferrer";
    node.textContent = link[1];
    return node;
  }
  return document.createTextNode(token);
}

function isTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    lines[index].includes("|") &&
    /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[index + 1])
  );
}

function tableNode(lines, index) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const header = document.createElement("tr");
  for (const cell of splitTableRow(lines[index])) {
    const th = document.createElement("th");
    appendInlineMarkdown(th, cell);
    header.appendChild(th);
  }
  thead.appendChild(header);
  index += 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    const row = document.createElement("tr");
    for (const cell of splitTableRow(lines[index])) {
      const td = document.createElement("td");
      appendInlineMarkdown(td, cell);
      row.appendChild(td);
    }
    tbody.appendChild(row);
    index += 1;
  }
  table.append(thead, tbody);
  return { table, nextIndex: index };
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function appendCodeBlock(container, code, language) {
  const block = document.createElement("section");
  block.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";

  const label = document.createElement("span");
  label.textContent = language || "codigo";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-code";
  copy.textContent = "Copiar";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "Copiado";
    } catch {
      copy.textContent = "Falhou";
    }
    setTimeout(() => {
      copy.textContent = "Copiar";
    }, 1200);
  });

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code.replace(/^\n|\n$/g, "");
  pre.appendChild(codeEl);
  header.append(label, copy);
  block.append(header, pre);
  container.appendChild(block);
}

function renderConversationForm() {
  const conversation = activeConversation();
  els.conversationTitle.value = conversation?.title || "Nova conversa";
  els.conversationMemory.value = conversation?.memory || "";
  els.conversationProject.value = conversation?.project_id || "default";
  els.conversationLabels.value = (conversation?.labels || []).join(", ");
  const hasConversation = Boolean(conversation);
  els.saveConversation.disabled = !hasConversation;
  els.deleteConversation.disabled = !hasConversation;
  els.saveConversationMemory.disabled = !hasConversation;
  els.conversationProject.disabled = !hasConversation;
  els.conversationLabels.disabled = !hasConversation;
}

function renderMemories() {
  els.memoryList.innerHTML = "";
  for (const memory of state.personal_memories) {
    els.memoryList.appendChild(
      editorNode({
        item: memory,
        kind: "memory",
        canActivate: false,
      })
    );
  }
}

function renderPrompts() {
  els.promptList.innerHTML = "";
  for (const prompt of state.custom_prompts) {
    els.promptList.appendChild(
      editorNode({
        item: prompt,
        kind: "prompt",
        canActivate: true,
      })
    );
  }
}

function renderAttachments() {
  const conversation = activeConversation();
  els.attachmentList.innerHTML = "";
  if (!conversation) return;
  for (const attachment of conversation.attachments || []) {
    const node = document.createElement("article");
    node.className = "editor-item attachment-item";
    const preview = (attachment.content || "").slice(0, 600);
    node.innerHTML = `
      <div class="editor-top">
        <strong></strong>
        <span class="attachment-size"></span>
      </div>
      <pre class="attachment-preview"></pre>
      <div class="editor-actions"></div>
    `;
    node.querySelector("strong").textContent = attachment.name;
    node.querySelector(".attachment-size").textContent = `${attachment.size || 0} bytes`;
    node.querySelector(".attachment-preview").textContent = preview;
    const actions = node.querySelector(".editor-actions");
    actions.appendChild(
      actionButton("Remover", () => deleteAttachment(attachment.id))
    );
    els.attachmentList.appendChild(node);
  }
}

function editorNode({ item, kind, canActivate }) {
  const node = els.editorTemplate.content.firstElementChild.cloneNode(true);
  const title = node.querySelector(".editor-title");
  const content = node.querySelector(".editor-content");
  const enabled = node.querySelector(".editor-enabled");
  const activate = node.querySelector(".editor-activate");
  const save = node.querySelector(".editor-save");
  const remove = node.querySelector(".editor-delete");
  title.value = item.title;
  content.value = item.content;
  enabled.checked = item.enabled;

  if (!canActivate) {
    activate.remove();
  } else {
    activate.disabled = state.settings.active_prompt_id === item.id;
    activate.textContent =
      state.settings.active_prompt_id === item.id ? "Em uso" : "Usar";
    activate.addEventListener("click", () => setActivePrompt(item.id));
  }

  if (kind === "prompt" && item.id === "default") {
    remove.disabled = true;
  }

  save.addEventListener("click", () =>
    saveEditorItem(kind, item.id, {
      title: title.value,
      content: content.value,
      enabled: enabled.checked,
    })
  );
  remove.addEventListener("click", () => deleteEditorItem(kind, item.id));
  return node;
}

function renderSettings() {
  const settings = state.settings;
  els.defaultSystemPrompt.value = settings.default_system_prompt || "";
  els.modelOverride.value = settings.model || "";
  els.historyLimit.value = settings.history_limit || 30;
  els.includePersonalMemories.checked = Boolean(
    settings.include_personal_memories
  );
  els.includeConversationMemory.checked = Boolean(
    settings.include_conversation_memory
  );
  els.themeToggle.textContent = settings.theme === "dark" ? "Claro" : "Escuro";
}

function renderBusyState() {
  els.sendButton.disabled = busy;
  els.stopButton.disabled = !busy || !currentAbortController;
}

async function createConversation() {
  const projectId = els.projectFilter.value && els.projectFilter.value !== "all"
    ? els.projectFilter.value
    : "default";
  const payload = await fetchJson("/chat/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Nova conversa", project_id: projectId }),
  });
  applyState(payload);
  activeConversationId = payload.conversation.id;
  render();
}

async function saveConversation() {
  const conversation = activeConversation();
  if (!conversation) return;
  const payload = await fetchJson(`/chat/api/conversations/${conversation.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: els.conversationTitle.value,
      memory: conversation.memory || "",
      project_id: els.conversationProject.value,
      labels: parseLabels(els.conversationLabels.value),
    }),
  });
  applyState(payload);
  render();
}

async function saveConversationMemory() {
  const conversation = activeConversation();
  if (!conversation) return;
  const payload = await fetchJson(`/chat/api/conversations/${conversation.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: els.conversationTitle.value,
      memory: els.conversationMemory.value,
      project_id: els.conversationProject.value,
      labels: parseLabels(els.conversationLabels.value),
    }),
  });
  applyState(payload);
  render();
}

function parseLabels(value) {
  return value
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

async function deleteConversation() {
  const conversation = activeConversation();
  if (!conversation) return;
  await deleteConversationById(conversation.id);
}

async function deleteConversationById(conversationId) {
  if (!window.confirm("Apagar esta conversa do historico local?")) return;
  const payload = await fetchJson(`/chat/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
  applyState(payload);
  if (activeConversationId === conversationId) {
    activeConversationId = state.conversations[0]?.id || null;
  }
  if (!activeConversationId) {
    await createConversation();
    return;
  }
  render();
}

async function addMemory() {
  const payload = await fetchJson("/chat/api/memories", {
    method: "POST",
    body: JSON.stringify({
      title: "Nova memoria",
      content: "",
      enabled: true,
    }),
  });
  applyState(payload);
  render();
}

async function addPrompt() {
  const payload = await fetchJson("/chat/api/prompts", {
    method: "POST",
    body: JSON.stringify({
      title: "Novo prompt",
      content: "",
      enabled: true,
    }),
  });
  applyState(payload);
  render();
}

async function saveEditorItem(kind, id, data) {
  const base = kind === "memory" ? "memories" : "prompts";
  const payload = await fetchJson(`/chat/api/${base}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  applyState(payload);
  render();
}

async function deleteEditorItem(kind, id) {
  const base = kind === "memory" ? "memories" : "prompts";
  const payload = await fetchJson(`/chat/api/${base}/${id}`, {
    method: "DELETE",
  });
  applyState(payload);
  render();
}

async function setActivePrompt(promptId) {
  const payload = await fetchJson("/chat/api/settings", {
    method: "PUT",
    body: JSON.stringify({ active_prompt_id: promptId }),
  });
  applyState(payload);
  render();
}

async function saveSettings() {
  const payload = await fetchJson("/chat/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      default_system_prompt: els.defaultSystemPrompt.value,
      model: els.modelOverride.value,
      history_limit: Number(els.historyLimit.value || 30),
      include_personal_memories: els.includePersonalMemories.checked,
      include_conversation_memory: els.includeConversationMemory.checked,
      theme: state.settings.theme || "light",
    }),
  });
  applyState(payload);
  render();
}

async function createProjectFromSelect() {
  const title = window.prompt("Nome do projeto");
  if (!title) {
    renderProjectControls();
    return;
  }
  const payload = await fetchJson("/chat/api/projects", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  applyState(payload);
  els.conversationProject.value = payload.project.id;
  await saveConversation();
}

async function toggleTheme() {
  const nextTheme = state.settings.theme === "dark" ? "light" : "dark";
  const payload = await fetchJson("/chat/api/settings", {
    method: "PUT",
    body: JSON.stringify({ theme: nextTheme }),
  });
  applyState(payload);
  render();
}

async function sendMessage(event) {
  event.preventDefault();
  if (busy) return;
  let conversation = activeConversation();
  if (!conversation) {
    await createConversation();
    conversation = activeConversation();
  }
  const content = els.messageInput.value.trim();
  if (!content || !conversation) return;

  const pendingUser = {
    id: "pending-user",
    role: "user",
    content,
    created_at: new Date().toISOString(),
  };
  const pendingAssistant = pendingAssistantMessage();
  conversation.messages.push(pendingUser, pendingAssistant);
  els.messageInput.value = "";
  await streamIntoPending({
    endpoint: `/chat/api/conversations/${conversation.id}/messages`,
    body: { content, model: els.modelOverride.value },
    pendingAssistant,
  });
}

function pendingAssistantMessage() {
  return {
    id: `pending-${Date.now()}`,
    role: "assistant",
    content: "",
    created_at: new Date().toISOString(),
    streaming: true,
  };
}

async function regenerateMessage(message) {
  const conversation = activeConversation();
  if (!conversation || busy) return;
  const pendingAssistant = pendingAssistantMessage();
  pendingAssistant.regenerated_from = message.id;
  conversation.messages.push(pendingAssistant);
  await streamIntoPending({
    endpoint: `/chat/api/conversations/${conversation.id}/regenerate`,
    body: { message_id: message.id },
    pendingAssistant,
  });
}

async function regenerateFromMessageId(messageId) {
  const conversation = activeConversation();
  if (!conversation || busy) return;
  const pendingAssistant = pendingAssistantMessage();
  pendingAssistant.regenerated_from = messageId;
  conversation.messages.push(pendingAssistant);
  await streamIntoPending({
    endpoint: `/chat/api/conversations/${conversation.id}/regenerate`,
    body: { message_id: messageId },
    pendingAssistant,
  });
}

async function editMessage(message) {
  if (busy) return;
  const content = window.prompt("Editar mensagem", message.content);
  if (content === null || content.trim() === message.content.trim()) return;
  const conversation = activeConversation();
  const payload = await fetchJson(`/chat/api/conversations/${conversation.id}/branch`, {
    method: "POST",
    body: JSON.stringify({ message_id: message.id, edited_content: content }),
  });
  applyState(payload);
  activeConversationId = payload.conversation.id;
  render();
  await regenerateFromMessageId(payload.focus_message_id);
}

async function branchFromMessage(message) {
  if (busy) return;
  const conversation = activeConversation();
  const payload = await fetchJson(`/chat/api/conversations/${conversation.id}/branch`, {
    method: "POST",
    body: JSON.stringify({ message_id: message.id }),
  });
  applyState(payload);
  activeConversationId = payload.conversation.id;
  render();
}

async function streamIntoPending({ endpoint, body, pendingAssistant }) {
  busy = true;
  currentAbortController = new AbortController();
  renderBusyState();
  renderMessages();

  try {
    await streamAssistantResponse(endpoint, body, pendingAssistant);
  } catch (error) {
    pendingAssistant.streaming = false;
    if (error.name === "AbortError") {
      pendingAssistant.status = "stopped";
      pendingAssistant.content =
        pendingAssistant.content || "Geracao interrompida pelo usuario.";
    } else {
      pendingAssistant.content = `Erro: ${error.message}`;
    }
    renderMessages();
  } finally {
    busy = false;
    currentAbortController = null;
    renderBusyState();
    els.messageInput.focus();
  }
}

async function streamAssistantResponse(endpoint, body, pendingAssistant) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: currentAbortController.signal,
  });
  if (!response.ok) {
    throw new Error(await responseErrorDetail(response));
  }
  if (!response.body) {
    const payload = await response.json();
    applyState(payload);
    render();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer = consumeSseBuffer(buffer, (eventName, data) => {
      if (eventName === "delta") {
        pendingAssistant.content += data.text || "";
        renderMessages();
      }
      if (eventName === "done") {
        sawDone = true;
        pendingAssistant.streaming = false;
        applyState(data);
        render();
      }
      if (eventName === "error") {
        throw new Error(data.detail || "Falha ao gerar resposta");
      }
    });
    if (done) break;
  }

  if (buffer.trim()) {
    consumeSseBuffer(`${buffer}\n\n`, (eventName, data) => {
      if (eventName === "done") {
        sawDone = true;
        pendingAssistant.streaming = false;
        applyState(data);
        render();
      }
      if (eventName === "error") {
        throw new Error(data.detail || "Falha ao gerar resposta");
      }
    });
  }
  if (!sawDone) await loadState();
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

function consumeSseBuffer(buffer, onEvent) {
  buffer = buffer.replace(/\r\n/g, "\n");
  let boundary = buffer.indexOf("\n\n");
  while (boundary !== -1) {
    const rawEvent = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    handleSseEvent(rawEvent, onEvent);
    boundary = buffer.indexOf("\n\n");
  }
  return buffer;
}

function handleSseEvent(rawEvent, onEvent) {
  let eventName = "message";
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  onEvent(eventName, JSON.parse(dataLines.join("\n")));
}

async function attachSelectedFiles() {
  const conversation = activeConversation();
  if (!conversation || !els.fileInput.files.length) return;
  for (const file of els.fileInput.files) {
    if (file.size > 500000) {
      window.alert(`${file.name} e maior que 500 KB. Pulei este arquivo.`);
      continue;
    }
    const content = await file.text();
    const payload = await fetchJson(
      `/chat/api/conversations/${conversation.id}/attachments`,
      {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          content,
          content_type: file.type || "text/plain",
          size: file.size,
        }),
      }
    );
    applyState(payload);
  }
  els.fileInput.value = "";
  render();
}

async function deleteAttachment(attachmentId) {
  const conversation = activeConversation();
  if (!conversation) return;
  const payload = await fetchJson(
    `/chat/api/conversations/${conversation.id}/attachments/${attachmentId}`,
    { method: "DELETE" }
  );
  applyState(payload);
  render();
}

async function responseErrorDetail(response) {
  try {
    const body = await response.json();
    return body.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

function activateTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  for (const view of document.querySelectorAll(".tab-view")) {
    view.classList.toggle("active", view.id === `tab-${name}`);
  }
}

function wireEvents() {
  els.newConversation.addEventListener("click", createConversation);
  els.historySearch.addEventListener("input", renderConversations);
  els.projectFilter.addEventListener("change", renderConversations);
  els.conversationProject.addEventListener("change", () => {
    if (els.conversationProject.value === "__new__") {
      createProjectFromSelect();
    }
  });
  els.themeToggle.addEventListener("click", toggleTheme);
  els.saveConversation.addEventListener("click", saveConversation);
  els.deleteConversation.addEventListener("click", deleteConversation);
  els.saveConversationMemory.addEventListener("click", saveConversationMemory);
  els.addMemory.addEventListener("click", addMemory);
  els.addPrompt.addEventListener("click", addPrompt);
  els.attachFiles.addEventListener("click", attachSelectedFiles);
  els.saveSettings.addEventListener("click", saveSettings);
  els.stopButton.addEventListener("click", stopGeneration);
  els.composer.addEventListener("submit", sendMessage);
  els.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  }
}

wireEvents();
loadState().catch((error) => {
  els.messageList.textContent = `Falha ao carregar: ${error.message}`;
});
