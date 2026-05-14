// 负责在真实网页上画出警告弹窗
function showHITLModal(warningMessage) {
  if (document.getElementById('agent-hitl-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'agent-hitl-modal';
  modal.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 2147483647; 
    background: #fff; border: 2px solid #ff4d4f; border-radius: 8px;
    padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 320px;
    font-family: sans-serif;
  `;
  modal.innerHTML = `
    <h3 style="margin-top:0; color: #ff4d4f; font-size: 16px;">⚠️ Agent 拦截提示</h3>
    <p style="font-size: 14px; color: #333;">${warningMessage}</p>
    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
      <button id="hitl-cancel" style="padding: 8px 16px; cursor: pointer;">手动接管</button>
      <button id="hitl-confirm" style="padding: 8px 16px; background: #ff4d4f; color: white; border: none; cursor: pointer;">放行</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('hitl-cancel').addEventListener('click', () => modal.remove());
  document.getElementById('hitl-confirm').addEventListener('click', () => modal.remove());
}