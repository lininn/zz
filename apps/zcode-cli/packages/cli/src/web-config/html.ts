import { WEB_CONFIG_SCRIPT } from "./htmlScript.js";

// 配置页文档结构与样式；行为脚本来自 htmlScript.ts。整份 HTML 由 server.ts 直接作为 / 响应返回，
// 不引入前端构建链，避免 CLI 打包（SEA 单文件）额外资产。
export const WEB_CONFIG_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ZCode Web 配置</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #151923;
    --card: #1a2030;
    --text: #f2f5f8;
    --muted: #9aa3b2;
    --accent: #69e3c2;
    --accent-2: #7aa7ff;
    --danger: #ff7a90;
    --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "PingFang SC","Source Han Sans SC","Noto Sans CJK SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #23304a 0%, transparent 60%),
                radial-gradient(800px 500px at 90% 0%, #1d3b3a 0%, transparent 55%),
                var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  .wrap { max-width: 1080px; margin: 32px auto 80px; padding: 0 20px; }
  .title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .title h1 { margin: 0; font-size: 26px; letter-spacing: 1px; }
  .title .sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
  .btn {
    border: 1px solid var(--border);
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #0b1015;
    border-radius: 10px;
    padding: 9px 22px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
  }
  .btn.secondary { background: var(--card); color: var(--text); }
  .btn.danger { background: transparent; color: var(--danger); border-color: rgba(255,122,144,0.4); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; }
  .sidebar {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-self: start;
  }
  .provider-item {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .provider-item:hover { background: rgba(255,255,255,0.04); }
  .provider-item.active { background: rgba(105,227,194,0.1); border-color: rgba(105,227,194,0.35); }
  .provider-item-name { font-weight: 600; font-size: 14px; }
  .provider-item-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .sidebar-hint { color: var(--muted); font-size: 11px; line-height: 1.6; padding: 8px 6px 2px; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .empty { color: var(--muted); text-align: center; padding: 48px 0; font-size: 14px; }
  fieldset { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin: 0; }
  legend { padding: 0 8px; font-size: 13px; font-weight: 700; color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .field input, .field select {
    width: 100%;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  .field input:focus, .field select:focus { outline: none; border-color: var(--accent-2); }
  .field input[readonly] { opacity: 0.65; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
  .toolbar input {
    flex: 1; min-width: 180px;
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); padding: 7px 10px; font-size: 13px;
  }
  .toolbar input:focus { outline: none; border-color: var(--accent-2); }
  .toolbar .btn { padding: 7px 14px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  tr:last-child td { border-bottom: none; }
  td input[type="text"] {
    width: 100%; background: transparent; border: 1px solid transparent; border-radius: 6px;
    color: var(--text); padding: 5px 6px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  td input[type="text"]:hover, td input[type="text"]:focus { border-color: var(--border); background: var(--card); outline: none; }
  td input[type="number"] {
    width: 90px; background: transparent; border: 1px solid transparent; border-radius: 6px;
    color: var(--text); padding: 5px 6px; font-size: 13px;
  }
  td input[type="number"]:focus { border-color: var(--border); background: var(--card); outline: none; }
  td input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); }
  .row-del { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 15px; padding: 4px 8px; border-radius: 6px; }
  .row-del:hover { color: var(--danger); background: rgba(255,122,144,0.1); }
  .table-wrap { overflow-x: auto; }
  .default-model {
    margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 16px;
    padding: 16px 20px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .default-model .field { flex: 1; min-width: 200px; }
  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px);
    background: var(--card); border: 1px solid var(--border); color: var(--text);
    border-radius: 10px; padding: 10px 20px; font-size: 13px; opacity: 0;
    transition: all 0.25s ease; pointer-events: none; z-index: 100; max-width: 80vw;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.error { border-color: rgba(255,122,144,0.5); color: var(--danger); }
  .modal-mask {
    position: fixed; inset: 0; background: rgba(5,8,12,0.7); display: none;
    align-items: center; justify-content: center; z-index: 90;
  }
  .modal-mask.show { display: flex; }
  .modal {
    background: var(--panel); border: 1px solid var(--border); border-radius: 16px;
    width: min(520px, 92vw); max-height: 76vh; display: flex; flex-direction: column;
  }
  .modal-head { padding: 16px 20px 10px; font-weight: 700; font-size: 15px; display: flex; justify-content: space-between; align-items: center; }
  .modal-body { padding: 6px 20px; overflow-y: auto; }
  .modal-foot { padding: 12px 20px 16px; display: flex; gap: 10px; justify-content: flex-end; }
  .model-option { display: flex; align-items: center; gap: 10px; padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .model-option:last-child { border-bottom: none; }
  .model-option input { accent-color: var(--accent); width: 15px; height: 15px; }
  .muted { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="title">
    <div>
      <h1>ZCode Web 配置</h1>
      <div class="sub">配置自定义 Claude / OpenAI 兼容模型；保存后 zz -p / TUI 将自动使用</div>
    </div>
    <button class="btn" id="save-btn">保存配置</button>
  </div>
  <div class="layout">
    <aside class="sidebar">
      <div id="provider-list"></div>
      <button class="btn secondary" id="add-provider-btn">+ 新增 Provider</button>
      <div class="sidebar-hint">仅管理自定义 Provider；模板型（Z.ai / BigModel 等）与账号型请在 TUI 中配置。</div>
    </aside>
    <main class="panel" id="provider-panel"></main>
  </div>
  <section class="default-model">
    <div class="field" style="flex:0 0 auto; align-self:center;">
      <label>默认模型</label>
    </div>
    <div class="field">
      <label>Provider</label>
      <select id="default-provider"><option value="">（未设置）</option></select>
    </div>
    <div class="field">
      <label>模型</label>
      <select id="default-model"><option value="">（未设置）</option></select>
    </div>
    <div class="muted" style="align-self:center;">未设置时保留当前已有选择</div>
  </section>
</div>
<div class="toast" id="toast"></div>
<div class="modal-mask" id="fetch-modal">
  <div class="modal">
    <div class="modal-head">选择要导入的模型 <button class="btn secondary" id="fetch-close" style="padding:4px 10px;font-size:12px;">关闭</button></div>
    <div class="modal-body" id="fetch-list"></div>
    <div class="modal-foot">
      <div class="muted" style="margin-right:auto;align-self:center;" id="fetch-count"></div>
      <button class="btn" id="fetch-import">导入选中</button>
    </div>
  </div>
</div>
<script>
${WEB_CONFIG_SCRIPT}
</script>
</body>
</html>
`;
