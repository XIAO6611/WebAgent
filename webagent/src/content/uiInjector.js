// 负责在真实网页上画出警告弹窗 (极简不遮挡版)
function showHITLModal(warningMessage) {
  if (document.getElementById('agent-hitl-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'agent-hitl-modal';
  
  // 🎨 UI 优化：放置在屏幕右下角，极简黑客风，半透明，绝不遮挡中央内容
  modal.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; 
    background: rgba(30, 41, 59, 0.9); border-left: 4px solid #ef4444; border-radius: 8px;
    padding: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); width: 260px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: white; backdrop-filter: blur(8px);
  `;
  
  modal.innerHTML = `
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
      <span>🚨</span> Agent 等待接管
    </div>
    <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 15px; line-height: 1.4;">
      ${warningMessage}
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="hitl-confirm" style="flex: 1; padding: 6px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">
        ✅ 放行
      </button>
      <button id="hitl-cancel" style="flex: 1; padding: 6px; background: transparent; color: #f87171; border: 1px solid #f87171; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🛑 终止
      </button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('hitl-cancel').addEventListener('click', () => {
    modal.remove();
    chrome.runtime.sendMessage({ type: "ABORT_AGENT" });
  });

  document.getElementById('hitl-confirm').addEventListener('click', () => {
    modal.remove();
    chrome.runtime.sendMessage({ type: "RESUME_AGENT" });
  });
}