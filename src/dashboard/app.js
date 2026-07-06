// ============================================================
// AI Gateway — Dashboard Application
// ============================================================

// ============================================================
// State
// ============================================================
let appConfig = null;
let healthData = null;
let logs = [];
let refreshIntervals = [];
let editingProviderIndex = -1;
let currentPatterns = [];
let currentApiKeys = [];

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadHealth();
  await loadLogs();
  await loadStats();
  setupAutoRefresh();
  setupEventListeners();
});

// ============================================================
// API Calls
// ============================================================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
    renderProviders();
  } catch (err) {
    showToast('Failed to load configuration', 'error');
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    healthData = await res.json();
    renderProviders();
    updateStatsBar();
  } catch (err) {}
}

async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    logs = await res.json();
    renderLogTable();
  } catch (err) {}
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    updateStatsFromResponse(stats);
  } catch (err) {}
}

async function saveConfig(newConfig) {
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error?.message || 'Failed to save configuration', 'error');
      return false;
    }
    appConfig = newConfig;
    showToast('Configuration saved successfully', 'success');
    return true;
  } catch (err) {
    showToast('Failed to save configuration', 'error');
    return false;
  }
}

// ============================================================
// Rendering
// ============================================================
function renderProviders() {
  const grid = document.getElementById('providersGrid');
  const emptyState = document.getElementById('emptyProviders');
  if (!appConfig || !appConfig.providers || appConfig.providers.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';
  grid.innerHTML = '';
  appConfig.providers.forEach((provider, index) => {
    const card = document.createElement('div');
    card.className = `provider-card${provider.isActive ? '' : ' inactive'}`;
    const health = healthData?.providers?.[provider.id];
    const totalKeys = health?.totalKeyCount || provider.apiKeys?.length || (provider.apiKey ? 1 : 0);
    const healthyKeys = health?.healthyKeyCount || 0;
    const patterns = provider.modelPatterns || [];
    let keyDotsHtml = '';
    if (health?.keys) {
      health.keys.forEach(k => { keyDotsHtml += `<span class="key-dot ${k.health}" title="${k.health}: ${k.masked}"></span>`; });
    } else if (totalKeys > 0) {
      for (let i = 0; i < totalKeys; i++) keyDotsHtml += `<span class="key-dot unknown"></span>`;
    } else {
      keyDotsHtml = `<span class="key-dot unknown" title="No keys"></span>`;
    }
    let patternsHtml = '';
    patterns.forEach(p => { patternsHtml += `<span class="pattern-chip">${escapeHtml(p)}</span>`; });
    card.innerHTML = `
      <div class="provider-card-header">
        <div class="provider-name">
          <span class="provider-status-dot ${provider.isActive ? 'active' : 'inactive'}"></span>
          ${escapeHtml(provider.name)}
        </div>
        <label class="toggle-label" title="Toggle">
          <input type="checkbox" ${provider.isActive ? 'checked' : ''} onchange="toggleProvider(${index}, this.checked)">
          <span class="toggle-switch"></span>
        </label>
      </div>
      <div class="provider-card-body">
        <div class="provider-info-row">
          <span class="provider-info-label">Status</span>
          <span class="provider-info-value">${provider.isActive ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="provider-info-row">
          <span class="provider-info-label">Keys</span>
          <span class="provider-info-value">${healthyKeys}/${totalKeys} <span class="key-health-dots">${keyDotsHtml}</span></span>
        </div>
        <div class="provider-info-row">
          <span class="provider-info-label">Models</span>
          <span class="pattern-chips">${patternsHtml || '<span class="pattern-chip">*</span>'}</span>
        </div>
        <div class="provider-info-row">
          <span class="provider-info-label">Strategy</span>
          <span class="provider-info-value">${provider.keyStrategy || 'round-robin'}</span>
        </div>
      </div>
      <div class="provider-card-actions">
        <button class="btn btn-sm" onclick="openEditProviderModal(${index})">✏ Edit</button>
        <button class="btn btn-sm" onclick="deleteProvider(${index})">🗑 Delete</button>
      </div>`;
    grid.appendChild(card);
  });
}

function renderLogTable() {
  const tbody = document.getElementById('logBody');
  const emptyState = document.getElementById('emptyLogs');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';
  tbody.innerHTML = '';
  const sortedLogs = [...logs].reverse().slice(0, 50);
  sortedLogs.forEach(log => {
    const tr = document.createElement('tr');
    const statusClass = log.status >= 200 && log.status < 300 ? 'status-2xx' :
                        log.status >= 400 && log.status < 500 ? 'status-4xx' : 'status-5xx';
    tr.innerHTML = `<td>${formatTime(log.timestamp)}</td><td>${escapeHtml(log.model)}</td>
      <td>${escapeHtml(log.providerName || log.provider)}</td><td>${escapeHtml(log.keyMasked)}</td>
      <td class="${statusClass}">${log.status}</td><td>${formatDuration(log.duration)}</td>
      <td>${log.retries > 0 ? log.retries : '0'}</td>`;
    tbody.appendChild(tr);
  });
}

function updateStatsFromResponse(stats) {
  if (!stats) return;
  document.getElementById('statTotal').textContent = stats.totalRequests?.toLocaleString() || '0';
  document.getElementById('statToday').textContent = stats.todayRequests?.toLocaleString() || '0';
  document.getElementById('statErrors').textContent = stats.failedRequests || '0';
  document.getElementById('statAvgDuration').textContent = stats.averageDuration ? `${stats.averageDuration}ms` : '0ms';
}

function updateStatsBar() {
  if (healthData?.summary) {
    document.getElementById('statActiveProviders').textContent = healthData.summary.activeProviders || '0';
  }
}

// ============================================================
// Pattern Tag Management
// ============================================================
function renderPatternTags() {
  const container = document.getElementById('patternsTags');
  container.innerHTML = '';
  currentPatterns.forEach((pattern, i) => {
    const chip = document.createElement('span');
    chip.className = 'pattern-tag';
    chip.innerHTML = `${escapeHtml(pattern)} <span class="pattern-tag-remove" onclick="removePattern(${i})">×</span>`;
    container.appendChild(chip);
  });
}

function addPattern() {
  const input = document.getElementById('patternInput');
  const pattern = input.value.trim();
  if (!pattern) return;
  if (currentPatterns.includes(pattern)) { showToast(`Pattern already added`, 'warning'); return; }
  currentPatterns.push(pattern);
  renderPatternTags();
  input.value = '';
  input.focus();
}

function addQuickPattern(pattern) {
  if (currentPatterns.includes(pattern)) { showToast(`Pattern already added`, 'warning'); return; }
  currentPatterns.push(pattern);
  renderPatternTags();
}

function removePattern(index) {
  currentPatterns.splice(index, 1);
  renderPatternTags();
}

// ============================================================
// API Key Tag Management (same tag-based UI as patterns)
// ============================================================
function renderApiKeyTags() {
  const container = document.getElementById('apiKeysTags');
  container.innerHTML = '';
  currentApiKeys.forEach((key, i) => {
    const chip = document.createElement('span');
    // Check if key is already masked (contains ellipsis)
    const isMasked = key.includes('…');
    const display = isMasked ? key : maskKeyForDisplay(key);
    chip.className = 'pattern-tag key-tag';
    chip.title = isMasked ? 'Saved key (click to keep or replace)' : key;
    chip.innerHTML = `${escapeHtml(display)} <span class="pattern-tag-remove" onclick="removeApiKey(${i})">×</span>`;
    container.appendChild(chip);
  });
}

function addApiKey() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  if (!key) return;
  currentApiKeys.push(key);
  renderApiKeyTags();
  input.value = '';
  input.focus();
}

function removeApiKey(index) {
  currentApiKeys.splice(index, 1);
  renderApiKeyTags();
}

function maskKeyForDisplay(key) {
  if (!key || key.length < 8) return '***';
  // Show first 4 and last 4 characters
  return key.substring(0, 4) + '…' + key.substring(key.length - 4);
}

// ============================================================
// Provider CRUD
// ============================================================
function openAddProviderModal() {
  editingProviderIndex = -1;
  currentPatterns = [];
  currentApiKeys = [];
  document.getElementById('editProviderIndex').value = '-1';
  document.getElementById('modalTitle').textContent = 'Add Provider';
  document.getElementById('providerForm').reset();
  document.getElementById('providerId').disabled = false;
  renderPatternTags();
  renderApiKeyTags();
  clearFormErrors();
  document.getElementById('providerModal').classList.add('open');
  setTimeout(() => document.getElementById('providerId').focus(), 100);
}

function openEditProviderModal(index) {
  const provider = appConfig.providers[index];
  if (!provider) return;
  editingProviderIndex = index;
  currentPatterns = [...(provider.modelPatterns || [])];
  currentApiKeys = getProviderKeysFromList(provider);
  document.getElementById('editProviderIndex').value = String(index);
  document.getElementById('modalTitle').textContent = 'Edit Provider';
  document.getElementById('providerId').value = provider.id;
  document.getElementById('providerId').disabled = true;
  document.getElementById('providerName').value = provider.name || '';
  document.getElementById('providerBaseUrl').value = provider.baseUrl || '';
  document.getElementById('keyStrategy').value = provider.keyStrategy || 'round-robin';
  document.getElementById('providerActive').checked = provider.isActive !== false;
  renderPatternTags();
  renderApiKeyTags();
  clearFormErrors();
  document.getElementById('providerModal').classList.add('open');
}

function closeModal() {
  document.getElementById('providerModal').classList.remove('open');
}

async function saveProvider() {
  clearFormErrors();
  let valid = true;
  const id = document.getElementById('providerId').value.trim();
  const name = document.getElementById('providerName').value.trim();
  const baseUrl = document.getElementById('providerBaseUrl').value.trim();
  const strategy = document.getElementById('keyStrategy').value;
  const active = document.getElementById('providerActive').checked;
  
  // Filter out empty keys, but keep masked keys (they represent existing keys to preserve)
  const keys = currentApiKeys.filter(k => k.trim());

  if (!id) { showFieldError('providerIdError', 'Provider ID is required'); valid = false; }
  if (!name) { showFieldError('providerNameError', 'Display name is required'); valid = false; }
  if (!baseUrl) { showFieldError('providerBaseUrlError', 'Base URL is required'); valid = false; }
  else if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) { showFieldError('providerBaseUrlError', 'Must be a valid URL'); valid = false; }
  if (keys.length === 0) { showFieldError('apiKeysError', 'At least one API key is required'); valid = false; }
  if (currentPatterns.length === 0) { showFieldError('patternsError', 'At least one model pattern is required'); valid = false; }
  if (editingProviderIndex === -1 && appConfig?.providers?.some(p => p.id === id)) { showFieldError('providerIdError', 'ID must be unique'); valid = false; }
  if (!valid) return;

  // Send all keys (both real and masked) to backend
  // Backend will match masked keys to existing keys and preserve them
  // New real keys will be added
  const providerData = {
    id, name, baseUrl,
    apiKeys: keys,
    keyStrategy: strategy,
    modelPatterns: currentPatterns,
    isActive: active,
  };

  let newConfig;
  if (editingProviderIndex >= 0) {
    newConfig = { ...appConfig, providers: [...appConfig.providers] };
    newConfig.providers[editingProviderIndex] = { ...newConfig.providers[editingProviderIndex], ...providerData };
  } else {
    newConfig = { ...appConfig, providers: [...(appConfig?.providers || []), providerData] };
  }

  const saved = await saveConfig(newConfig);
  if (saved) { closeModal(); await loadConfig(); }
}

async function deleteProvider(index) {
  const provider = appConfig.providers[index];
  if (!provider) return;
  if (!confirm(`Delete provider "${provider.name}"?`)) return;
  const newConfig = { ...appConfig, providers: appConfig.providers.filter((_, i) => i !== index) };
  const saved = await saveConfig(newConfig);
  if (saved) { await loadConfig(); showToast(`Provider deleted`, 'info'); }
}

async function toggleProvider(index, active) {
  if (!appConfig?.providers?.[index]) return;
  const newConfig = { ...appConfig, providers: [...appConfig.providers] };
  newConfig.providers[index] = { ...newConfig.providers[index], isActive: active };
  const saved = await saveConfig(newConfig);
  if (saved) await loadConfig();
}

// ============================================================
// Helpers
// ============================================================
function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
}

function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (el) { el.textContent = message; el.classList.add('visible'); }
}

function getProviderKeysFromList(provider) {
  const keys = [];
  if (provider.apiKey) keys.push(provider.apiKey);
  if (provider.apiKeys) keys.push(...provider.apiKeys);
  return keys;
}

// Check if a key is a masked key (contains ellipsis) - means it's an existing key from backend
function isMaskedKey(key) {
  return typeof key === 'string' && key.includes('…');
}

// ============================================================
// Auto-Refresh
// ============================================================
function setupAutoRefresh() {
  refreshIntervals.push(setInterval(loadHealth, 5000));
  refreshIntervals.push(setInterval(loadLogs, 2000));
  refreshIntervals.push(setInterval(loadStats, 10000));
}

// ============================================================
// Event Listeners
// ============================================================
function setupEventListeners() {
  document.getElementById('addProviderBtn')?.addEventListener('click', openAddProviderModal);
  document.getElementById('emptyAddProviderBtn')?.addEventListener('click', openAddProviderModal);
  document.getElementById('modalCloseBtn')?.addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn')?.addEventListener('click', closeModal);
  document.getElementById('modalSaveBtn')?.addEventListener('click', saveProvider);
  document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogs);
  document.getElementById('providerModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

async function clearLogs() {
  try { await fetch('/api/logs', { method: 'DELETE' }); logs = []; renderLogTable(); showToast('Logs cleared', 'info'); }
  catch (err) { showToast('Failed to clear logs', 'error'); }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('toast-removing'); setTimeout(() => toast.remove(), 200); }, 3000);
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
}

// Expose to global scope for inline onclick handlers
window.openAddProviderModal = openAddProviderModal;
window.openEditProviderModal = openEditProviderModal;
window.closeModal = closeModal;
window.saveProvider = saveProvider;
window.deleteProvider = deleteProvider;
window.toggleProvider = toggleProvider;
window.clearLogs = clearLogs;
window.showToast = showToast;
window.addPattern = addPattern;
window.addQuickPattern = addQuickPattern;
window.removePattern = removePattern;
window.addApiKey = addApiKey;
window.removeApiKey = removeApiKey;