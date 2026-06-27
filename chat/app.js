import {
  initDb,
  saveConversation,
  getConversations,
  getConversation,
  deleteConversation,
  saveMessage,
  getMessages
} from './db.js';

// -------------------------------------------------------------
// App State
// -------------------------------------------------------------
let currentConvoId = null;
let conversationsList = [];
let serverUrl = localStorage.getItem('pwallm_server_url') || 'http://localhost:8080';
let activeModel = localStorage.getItem('pwallm_active_model') || '';
let isGenerating = false;
let abortController = null;
let theme = localStorage.getItem('pwallm_theme') || 'system';

// Settings
const defaultSettings = {
  systemPrompt: 'You are a helpful, respectful, and honest assistant.',
  temperature: 0.7,
  maxTokens: 2048
};
let settings = {
  systemPrompt: localStorage.getItem('pwallm_sys_prompt') || defaultSettings.systemPrompt,
  temperature: parseFloat(localStorage.getItem('pwallm_temperature')) || defaultSettings.temperature,
  maxTokens: parseInt(localStorage.getItem('pwallm_max_tokens'), 10) || defaultSettings.maxTokens
};

// -------------------------------------------------------------
// DOM Elements
// -------------------------------------------------------------
const sidebar = document.getElementById('app-sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const conversationsListEl = document.getElementById('conversations-list');
const newChatBtn = document.getElementById('new-chat-btn');

const serverUrlInput = document.getElementById('server-url');
const testConnectionBtn = document.getElementById('test-connection-btn');
const pingIcon = document.getElementById('ping-icon');
const statusBadge = document.getElementById('status-badge');
const modelSelector = document.getElementById('model-selector');
const refreshModelsBtn = document.getElementById('refresh-models-btn');

const chatTitleEl = document.getElementById('active-chat-title');
const activeModelBadge = document.getElementById('active-model-badge');
const messagesContainer = document.getElementById('messages-container');
const welcomeSplash = document.getElementById('welcome-splash');
const thinkingIndicator = document.getElementById('thinking-indicator');

const liveStatsBar = document.getElementById('live-stats-bar');
const statTps = document.getElementById('stat-tps');
const statTime = document.getElementById('stat-time');
const statTokens = document.getElementById('stat-tokens');

const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

// Home-screen panels
const serverOfflineOverlay = document.getElementById('server-offline-overlay');
const homeSettingsPanel = document.getElementById('home-settings-panel');
const chatInputContainer = document.getElementById('chat-input-container');
const startChatBtn = document.getElementById('start-chat-btn');

// Sampling inputs on home screen
const systemPromptInput = document.getElementById('system-prompt');
const tempSlider = document.getElementById('temp-slider');
const tempVal = document.getElementById('temp-val');
const maxTokensInput = document.getElementById('max-tokens-input');

const installPwaBtn = document.getElementById('install-pwa-btn');
const themeToggleHeader = document.getElementById('theme-toggle-header');
const themeToggleMobile = document.getElementById('theme-toggle-mobile');

// -------------------------------------------------------------
// Init Application
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Set up inputs with stored values
  serverUrlInput.value = serverUrl;
  systemPromptInput.value = settings.systemPrompt;
  tempSlider.value = settings.temperature;
  tempVal.textContent = settings.temperature;
  maxTokensInput.value = settings.maxTokens;
  
  // Apply theme immediately
  applyTheme(theme);

  // Initialize DB
  try {
    await initDb();
    await loadConversationsList();
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }

  // Connect to llama.cpp
  checkServerConnection(true);

  // Setup Event Listeners
  setupEventListeners();
  
  // Create dynamic helper for copying code
  window.copyCodeToClipboard = copyCodeToClipboard;
});

// -------------------------------------------------------------
// Event Listeners Setup
// -------------------------------------------------------------
function setupEventListeners() {
  // Sidebar toggles (mobile)
  sidebarToggle.addEventListener('click', () => toggleSidebar(true));
  sidebarClose.addEventListener('click', () => toggleSidebar(false));
  sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

  // Chat Actions
  newChatBtn.addEventListener('click', () => {
    createNewConversation();
    toggleSidebar(false);
  });
  
  // Connection and model selection
  serverUrlInput.addEventListener('change', () => {
    serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('pwallm_server_url', serverUrl);
    checkServerConnection();
  });
  
  testConnectionBtn.addEventListener('click', () => checkServerConnection());
  
  refreshModelsBtn.addEventListener('click', () => fetchModels());
  
  modelSelector.addEventListener('change', () => {
    activeModel = modelSelector.value;
    localStorage.setItem('pwallm_active_model', activeModel);
    updateActiveModelDisplay();
  });

  // Home-screen settings live auto-save
  systemPromptInput.addEventListener('input', () => {
    settings.systemPrompt = systemPromptInput.value.trim();
    localStorage.setItem('pwallm_sys_prompt', settings.systemPrompt);
  });

  tempSlider.addEventListener('input', (e) => {
    tempVal.textContent = e.target.value;
    settings.temperature = parseFloat(e.target.value);
    localStorage.setItem('pwallm_temperature', settings.temperature);
  });

  maxTokensInput.addEventListener('input', () => {
    const val = parseInt(maxTokensInput.value, 10);
    if (!isNaN(val) && val > 0) {
      settings.maxTokens = val;
      localStorage.setItem('pwallm_max_tokens', settings.maxTokens);
    }
  });

  // Start Chatting Action
  startChatBtn.addEventListener('click', startChatting);

  // User input behavior (textarea autosize and send triggers)
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = userInput.scrollHeight + 'px';
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const isMobile = window.innerWidth <= 900;
      if (!isMobile || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isGenerating) {
          sendMessage();
        }
      }
    }
  });

  sendBtn.addEventListener('click', sendMessage);
  stopBtn.addEventListener('click', abortGeneration);

  // Theme Toggle click listeners (Header & Mobile)
  const cycleTheme = () => {
    let nextTheme = 'system';
    if (theme === 'system') nextTheme = 'light';
    else if (theme === 'light') nextTheme = 'dark';
    
    theme = nextTheme;
    localStorage.setItem('pwallm_theme', theme);
    applyTheme(theme);
  };

  if (themeToggleHeader) {
    themeToggleHeader.addEventListener('click', cycleTheme);
  }
  if (themeToggleMobile) {
    themeToggleMobile.addEventListener('click', cycleTheme);
  }

  // PWA Install Prompt Handler
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installPwaBtn) {
      installPwaBtn.classList.remove('hide');
    }
  });

  if (installPwaBtn) {
    installPwaBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install: ${outcome}`);
      deferredPrompt = null;
      installPwaBtn.classList.add('hide');
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('pwallm was installed successfully!');
    deferredPrompt = null;
    if (installPwaBtn) {
      installPwaBtn.classList.add('hide');
    }
  });
}

// -------------------------------------------------------------
// Theme Management
// -------------------------------------------------------------
function applyTheme(themeValue) {
  if (themeValue === 'dark') {
    document.documentElement.classList.add('theme-dark');
    document.documentElement.classList.remove('theme-light');
  } else if (themeValue === 'light') {
    document.documentElement.classList.add('theme-light');
    document.documentElement.classList.remove('theme-dark');
  } else {
    document.documentElement.classList.remove('theme-light');
    document.documentElement.classList.remove('theme-dark');
  }

  // Update button icons
  const updateToggleIcon = (btn, val) => {
    if (!btn) return;
    
    let iconName = 'monitor';
    if (val === 'light') iconName = 'sun';
    else if (val === 'dark') iconName = 'moon';
    
    btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    
    let titleStr = 'Theme: System';
    if (val === 'light') titleStr = 'Theme: Light';
    else if (val === 'dark') titleStr = 'Theme: Dark';
    btn.setAttribute('title', titleStr);
  };

  updateToggleIcon(themeToggleHeader, themeValue);
  updateToggleIcon(themeToggleMobile, themeValue);
  
  if (window.lucide) {
    lucide.createIcons();
  }
}

// -------------------------------------------------------------
// Sidebar / Responsiveness
// -------------------------------------------------------------
function toggleSidebar(open) {
  if (open) {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('show');
  } else {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
  }
}

// -------------------------------------------------------------
// Llama.cpp Server Integrations
// -------------------------------------------------------------
async function checkServerConnection(isOnInit = false) {
  statusBadge.textContent = 'Checking...';
  statusBadge.className = 'badge badge-checking';
  pingIcon.style.animation = 'spin 1s linear infinite';
  
  // Inject keyframe if not present
  if (!document.getElementById('spin-keyframes')) {
    const style = document.createElement('style');
    style.id = 'spin-keyframes';
    style.innerHTML = '@keyframes spin { 100% { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  try {
    const response = await fetch(`${serverUrl}/v1/models`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (response.ok) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'badge badge-connected';
      refreshModelsBtn.disabled = false;
      modelSelector.disabled = false;
      
      // Toggle home screen panels
      serverOfflineOverlay.classList.add('hide');
      homeSettingsPanel.classList.remove('hide');
      
      await fetchModels(isOnInit);
    } else {
      throw new Error('Server returned non-ok status');
    }
  } catch (err) {
    console.warn('Llama server ping failed:', err);
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge badge-disconnected';
    modelSelector.disabled = true;
    refreshModelsBtn.disabled = true;
    userInput.disabled = true;
    userInput.placeholder = 'Connect server to start chatting...';
    sendBtn.disabled = true;

    // Toggle home screen panels (Show offline setup instructions)
    serverOfflineOverlay.classList.remove('hide');
    homeSettingsPanel.classList.add('hide');
  } finally {
    pingIcon.style.animation = '';
  }
}

async function fetchModels(isOnInit = false) {
  try {
    modelSelector.innerHTML = '<option value="">Loading models...</option>';
    const response = await fetch(`${serverUrl}/v1/models`);
    if (!response.ok) throw new Error('Failed to fetch models');
    
    const data = await response.json();
    const models = data.data || [];
    
    if (models.length === 0) {
      modelSelector.innerHTML = '<option value="">No models loaded on server</option>';
      activeModel = '';
      updateActiveModelDisplay();
      return;
    }
    
    modelSelector.innerHTML = '';
    models.forEach((model) => {
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.id;
      if (model.id === activeModel) {
        opt.selected = true;
      }
      modelSelector.appendChild(opt);
    });
    
    // Default to first model if current isn't in list or not set
    const modelIds = models.map(m => m.id);
    if (!modelIds.includes(activeModel)) {
      activeModel = modelIds[0];
      modelSelector.value = activeModel;
      localStorage.setItem('pwallm_active_model', activeModel);
    }
    
    updateActiveModelDisplay();
    
    if (activeModel) {
      userInput.disabled = false;
      userInput.placeholder = 'Type a message... (Cmd+Enter to send)';
      sendBtn.disabled = false;
    }
  } catch (err) {
    console.error('Error fetching models:', err);
    modelSelector.innerHTML = '<option value="">Error fetching models</option>';
    activeModel = '';
    updateActiveModelDisplay();
  }
}

function updateActiveModelDisplay() {
  if (activeModel) {
    activeModelBadge.textContent = activeModel;
    activeModelBadge.classList.remove('hide');
    if (!isGenerating) {
      userInput.disabled = false;
      userInput.placeholder = 'Type a message... (Cmd+Enter to send)';
      sendBtn.disabled = false;
    }
  } else {
    activeModelBadge.textContent = 'No model selected';
    activeModelBadge.classList.add('hide');
    userInput.disabled = true;
    userInput.placeholder = 'Select a model to begin...';
    sendBtn.disabled = true;
  }
}

// -------------------------------------------------------------
// Conversation & UI Management
// -------------------------------------------------------------
async function loadConversationsList() {
  try {
    conversationsList = await getConversations();
    conversationsListEl.innerHTML = '';
    
    if (conversationsList.length === 0) {
      conversationsListEl.innerHTML = '<div class="convo-empty-state">No conversations yet</div>';
      return;
    }
    
    conversationsList.forEach((convo) => {
      const isSelected = convo.id === currentConvoId;
      const dateStr = new Date(convo.updatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const item = document.createElement('div');
      item.className = `convo-item ${isSelected ? 'active' : ''}`;
      item.dataset.id = convo.id;
      
      item.innerHTML = `
        <div class="convo-details">
          <div class="convo-title" id="title-text-${convo.id}">${escapeHtml(convo.title)}</div>
          <div class="convo-meta">${dateStr}</div>
        </div>
        <div class="convo-actions">
          <button class="btn-convo-action edit-title" title="Rename Conversation" data-id="${convo.id}">
            <i data-lucide="edit-3"></i>
          </button>
          <button class="btn-convo-action delete" title="Delete Conversation" data-id="${convo.id}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-convo-action') || e.target.closest('.convo-edit-input')) {
          return;
        }
        selectConversation(convo.id);
      });

      const editBtn = item.querySelector('.edit-title');
      editBtn.addEventListener('click', () => startRenameConvo(convo.id));

      const deleteBtn = item.querySelector('.delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete the conversation "${convo.title}"?`)) {
          await deleteConversationHandler(convo.id);
        }
      });

      conversationsListEl.appendChild(item);
    });

    if (window.lucide) {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

async function selectConversation(id) {
  if (isGenerating) {
    alert('Please stop the current model generation before switching chats.');
    return;
  }
  
  currentConvoId = id;
  
  // Highlight active
  document.querySelectorAll('.convo-item').forEach((item) => {
    if (item.dataset.id === id) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  try {
    const convo = await getConversation(id);
    if (!convo) return;

    chatTitleEl.textContent = convo.title;
    
    // UI state transitions (Switch to chat view)
    welcomeSplash.classList.add('hide');
    chatInputContainer.classList.remove('hide');
    messagesContainer.innerHTML = '';

    const messages = await getMessages(id);
    messages.forEach((msg) => {
      renderMessage(msg);
    });

    // Populate active model badge based on the conversation's frozen model
    activeModelBadge.textContent = convo.modelId || 'Default Model';
    activeModelBadge.classList.remove('hide');

    userInput.disabled = false;
    userInput.placeholder = 'Type a message... (Cmd+Enter to send)';
    sendBtn.disabled = false;

    scrollToBottom();
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function createNewConversation() {
  if (isGenerating) {
    alert('Please stop the current model generation first.');
    return;
  }
  
  currentConvoId = null;
  chatTitleEl.textContent = 'New Conversation';
  
  // UI state transitions (Switch to Home/Splash Settings view)
  welcomeSplash.classList.remove('hide');
  chatInputContainer.classList.add('hide');
  messagesContainer.innerHTML = '';
  
  // Populate active model display based on currently selected configuration model
  updateActiveModelDisplay();
  
  // Unhighlight active item
  document.querySelectorAll('.convo-item').forEach((item) => {
    item.classList.remove('active');
  });

  userInput.value = '';
  userInput.style.height = 'auto';
}

function startChatting() {
  if (!activeModel) {
    alert('Please select an active model first.');
    return;
  }
  welcomeSplash.classList.add('hide');
  chatInputContainer.classList.remove('hide');
  userInput.disabled = false;
  userInput.placeholder = 'Type a message... (Cmd+Enter to send)';
  sendBtn.disabled = false;
  userInput.focus();
  scrollToBottom();
}

async function deleteConversationHandler(id) {
  try {
    await deleteConversation(id);
    if (currentConvoId === id) {
      createNewConversation();
    }
    await loadConversationsList();
  } catch (err) {
    console.error('Failed to delete conversation:', err);
  }
}

function startRenameConvo(id) {
  const titleContainer = document.getElementById(`title-text-${id}`);
  if (!titleContainer) return;

  const currentTitle = titleContainer.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'convo-edit-input';
  input.value = currentTitle;
  
  titleContainer.innerHTML = '';
  titleContainer.appendChild(input);
  input.focus();
  input.select();

  const saveRename = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      try {
        const convo = await getConversation(id);
        convo.title = newTitle;
        await saveConversation(convo);
        await loadConversationsList();
        if (currentConvoId === id) {
          chatTitleEl.textContent = newTitle;
        }
      } catch (err) {
        console.error('Error saving new title:', err);
        titleContainer.textContent = currentTitle;
      }
    } else {
      titleContainer.textContent = currentTitle;
    }
  };

  input.addEventListener('blur', saveRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveRename();
    } else if (e.key === 'Escape') {
      titleContainer.textContent = currentTitle;
    }
  });
}

// -------------------------------------------------------------
// Message Rendering & Formatting
// -------------------------------------------------------------
function renderMessage(msg, targetContainer = null, isStreaming = false) {
  const isUser = msg.role === 'user';
  
  let msgDiv;
  if (targetContainer) {
    msgDiv = targetContainer;
  } else {
    msgDiv = document.createElement('div');
    msgDiv.className = `message ${isUser ? 'message-user' : 'message-assistant'}`;
    msgDiv.id = `msg-${msg.id}`;
    messagesContainer.appendChild(msgDiv);
  }

  let contentHtml = parseMarkdown(msg.content);
  if (isStreaming && !isUser) {
    contentHtml += '<span class="streaming-cursor"></span>';
  }

  const bubbleHtml = `<div class="message-bubble">${contentHtml}</div>`;
  
  let statsHtml = '';
  if (!isUser && msg.stats) {
    statsHtml = `
      <div class="message-stats">
        <span>⚡ ${msg.stats.tokensPerSec.toFixed(1)} tok/s</span>
        <span>⏱️ ${msg.stats.generationTime.toFixed(1)}s</span>
        <span>#️⃣ ${msg.stats.totalTokens} tokens</span>
      </div>
    `;
  }

  msgDiv.innerHTML = bubbleHtml + statsHtml;
  
  if (!isStreaming && window.lucide) {
    lucide.createIcons();
  }
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// -------------------------------------------------------------
// Send & Stream Logic
// -------------------------------------------------------------
async function sendMessage() {
  if (isGenerating || !activeModel) return;

  const content = userInput.value.trim();
  if (!content) return;

  // Abort controller set
  abortController = new AbortController();

  // Create Convo in DB if it doesn't exist
  let isNewConvo = false;
  if (!currentConvoId) {
    isNewConvo = true;
    currentConvoId = 'convo_' + Date.now();
    const firstTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
    const newConvo = {
      id: currentConvoId,
      title: firstTitle,
      modelId: activeModel,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens
    };
    await saveConversation(newConvo);
    chatTitleEl.textContent = firstTitle;
    await loadConversationsList();
  }

  // Create User Message
  const userMsg = {
    id: 'msg_' + Date.now(),
    conversationId: currentConvoId,
    role: 'user',
    content: content,
    timestamp: Date.now()
  };
  await saveMessage(userMsg);
  renderMessage(userMsg);
  
  // Reset Textarea
  userInput.value = '';
  userInput.style.height = 'auto';
  scrollToBottom();

  // Load prior messages to feed to model (including system prompt)
  const previousMsgs = await getMessages(currentConvoId);
  const apiMessages = [];

  // Add system prompt if defined
  if (settings.systemPrompt) {
    apiMessages.push({ role: 'system', content: settings.systemPrompt });
  }
  
  previousMsgs.forEach(m => {
    apiMessages.push({ role: m.role, content: m.content });
  });

  // Prepare Assistant placeholder Message
  const assistantMsgId = 'msg_' + (Date.now() + 1);
  const assistantMsg = {
    id: assistantMsgId,
    conversationId: currentConvoId,
    role: 'assistant',
    content: '',
    timestamp: Date.now()
  };

  // UI status updates
  isGenerating = true;
  sendBtn.disabled = true;
  userInput.disabled = true;
  stopBtn.classList.remove('hide');
  thinkingIndicator.classList.remove('hide');
  liveStatsBar.classList.remove('hide');
  scrollToBottom();

  // Init stats
  let startTime = performance.now();
  let firstTokenTime = null;
  let chunkCount = 0;
  let accumContent = '';
  let tokenUsage = null;

  // Create assistant message element in DOM
  const assistantMsgDiv = document.createElement('div');
  assistantMsgDiv.className = 'message message-assistant';
  assistantMsgDiv.id = `msg-${assistantMsgId}`;
  messagesContainer.appendChild(assistantMsgDiv);

  try {
    const response = await fetch(`${serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model: activeModel,
        messages: apiMessages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true,
        stream_options: { include_usage: true }
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    thinkingIndicator.classList.add('hide');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            
            if (data.usage) {
              tokenUsage = data.usage;
            }

            if (data.choices && data.choices[0] && data.choices[0].delta) {
              const delta = data.choices[0].delta;
              if (delta.content) {
                if (!firstTokenTime) {
                  firstTokenTime = performance.now();
                }
                accumContent += delta.content;
                chunkCount++;
                
                // Render streaming chunk
                assistantMsg.content = accumContent;
                renderMessage(assistantMsg, assistantMsgDiv, true);
                
                // Update live speed statistics panel
                const elapsedMs = performance.now() - startTime;
                const elapsedSec = elapsedMs / 1000;
                const tps = chunkCount / elapsedSec;
                
                statTps.textContent = tps.toFixed(1);
                statTime.textContent = elapsedSec.toFixed(1) + 's';
                statTokens.textContent = chunkCount;

                scrollToBottom();
              }
            }
          } catch (e) {
            console.error('Failed to parse SSE JSON:', e, trimmed);
          }
        }
      }
    }

    // Finalize Generation Stats
    const totalDuration = (performance.now() - startTime) / 1000;
    const finalTokens = tokenUsage ? tokenUsage.completion_tokens : chunkCount;
    const finalTps = finalTokens / totalDuration;

    assistantMsg.content = accumContent;
    assistantMsg.stats = {
      tokensPerSec: finalTps,
      generationTime: totalDuration,
      totalTokens: finalTokens
    };

    // Save final message in DB
    await saveMessage(assistantMsg);
    renderMessage(assistantMsg, assistantMsgDiv, false);
    
    // Save updated title if first message
    if (isNewConvo) {
      await loadConversationsList();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Stream generation aborted by user.');
      // Save what was generated so far
      assistantMsg.content = accumContent || '[Generation stopped by user]';
      const partialDuration = (performance.now() - startTime) / 1000;
      assistantMsg.stats = {
        tokensPerSec: chunkCount / (partialDuration || 1),
        generationTime: partialDuration,
        totalTokens: chunkCount
      };
      await saveMessage(assistantMsg);
      renderMessage(assistantMsg, assistantMsgDiv, false);
    } else {
      console.error('Stream completion failed:', err);
      thinkingIndicator.classList.add('hide');
      assistantMsg.content = accumContent + `\n\n*(Error: Connection to llama server failed mid-generation.)*`;
      await saveMessage(assistantMsg);
      renderMessage(assistantMsg, assistantMsgDiv, false);
    }
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    stopBtn.classList.add('hide');
    liveStatsBar.classList.add('hide');
    scrollToBottom();
    userInput.focus();
  }
}

function abortGeneration() {
  if (abortController) {
    abortController.abort();
  }
}

// -------------------------------------------------------------
// Markdown Simple Parser
// -------------------------------------------------------------
function parseMarkdown(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);
  
  // Format code blocks (```lang ... ```)
  const codeBlockRegex = /```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```/g;
  escaped = escaped.replace(codeBlockRegex, (match, code) => {
    const uniqueId = 'code_' + Math.random().toString(36).substring(2, 9);
    return `
      <div class="code-header">
        <span>Code</span>
        <button class="btn-copy-code" onclick="copyCodeToClipboard('${uniqueId}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
        </button>
      </div>
      <pre><code id="${uniqueId}">${code}</code></pre>
    `;
  });

  // Format inline code (`code`)
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Format Bold (**text**)
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Format Italic (*text*)
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Newlines to HTML breaks
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

function copyCodeToClipboard(elementId) {
  const codeEl = document.getElementById(elementId);
  if (!codeEl) return;
  
  const text = codeEl.innerText || codeEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert('Code copied to clipboard!');
  }).catch((err) => {
    console.error('Failed to copy code:', err);
  });
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
