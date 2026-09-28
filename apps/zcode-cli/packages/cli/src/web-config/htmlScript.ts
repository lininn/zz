// 配置页行为脚本：原生前端 JS，无外部依赖，通过 fetch 调用同源 REST API。
// 注意：本字符串会被内嵌进 html.ts 的模板字面量，内容禁止使用反引号与 "${" 序列。
export const WEB_CONFIG_SCRIPT = `(function () {
  'use strict';
  var state = { providers: [], defaultModelSelection: null, activeIndex: -1, savedIds: {} };
  var fetchCandidates = [];

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.className = 'toast' + (isError ? ' error' : ''); }, 2600);
  }
  function activeProvider() { return state.activeIndex >= 0 ? state.providers[state.activeIndex] : null; }

  function load() {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
      state.providers = cfg.providers || [];
      state.defaultModelSelection = cfg.defaultModelSelection || null;
      state.savedIds = {};
      for (var i = 0; i < state.providers.length; i++) state.savedIds[state.providers[i].providerId] = true;
      state.activeIndex = state.providers.length > 0 ? 0 : -1;
      render();
    }).catch(function (e) { toast('加载失败: ' + (e && e.message ? e.message : e), true); });
  }

  function render() { renderSidebar(); renderPanel(); renderDefault(); }

  function renderSidebar() {
    var list = $('provider-list');
    var html = '';
    for (var i = 0; i < state.providers.length; i++) {
      var p = state.providers[i];
      html += '<div class="provider-item' + (i === state.activeIndex ? ' active' : '') + '" data-index="' + i + '">'
        + '<div class="provider-item-name">' + esc(p.providerName || p.providerId) + '</div>'
        + '<div class="provider-item-sub">' + esc(p.apiType) + ' · ' + p.models.length + ' 个模型</div>'
        + '</div>';
    }
    list.innerHTML = html;
    var items = list.querySelectorAll('.provider-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function () {
        state.activeIndex = Number(this.getAttribute('data-index'));
        render();
      });
    }
  }

  function renderPanel() {
    var panel = $('provider-panel');
    var p = activeProvider();
    if (!p) {
      panel.innerHTML = '<div class="empty">暂无 Provider，点击左侧「新增 Provider」开始配置</div>';
      return;
    }
    var idReadonly = state.savedIds[p.providerId] === true;
    var html = ''
      + '<fieldset><legend>基本配置</legend><div class="grid">'
      + '<div class="field"><label>Provider ID（保存后不可修改）</label>'
      + '<input type="text" data-provider-field="providerId" value="' + esc(p.providerId) + '"' + (idReadonly ? ' readonly' : '') + ' /></div>'
      + '<div class="field"><label>名称</label>'
      + '<input type="text" data-provider-field="providerName" value="' + esc(p.providerName) + '" /></div>'
      + '<div class="field"><label>API 类型</label>'
      + '<select data-provider-field="apiType">'
      + '<option value="openai-chat-completions"' + (p.apiType === 'openai-chat-completions' ? ' selected' : '') + '>OpenAI Chat Completions</option>'
      + '<option value="openai-responses"' + (p.apiType === 'openai-responses' ? ' selected' : '') + '>OpenAI Responses</option>'
      + '<option value="anthropic-messages"' + (p.apiType === 'anthropic-messages' ? ' selected' : '') + '>Anthropic Messages (Claude)</option>'
      + '</select></div>'
      + '<div class="field"><label>Base URL</label>'
      + '<input type="text" data-provider-field="baseUrl" placeholder="https://api.example.com/v1" value="' + esc(p.baseUrl) + '" /></div>'
      + '<div class="field"><label>API Key</label>'
      + '<input type="text" data-provider-field="apiKey" placeholder="sk-..." value="' + esc(p.apiKey) + '" /></div>'
      + '<div class="field"><label>启用</label>'
      + '<select data-provider-field="enabled">'
      + '<option value="true"' + (p.enabled ? ' selected' : '') + '>启用</option>'
      + '<option value="false"' + (!p.enabled ? ' selected' : '') + '>停用</option>'
      + '</select></div>'
      + '</div></fieldset>'
      + '<fieldset><legend>模型（勾选传图/视频/PDF 后对应能力生效）</legend>'
      + '<div class="toolbar">'
      + '<input type="text" id="new-model-id" placeholder="输入模型 ID 手动添加" />'
      + '<button class="btn secondary" id="add-model-btn">添加模型</button>'
      + '<button class="btn secondary" id="fetch-models-btn">从 API 获取模型列表</button>'
      + '</div>';
    if (p.models.length === 0) {
      html += '<div class="empty">暂无模型</div>';
    } else {
      html += '<div class="table-wrap"><table>'
        + '<thead><tr><th>模型 ID</th><th>启用</th><th>传图</th><th>视频</th><th>PDF</th><th>上下文窗口</th><th>最大输出</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < p.models.length; i++) {
        var m = p.models[i];
        html += '<tr>'
          + '<td><input type="text" data-model-index="' + i + '" data-model-field="modelId" value="' + esc(m.modelId) + '" /></td>'
          + '<td><input type="checkbox" data-model-index="' + i + '" data-model-field="enabled"' + (m.enabled ? ' checked' : '') + ' /></td>'
          + '<td><input type="checkbox" data-model-index="' + i + '" data-model-field="supportsImage"' + (m.supportsImage ? ' checked' : '') + ' /></td>'
          + '<td><input type="checkbox" data-model-index="' + i + '" data-model-field="supportsVideo"' + (m.supportsVideo ? ' checked' : '') + ' /></td>'
          + '<td><input type="checkbox" data-model-index="' + i + '" data-model-field="supportsPdf"' + (m.supportsPdf ? ' checked' : '') + ' /></td>'
          + '<td><input type="number" min="0" data-model-index="' + i + '" data-model-field="contextWindow" value="' + esc(m.contextWindow) + '" placeholder="默认" /></td>'
          + '<td><input type="number" min="0" data-model-index="' + i + '" data-model-field="maxOutputTokens" value="' + esc(m.maxOutputTokens) + '" placeholder="默认" /></td>'
          + '<td><button class="row-del" data-model-del="' + i + '" title="删除模型">×</button></td>'
          + '</tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</fieldset>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
      + '<button class="btn secondary" id="copy-provider-btn">复制此 Provider</button>'
      + '<button class="btn danger" id="delete-provider-btn">删除此 Provider</button>'
      + '</div>';
    panel.innerHTML = html;

    var providerInputs = panel.querySelectorAll('[data-provider-field]');
    for (var k = 0; k < providerInputs.length; k++) {
      providerInputs[k].addEventListener('change', function () {
        var field = this.getAttribute('data-provider-field');
        var value = this.value;
        if (field === 'enabled') p.enabled = value === 'true';
        else p[field] = value;
        if (field === 'providerId') { renderSidebar(); renderDefault(); }
        if (field === 'apiType' || field === 'enabled') renderSidebar();
      });
    }
    var modelInputs = panel.querySelectorAll('[data-model-field]');
    for (var x = 0; x < modelInputs.length; x++) {
      modelInputs[x].addEventListener('change', function () {
        var index = Number(this.getAttribute('data-model-index'));
        var field = this.getAttribute('data-model-field');
        var model = p.models[index];
        if (!model) return;
        if (this.type === 'checkbox') model[field] = this.checked;
        else if (this.type === 'number') {
          var n = parseInt(this.value, 10);
          model[field] = isNaN(n) || n < 0 ? 0 : n;
        } else model[field] = this.value;
      });
    }
    var delButtons = panel.querySelectorAll('[data-model-del]');
    for (var y = 0; y < delButtons.length; y++) {
      delButtons[y].addEventListener('click', function () {
        p.models.splice(Number(this.getAttribute('data-model-del')), 1);
        render();
      });
    }
    $('add-model-btn').addEventListener('click', function () {
      var input = $('new-model-id');
      var modelId = input.value.trim();
      if (!modelId) { toast('请输入模型 ID', true); return; }
      if (p.models.some(function (m) { return m.modelId === modelId; })) { toast('模型已存在: ' + modelId, true); return; }
      p.models.push({ modelId: modelId, enabled: true, supportsImage: false, supportsVideo: false, supportsPdf: false, contextWindow: 0, maxOutputTokens: 0 });
      render();
    });
    $('fetch-models-btn').addEventListener('click', function () { fetchModels(p); });
    $('copy-provider-btn').addEventListener('click', function () {
      var source = activeProvider();
      if (!source) return;
      var copy = copyProvider(source);
      state.providers.splice(state.activeIndex + 1, 0, copy);
      state.activeIndex = state.activeIndex + 1;
      render();
      toast('已复制为「' + copy.providerName + '」，可修改名称与模型后保存');
    });
    $('delete-provider-btn').addEventListener('click', function () {
      if (!confirm('确定删除 Provider「' + (p.providerName || p.providerId) + '」及其全部模型配置？')) return;
      state.providers.splice(state.activeIndex, 1);
      state.activeIndex = state.providers.length > 0 ? Math.min(state.activeIndex, state.providers.length - 1) : -1;
      render();
    });
  }

  function renderDefault() {
    var providerSelect = $('default-provider');
    var modelSelect = $('default-model');
    var html = '<option value="">（未设置）</option>';
    for (var i = 0; i < state.providers.length; i++) {
      var p = state.providers[i];
      html += '<option value="' + esc(p.providerId) + '"' + (state.defaultModelSelection && state.defaultModelSelection.providerId === p.providerId ? ' selected' : '') + '>' + esc(p.providerName || p.providerId) + '</option>';
    }
    providerSelect.innerHTML = html;
    renderDefaultModels();
    if (!providerSelect._bound) {
      providerSelect._bound = true;
      providerSelect.addEventListener('change', function () {
        if (!this.value) { state.defaultModelSelection = null; renderDefaultModels(); return; }
        var provider = findProvider(this.value);
        var first = provider && provider.models.length > 0 ? provider.models[0].modelId : '';
        state.defaultModelSelection = first ? { providerId: this.value, modelId: first } : null;
        renderDefaultModels();
      });
    }
    if (!modelSelect._bound) {
      modelSelect._bound = true;
      modelSelect.addEventListener('change', function () {
        var providerId = providerSelect.value;
        if (!this.value || !providerId) { state.defaultModelSelection = null; return; }
        state.defaultModelSelection = { providerId: providerId, modelId: this.value };
      });
    }
  }

  function renderDefaultModels() {
    var modelSelect = $('default-model');
    var selection = state.defaultModelSelection;
    var provider = selection ? findProvider(selection.providerId) : null;
    var html = '<option value="">（未设置）</option>';
    if (provider) {
      for (var i = 0; i < provider.models.length; i++) {
        var modelId = provider.models[i].modelId;
        html += '<option value="' + esc(modelId) + '"' + (selection && selection.modelId === modelId ? ' selected' : '') + '>' + esc(modelId) + '</option>';
      }
    }
    modelSelect.innerHTML = html;
  }

  function findProvider(providerId) {
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].providerId === providerId) return state.providers[i];
    }
    return null;
  }

  // 新增与复制共用同一套 providerId 分配规则，保证同一次编辑会话内不冲突。
  function allocateProviderId() {
    var n = 1;
    while (findProvider('custom-' + n)) n++;
    return 'custom-' + n;
  }

  function cloneModel(model) {
    return {
      modelId: model.modelId, enabled: model.enabled,
      supportsImage: model.supportsImage, supportsVideo: model.supportsVideo,
      supportsPdf: model.supportsPdf, contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens
    };
  }

  // 复制 Provider：基本配置与模型规则整体克隆（含 API Key），仅重置 ID 与名称。
  function copyProvider(source) {
    var models = [];
    for (var i = 0; i < source.models.length; i++) models.push(cloneModel(source.models[i]));
    return {
      providerId: allocateProviderId(),
      providerName: (source.providerName || source.providerId) + ' 副本',
      enabled: source.enabled,
      apiType: source.apiType,
      baseUrl: source.baseUrl,
      apiKey: source.apiKey,
      models: models
    };
  }

  function fetchModels(p) {
    if (!p.baseUrl.trim()) { toast('请先填写 Base URL', true); return; }
    var btn = $('fetch-models-btn');
    btn.disabled = true;
    btn.textContent = '获取中...';
    fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiType: p.apiType, baseUrl: p.baseUrl, apiKey: p.apiKey })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = '从 API 获取模型列表';
      if (!res.ok) { toast('获取失败: ' + (res.body && res.body.error ? res.body.error : '未知错误'), true); return; }
      fetchCandidates = (res.body && res.body.models) || [];
      if (fetchCandidates.length === 0) { toast('上游未返回任何模型', true); return; }
      renderFetchList(p);
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '从 API 获取模型列表';
      toast('获取失败: ' + (e && e.message ? e.message : e), true);
    });
  }

  function renderFetchList(p) {
    var existing = {};
    for (var i = 0; i < p.models.length; i++) existing[p.models[i].modelId] = true;
    var html = '';
    for (var j = 0; j < fetchCandidates.length; j++) {
      var id = fetchCandidates[j];
      html += '<label class="model-option"><input type="checkbox" value="' + esc(id) + '" checked' + (existing[id] ? ' disabled' : '') + ' />'
        + esc(id) + (existing[id] ? ' <span class="muted">（已存在）</span>' : '') + '</label>';
    }
    $('fetch-list').innerHTML = html;
    updateFetchSelection();
    $('fetch-modal').className = 'modal-mask show';
  }

  // 全选主开关状态：只统计可导入（非禁用）项；半选状态用 indeterminate 表达。
  function updateFetchSelection() {
    var master = $('fetch-toggle-all');
    var boxes = $('fetch-list').querySelectorAll('input[type="checkbox"]');
    var selectable = 0;
    var selected = 0;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].disabled) continue;
      selectable++;
      if (boxes[i].checked) selected++;
    }
    master.checked = selectable > 0 && selected === selectable;
    master.indeterminate = selected > 0 && selected < selectable;
    $('fetch-count').textContent = '共 ' + fetchCandidates.length + ' 个模型，可导入 ' + selectable + ' 个，已选 ' + selected + ' 个';
  }

  $('fetch-close').addEventListener('click', function () {
    $('fetch-modal').className = 'modal-mask';
  });
  // 全选主开关：只切换可导入项；列表内单个勾选通过事件冒泡统一回算主开关状态。
  $('fetch-toggle-all').addEventListener('change', function () {
    var boxes = $('fetch-list').querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].disabled) boxes[i].checked = this.checked;
    }
    updateFetchSelection();
  });
  $('fetch-list').addEventListener('change', function () { updateFetchSelection(); });
  $('fetch-import').addEventListener('click', function () {
    var p = activeProvider();
    if (!p) return;
    var boxes = $('fetch-list').querySelectorAll('input[type="checkbox"]');
    var imported = 0;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked && !boxes[i].disabled) {
        p.models.push({ modelId: boxes[i].value, enabled: true, supportsImage: false, supportsVideo: false, supportsPdf: false, contextWindow: 0, maxOutputTokens: 0 });
        imported++;
      }
    }
    $('fetch-modal').className = 'modal-mask';
    render();
    toast('已导入 ' + imported + ' 个模型');
  });

  $('add-provider-btn').addEventListener('click', function () {
    var id = allocateProviderId();
    var n = Number(id.slice('custom-'.length));
    state.providers.push({
      providerId: id, providerName: '新 Provider ' + n, enabled: true,
      apiType: 'openai-chat-completions', baseUrl: '', apiKey: '', models: []
    });
    state.activeIndex = state.providers.length - 1;
    render();
  });

  function save() {
    var btn = $('save-btn');
    btn.disabled = true;
    btn.textContent = '保存中...';
    var payload = {
      providers: state.providers,
      defaultModelSelection: state.defaultModelSelection
    };
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = '保存配置';
      if (!res.ok) {
        toast('保存失败: ' + (res.body && res.body.error ? res.body.error : '未知错误'), true);
        return;
      }
      toast('已保存');
      load();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '保存配置';
      toast('保存失败: ' + (e && e.message ? e.message : e), true);
    });
  }
  $('save-btn').addEventListener('click', save);

  load();
})();
`;
