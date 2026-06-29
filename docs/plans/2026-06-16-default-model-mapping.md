# Default Model + Manual Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Default Model" card that handles all unknown Antigravity model requests, plus manual model mapping. Verify all session features work.

**Architecture:** Add `_default_provider` and `_default_model` to models.json. Router falls back to this when no per-model config exists. Dashboard gets a "Default Model" card and "Add Model Mapping" button. All existing per-model overrides still work.

**Tech Stack:** TypeScript, vanilla JS dashboard, node:test

---

### Task 1: Backend — Add default provider/model to ModelResolver

**Files:**
- Modify: `proxy/src/models.ts:19-59`

- [ ] **Step 1: Add defaultProvider/defaultModel properties and load them**

In `proxy/src/models.ts`, add two new properties to the `ModelResolver` class (after `fallbackModel` on line 25):

```typescript
  defaultProvider: ProviderId | '' = '';
  defaultModel: string = '';
```

In the `load()` method, after the `fallbackModel` block (line 53), add:

```typescript
        if (typeof file._default_provider === 'string') {
          this.defaultProvider = file._default_provider as ProviderId;
        }
        if (typeof file._default_model === 'string') {
          this.defaultModel = file._default_model;
        }
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck` from `proxy/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add proxy/src/models.ts
git commit -m "feat(models): add defaultProvider and defaultModel properties"
```

---

### Task 2: Backend — Router uses default provider for unknown models

**Files:**
- Modify: `proxy/src/router.ts:62-72`

- [ ] **Step 1: Update per-model routing to use default provider as fallback**

Replace the per-model-per-provider block (lines 62-67) with:

```typescript
    if (routingMode === 'per-model-per-provider') {
      const modelProviders = this.modelResolver.getProvidersForModel(model);
      if (modelProviders && modelProviders.length > 0) {
        candidates = [modelProviders[0] as ProviderId];
      } else if (this.modelResolver.defaultProvider) {
        candidates = [this.modelResolver.defaultProvider];
      } else {
        candidates = providerIds;
      }
    } else {
      candidates = providerIds;
    }
```

- [ ] **Step 2: Update resolve() call to use defaultModel when no mapping found**

In `router.ts`, find the line `const resolvedModel = this.modelResolver.resolve(model, providerId);` (around line 99). Change it to:

```typescript
      let resolvedModel = this.modelResolver.resolve(model, providerId);
      if (!resolvedModel || resolvedModel === model) {
        if (this.modelResolver.defaultModel) {
          resolvedModel = this.modelResolver.defaultModel;
        }
      }
```

Also find the second `resolve()` call in the fallback section (around line 170) and apply the same change:

```typescript
        let resolvedModel = this.modelResolver.resolve(model, providerId);
        if (!resolvedModel || resolvedModel === model) {
          if (this.modelResolver.defaultModel) {
            resolvedModel = this.modelResolver.defaultModel;
          }
        }
```

- [ ] **Step 3: Run typecheck and tests**

Run from `proxy/`:
```bash
npm run typecheck
npm test
```
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add proxy/src/router.ts
git commit -m "feat(router): fall back to default provider/model for unknown models"
```

---

### Task 3: Backend — Add models.json defaults

**Files:**
- Modify: `proxy/models.json`

- [ ] **Step 1: Add default_provider and default_model fields**

Add these fields to `proxy/models.json` (after `_fallback_model`):

```json
  "_default_provider": "",
  "_default_model": "",
```

- [ ] **Step 2: Commit**

```bash
git add proxy/models.json
git commit -m "feat: add default_provider and default_model fields to models.json"
```

---

### Task 4: Frontend — Default Model card in utility models section

**Files:**
- Modify: `proxy/dashboard/index.html:1019-1043` (HTML section)
- Modify: `proxy/dashboard/index.html:2468-2487` (renderUtilityModels + onUtilityModelChange)
- Modify: `proxy/dashboard/index.html:2489-2499` (saveModelConfig)

- [ ] **Step 1: Add Default Model card HTML**

In `proxy/dashboard/index.html`, find the Utility Models section (line 1019). Replace the entire utility models div with:

```html
      <!-- Utility Models: Default + Title + Fallback -->
      <div style="margin-top:24px">
        <p style="font-size:12px;color:var(--text3);margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Utility Models</p>
        <div class="utility-models-grid">
          <div class="utility-card" style="border-color:var(--accent);border-width:1px">
            <div class="utility-card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--accent2)"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <h3>Default Model <span class="utility-desc">— handles ALL unknown model requests from Antigravity</span></h3>
            </div>
            <div class="utility-card-body">
              <p style="font-size:11px;color:var(--text3);margin-bottom:12px">When Antigravity sends a model not in your per-model config (e.g. gemini-2.5-flash, gemini-pro-agent), this provider + model is used. Essential for routing ALL requests through one model.</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="model-card-field">
                  <label>Provider</label>
                  <div id="defaultProviderSelect"></div>
                </div>
                <div class="model-card-field">
                  <label>Model</label>
                  <input id="defaultModelInput" type="text" placeholder="e.g. minimaxai/minimax-m3" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px;font-family:var(--mono);outline:none">
                </div>
              </div>
            </div>
          </div>
          <div class="utility-card">
            <div class="utility-card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--yellow)"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <h3>Title Generation <span class="utility-desc">— model for generating conversation titles</span></h3>
            </div>
            <div class="utility-card-body">
              <div class="model-card-field">
                <label>Model</label>
                <select id="titleModelSelect" onchange="onUtilityModelChange()"></select>
              </div>
            </div>
          </div>
          <div class="utility-card">
            <div class="utility-card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--blue)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <h3>Fallback Model <span class="utility-desc">— used when primary model fails</span></h3>
            </div>
            <div class="utility-card-body">
              <div class="model-card-field">
                <label>Model</label>
                <select id="fallbackModelSelect" onchange="onUtilityModelChange()"></select>
              </div>
            </div>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Update renderUtilityModels to handle default provider/model**

Replace the `renderUtilityModels` function with:

```javascript
function renderUtilityModels() {
  const titleSelect = document.getElementById('titleModelSelect');
  const fallbackSelect = document.getElementById('fallbackModelSelect');
  const defaultModelInput = document.getElementById('defaultModelInput');
  if (!titleSelect || !fallbackSelect) return;

  const mainAliases = MODEL_GROUPS.flatMap(g => [g.alias, ...g.variants]);
  const extraAliases = Object.keys(_modelConfig || {}).filter(k => !k.startsWith('_') && !mainAliases.includes(k));
  const allAliases = [...new Set([...mainAliases, ...extraAliases])];
  const optionsHtml = '<option value="">None (disabled)</option>' + allAliases.map(a => `<option value="${a}">${a}</option>`).join('');

  titleSelect.innerHTML = optionsHtml;
  fallbackSelect.innerHTML = optionsHtml;
  titleSelect.value = _modelConfig?._title_model || '';
  fallbackSelect.value = _modelConfig?._fallback_model || '';
  if (defaultModelInput) defaultModelInput.value = _modelConfig?._default_model || '';

  // Render default provider selector
  const defaultProvContainer = document.getElementById('defaultProviderSelect');
  if (defaultProvContainer) {
    defaultProvContainer.innerHTML = '';
    const currentDefault = _modelConfig?._default_provider || '';
    const psel = createProviderSelect(currentDefault, function(val) {
      _modelConfig._default_provider = val;
    });
    defaultProvContainer.appendChild(psel);
  }
}
```

- [ ] **Step 3: Update onUtilityModelChange to include default_model**

```javascript
function onUtilityModelChange() {
  _modelConfig._title_model = document.getElementById('titleModelSelect')?.value || '';
  _modelConfig._fallback_model = document.getElementById('fallbackModelSelect')?.value || '';
  _modelConfig._default_model = document.getElementById('defaultModelInput')?.value || '';
}
```

- [ ] **Step 4: Update saveModelConfig to include default_provider and default_model**

```javascript
async function saveModelConfig() {
  if (!_modelConfig) { toast('No config loaded', true); return; }
  _modelConfig._routing_mode = _routingMode;
  _modelConfig._title_model = document.getElementById('titleModelSelect')?.value || '';
  _modelConfig._fallback_model = document.getElementById('fallbackModelSelect')?.value || '';
  _modelConfig._default_model = document.getElementById('defaultModelInput')?.value || '';
  _modelConfig._default_provider = (() => {
    const wrap = document.getElementById('defaultProviderSelect')?.querySelector('.psel-wrap');
    return wrap?.querySelector('select')?.value || '';
  })();
  try {
    const r = await api('POST', '/api/models', _modelConfig);
    if (r.ok) { toast('Model config saved'); loadModelConfig(); }
    else toast('Save failed: ' + (r.error || 'unknown'), true);
  } catch (e) { toast('Save failed: ' + e.message, true); }
}
```

- [ ] **Step 5: Run typecheck and test in browser**

Run: `npm run typecheck` from `proxy/`
Expected: PASS

Open dashboard → Models tab → verify Default Model card appears with provider selector and model input.

- [ ] **Step 6: Commit**

```bash
git add proxy/dashboard/index.html
git commit -m "feat(dashboard): add Default Model card for unknown model routing"
```

---

### Task 5: Frontend — Manual model mapping

**Files:**
- Modify: `proxy/dashboard/index.html` (Models section HTML + JS)

- [ ] **Step 1: Add "Add Model Mapping" button to Models tab**

After the model cards grid (line 1017), add:

```html
      <!-- Add Custom Model Mapping -->
      <div style="margin-top:16px;padding:12px 16px;background:var(--surface);border:1px dashed var(--border2);border-radius:10px">
        <p style="font-size:12px;color:var(--text3);margin-bottom:10px;font-weight:600">Add Custom Model Mapping</p>
        <p style="font-size:11px;color:var(--text3);margin-bottom:10px">Map any model name Antigravity sends to a specific provider + model. Useful for models not in the default cards.</p>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="model-card-field" style="margin-bottom:0;flex:1;min-width:150px">
            <label>Model Name (as sent by Antigravity)</label>
            <input id="customModelAlias" type="text" placeholder="e.g. gemini-2.5-flash" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px;font-family:var(--mono);outline:none">
          </div>
          <div class="model-card-field" style="margin-bottom:0;min-width:120px">
            <label>Provider</label>
            <div id="customModelProvider"></div>
          </div>
          <div class="model-card-field" style="margin-bottom:0;flex:1;min-width:150px">
            <label>Resolved Model</label>
            <input id="customModelResolved" type="text" placeholder="e.g. deepseek-v4-flash-free" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px;font-family:var(--mono);outline:none">
          </div>
          <button class="btn btn-sm btn-primary" onclick="addCustomModelMapping()" style="margin-bottom:0">+ Add</button>
        </div>
        <div id="customModelMappingsList" style="margin-top:10px"></div>
      </div>
```

- [ ] **Step 2: Add JS for custom model mapping**

After the `addModelRow` function (line 2514), add:

```javascript
function initCustomModelMapping() {
  const container = document.getElementById('customModelProvider');
  if (!container) return;
  container.innerHTML = '';
  const psel = createProviderSelect('openrouter', function(val) {});
  container.appendChild(psel);
}

function addCustomModelMapping() {
  const alias = document.getElementById('customModelAlias')?.value.trim();
  const resolved = document.getElementById('customModelResolved')?.value.trim();
  const providerWrap = document.getElementById('customModelProvider')?.querySelector('.psel-wrap');
  const provider = providerWrap?.querySelector('select')?.value || 'openrouter';
  if (!alias) { toast('Model name is required', true); return; }
  if (!resolved) { toast('Resolved model is required', true); return; }
  const pm = _modelConfig._provider_models || {};
  if (!pm[alias]) pm[alias] = {};
  pm[alias][provider] = resolved;
  _modelConfig._provider_models = pm;
  document.getElementById('customModelAlias').value = '';
  document.getElementById('customModelResolved').value = '';
  renderCustomModelMappings();
  renderModelCards();
  toast(`Mapped "${alias}" → ${provider}/${resolved}`);
}

function removeCustomModelMapping(alias) {
  const pm = _modelConfig._provider_models || {};
  delete pm[alias];
  _modelConfig._provider_models = pm;
  renderCustomModelMappings();
  renderModelCards();
}

function renderCustomModelMappings() {
  const container = document.getElementById('customModelMappingsList');
  if (!container) return;
  const pm = _modelConfig?._provider_models || {};
  const customModels = Object.keys(pm).filter(k => !MODEL_GROUPS.some(g => g.alias === k || g.variants.includes(k)));
  if (customModels.length === 0) { container.innerHTML = '<p style="font-size:11px;color:var(--text3)">No custom mappings yet.</p>'; return; }
  container.innerHTML = customModels.map(alias => {
    const providers = pm[alias];
    const entries = Object.entries(providers);
    return entries.map(([prov, model]) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:6px;margin-bottom:4px">
        <span style="font-size:12px;font-family:var(--mono);color:var(--text);flex:1">${esc(alias)}</span>
        <span style="font-size:11px;color:var(--text3)">→</span>
        <span style="font-size:11px;color:var(--accent2);font-family:var(--mono)">${esc(prov)}</span>
        <span style="font-size:11px;color:var(--text3)">/</span>
        <span style="font-size:11px;color:var(--text2);font-family:var(--mono);flex:1">${esc(model)}</span>
        <button class="btn btn-sm btn-danger" onclick="removeCustomModelMapping('${esc(alias)}')" style="padding:2px 8px;font-size:11px">✕</button>
      </div>
    `).join('');
  }).join('');
}
```

- [ ] **Step 3: Update loadModelConfig to init custom mapping UI**

In the `loadModelConfig` function, after `renderUtilityModels()` call, add:

```javascript
  try { initCustomModelMapping(); renderCustomModelMappings(); } catch (e) {}
```

- [ ] **Step 4: Run typecheck and test in browser**

Run: `npm run typecheck` from `proxy/`
Expected: PASS

Open dashboard → Models tab → verify "Add Custom Model Mapping" section appears. Test adding a mapping.

- [ ] **Step 5: Commit**

```bash
git add proxy/dashboard/index.html
git commit -m "feat(dashboard): add manual model mapping UI"
```

---

### Task 6: Verify all session features work

- [ ] **Step 1: Run full test suite**

Run from `proxy/`:
```bash
npm run typecheck
npm test
```
Expected: All PASS

- [ ] **Step 2: Manual verification checklist**

Start proxy: `npm run dev`
Open dashboard: `http://localhost:4000`

1. **Models tab loads** → Cards render for all 5 model groups ✓
2. **Routing mode toggle** → Switch between Priority Chain and Per-Model ✓
3. **Provider selector** → Click provider dropdown, select a provider ✓
4. **Model selector** → Click model name to select from cached list ✓
5. **Variant providers** → Select provider for variant (e.g., gemini-3.5-flash-medium) ✓
6. **Default Model card** → Set provider + model, save, verify in models.json ✓
7. **Title Generation** → Select model from dropdown ✓
8. **Fallback Model** → Select model from dropdown ✓
9. **Custom Model Mapping** → Add a custom model, verify it appears in list ✓
10. **Save** → Click Save, verify models.json updates ✓
11. **Go to Config button** → Click, navigates to Config tab ✓
12. **Priority chain** → Visible in Config tab ✓
13. **Dashboard loads** → All tabs work ✓
14. **Provider priority save** → Save in Config tab, persists after reload ✓
15. **Browse Models** → Provider defaults to OpenRouter, Fetch works ✓
16. **Variant fallback** → Selecting primary model config applies to variants ✓

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: verify all session features work correctly"
```
