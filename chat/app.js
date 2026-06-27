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

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const settingsToggle = document.getElementById('settings-toggle');
const settingsToggleMobile = document.getElementById('settings-toggle-mobile');
const settingsClose = document.getElementById('settings-close');
const systemPromptInput = document.getElementById('system-prompt');
const tempSlider = document.getElementById('temp-slider');
const tempVal = document.getElementById('temp-val');
const maxTokensInput = document.getElementById('max-tokens-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const clearAllDataBtn = document.getElementById('clear-all-data-btn');
const installPwaBtn = document.getElementById('install-pwa-btn');
const themeSelector = document.getElementById('theme-selector');
const themeToggleHeader = document.getElementById('theme-toggle-header');
const themeToggleMobile = document.getElementById('theme-toggle-mobile');

// -------------------------------------------------------------
// Init Application
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize icons
  lucide.createIcons();
  
  // Set up inputs with stored values
  serverUrlInput.value = serverUrl;
  systemPromptInput.value = settings.systemPrompt;
  tempSlider.value = settings.temperature;
  tempVal.textContent = settings.temperature;
  maxTokensInput.value = settings.maxTokens;
  themeSelector.value = theme;
  
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

  // User input behavior (textarea autosize and send triggers)
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = userInput.scrollHeight + 'px';
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // For desktop: Command+Enter or Ctrl+Enter or just Enter
      // If it's a mobile device, we let Enter make a newline, and use Send button.
      // But typically check if not generating and send.
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

  // Settings Modal toggles
  const openModal = () => {
    settingsModal.classList.remove('hide');
    // Reload settings in inputs
    systemPromptInput.value = settings.systemPrompt;
    tempSlider.value = settings.temperature;
    tempVal.textContent = settings.temperature;
    maxTokensInput.value = settings.maxTokens;
    themeSelector.value = theme;
  };
  settingsToggle.addEventListener('click', openModal);
  if (settingsToggleMobile) {
    settingsToggleMobile.addEventListener('click', openModal);
  }
  settingsClose.addEventListener('click', () => settingsModal.classList.add('hide'));
  
  tempSlider.addEventListener('input', (e) => {
    tempVal.textContent = e.target.value;
  });

  saveSettingsBtn.addEventListener('click', () => {
    settings.systemPrompt = systemPromptInput.value.trim();
    settings.temperature = parseFloat(tempSlider.value);
    settings.maxTokens = parseInt(maxTokensInput.value, 10);
    
    localStorage.setItem('pwallm_sys_prompt', settings.systemPrompt);
    localStorage.setItem('pwallm_temperature', settings.temperature);
    localStorage.setItem('pwallm_max_tokens', settings.maxTokens);
    
    theme = themeSelector.value;
    localStorage.setItem('pwallm_theme', theme);
    applyTheme(theme);
    
    settingsModal.classList.add('hide');
  });

  clearAllDataBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL conversations and messages? This action cannot be undone.')) {
      try {
        const conversations = await getConversations();
        for (const convo of conversations) {
          await deleteConversation(convo.id);
        }
        await loadConversationsList();
        createNewConversation();
        settingsModal.classList.add('hide');
        alert('All conversation data has been cleared.');
      } catch (err) {
        console.error('Error clearing data:', err);
        alert('Error clearing data.');
      }
    }
  });

  // Theme Toggle click listeners (Header & Mobile)
  const cycleTheme = () => {
    let nextTheme = 'system';
    if (theme === 'system') nextTheme = 'light';
    else if (theme === 'light') nextTheme = 'dark';
    
    theme = nextTheme;
    localStorage.setItem('pwallm_theme', theme);
    applyTheme(theme);
    
    if (themeSelector) {
      themeSelector.value = theme;
    }
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
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show the install button
    if (installPwaBtn) {
      installPwaBtn.classList.remove('hide');
    }
  });

  if (installPwaBtn) {
    installPwaBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install: ${outcome}`);
      // Discard prompt
      deferredPrompt = null;
      // Hide install button
      installPwaBtn.classList.add('hide');
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('PWallm was installed successfully!');
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
    // System Theme
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
    
    // Set descriptive tooltip titles dynamically
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
  pingIcon.classList.add('fa-spin'); // fallback animation class
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
  } finally {
    pingIcon.style.animation = '';
    pingIcon.classList.remove('fa-spin');
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
    
    // Enable inputs once server is ready and model exists
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

      // Click to select
      item.addEventListener('click', (e) => {
        // Prevent click if clicking action button
        if (e.target.closest('.btn-convo-action') || e.target.closest('.convo-edit-input')) {
          return;
        }
        selectConversation(convo.id);
      });

      // Actions
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

    lucide.createIcons();
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
    welcomeSplash.classList.add('hide');
    messagesContainer.innerHTML = '';

    const messages = await getMessages(id);
    messages.forEach((msg) => {
      renderMessage(msg);
    });

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
  welcomeSplash.classList.remove('hide');
  messagesContainer.innerHTML = '';
  
  // Unhighlight active item
  document.querySelectorAll('.convo-item').forEach((item) => {
    item.classList.remove('active');
  });

  userInput.value = '';
  userInput.style.height = 'auto';
  userInput.focus();
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
        <span><i data-lucide="zap"></i> ${msg.stats.tokensPerSec.toFixed(1)} tok/s</span>
        <span><i data-lucide="clock"></i> ${msg.stats.generationTime.toFixed(1)}s</span>
        <span><i data-lucide="hash"></i> ${msg.stats.totalTokens} tokens</span>
      </div>
    `;
  }

  msgDiv.innerHTML = bubbleHtml + statsHtml;
  
  // Only recreate icons when not streaming to prevent huge lag
  if (!isStreaming) {
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

  // Clear welcome screen if it's the first message
  if (welcomeSplash.style.display !== 'none') {
    welcomeSplash.classList.add('hide');
  }

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
      buffer = lines.pop(); // Retain last incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            
            // Check usage
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

                // Live statistics calculation
                const elapsed = (performance.now() - firstTokenTime) / 1000;
                const liveTps = chunkCount / Math.max(elapsed, 0.001);
                
                statTps.textContent = liveTps.toFixed(1);
                statTime.textContent = elapsed.toFixed(1) + 's';
                statTokens.textContent = chunkCount;

                // Update UI stream content
                assistantMsg.content = accumContent;
                renderMessage(assistantMsg, assistantMsgDiv, true);
                scrollToBottom();
              }
            }
          } catch (e) {
            // Ignore parse errors from malformed JSON or partial chunks
          }
        }
      }
    }

    // Save generated message to database
    let totalGenerationTime = 0;
    if (firstTokenTime) {
      totalGenerationTime = (performance.now() - firstTokenTime) / 1000;
    } else {
      totalGenerationTime = (performance.now() - startTime) / 1000;
    }

    const totalTokensCount = tokenUsage ? tokenUsage.completion_tokens : chunkCount;
    const finalTps = totalTokensCount / Math.max(totalGenerationTime, 0.001);

    assistantMsg.stats = {
      tokensPerSec: finalTps,
      generationTime: totalGenerationTime,
      totalTokens: totalTokensCount
    };

    await saveMessage(assistantMsg);

    // Save/update conversation timestamp
    const convo = await getConversation(currentConvoId);
    if (convo) {
      convo.updatedAt = Date.now();
      await saveConversation(convo);
    }

    // Render final state with statistics (removes cursor, creates stats icons)
    renderMessage(assistantMsg, assistantMsgDiv, false);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Generation aborted by user.');
      // Save what was generated before abort
      if (accumContent.trim()) {
        assistantMsg.content = accumContent + ' *[Generation Stopped]*';
        
        let elapsed = 0;
        if (firstTokenTime) {
          elapsed = (performance.now() - firstTokenTime) / 1000;
        } else {
          elapsed = (performance.now() - startTime) / 1000;
        }
        
        assistantMsg.stats = {
          tokensPerSec: chunkCount / Math.max(elapsed, 0.001),
          generationTime: elapsed,
          totalTokens: chunkCount
        };
        await saveMessage(assistantMsg);
        renderMessage(assistantMsg, assistantMsgDiv);
      } else {
        assistantMsgDiv.remove();
      }
    } else {
      console.error('Streaming error:', err);
      thinkingIndicator.classList.add('hide');
      
      const errorDiv = document.createElement('div');
      errorDiv.className = 'message message-assistant';
      errorDiv.innerHTML = `<div class="message-bubble error-bubble" style="border-color: var(--color-danger); color: #fca5a5; background: rgba(239, 68, 68, 0.1);">
        <strong>Connection Error:</strong> Could not stream chat completion. Make sure your local llama.cpp server is running and configured correctly.
      </div>`;
      messagesContainer.appendChild(errorDiv);
    }
  } finally {
    isGenerating = false;
    abortController = null;
    sendBtn.disabled = false;
    userInput.disabled = false;
    stopBtn.classList.add('hide');
    liveStatsBar.classList.add('hide');
    scrollToBottom();
    userInput.focus();
    
    // Refresh conversation list to show correct order and title
    await loadConversationsList();
  }
}

function abortGeneration() {
  if (abortController) {
    abortController.abort();
  }
}

// -------------------------------------------------------------
// Markdown custom Parser
// -------------------------------------------------------------
function parseMarkdown(text) {
  if (!text) return '';

  // Escape HTML to prevent XSS
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  let result = [];
  let inCodeBlock = false;
  let codeContent = [];
  let codeLanguage = 'text';
  let inList = false; // 'ul', 'ol', or false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        const codeText = codeContent.join('\n');
        result.push(`
          <div class="code-header">
            <span>${codeLanguage}</span>
            <button class="btn-copy-code" onclick="copyCodeToClipboard(this)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <span>Copy</span>
            </button>
          </div>
          <pre><code class="language-${codeLanguage}">${codeText}</code></pre>
        `);
        inCodeBlock = false;
        codeContent = [];
      } else {
        // Start of code block
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim() || 'text';
        
        // Close lists if active
        if (inList) {
          result.push(`</${inList}>`);
          inList = false;
        }
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Process inline formatting (bold, italic, inline code) on line
    let formattedLine = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    // Handle Headings
    if (formattedLine.startsWith('### ')) {
      if (inList) { result.push(`</${inList}>`); inList = false; }
      result.push(`<h3>${formattedLine.slice(4)}</h3>`);
      continue;
    } else if (formattedLine.startsWith('## ')) {
      if (inList) { result.push(`</${inList}>`); inList = false; }
      result.push(`<h2>${formattedLine.slice(3)}</h2>`);
      continue;
    } else if (formattedLine.startsWith('# ')) {
      if (inList) { result.push(`</${inList}>`); inList = false; }
      result.push(`<h1>${formattedLine.slice(2)}</h1>`);
      continue;
    }

    // Handle Bullet Lists (unordered)
    const bulletMatch = formattedLine.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (inList === 'ol') {
        result.push('</ol>');
        inList = false;
      }
      if (!inList) {
        result.push('<ul>');
        inList = 'ul';
      }
      result.push(`<li>${bulletMatch[1]}</li>`);
      continue;
    }

    // Handle Numbered Lists (ordered)
    const numberMatch = formattedLine.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numberMatch) {
      if (inList === 'ul') {
        result.push('</ul>');
        inList = false;
      }
      if (!inList) {
        result.push('<ol>');
        inList = 'ol';
      }
      result.push(`<li>${numberMatch[2]}</li>`);
      continue;
    }

    // If it's an empty line, or a normal paragraph line
    if (formattedLine.trim() === '') {
      if (inList) {
        result.push(`</${inList}>`);
        inList = false;
      }
      // Add space but not empty paragraphs
      result.push('<br>');
    } else {
      if (inList) {
        result.push(`</${inList}>`);
        inList = false;
      }
      result.push(`<p>${formattedLine}</p>`);
    }
  }

  // Close trailing lists
  if (inList) {
    result.push(`</${inList}>`);
  }
  
  // Close trailing code blocks just in case
  if (inCodeBlock) {
    result.push(`</pre>`);
  }

  return result.join('\n').replace(/<br>\s*<br>/g, '<br>');
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// -------------------------------------------------------------
// Copy Code Utility Function
// -------------------------------------------------------------
function copyCodeToClipboard(btn) {
  const codeHeader = btn.closest('.code-header');
  const codeEl = codeHeader.nextElementSibling.querySelector('code');
  if (!codeEl) return;

  const textToCopy = codeEl.textContent;
  
  navigator.clipboard.writeText(textToCopy).then(() => {
    // Success feedback (uses inline SVGs to avoid reloading Lucide)
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; color: var(--color-success);"><path d="M20 6 9 17l-5-5"/></svg><span>Copied!</span>`;
    
    setTimeout(() => {
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy</span>`;
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy text:', err);
  });
}
