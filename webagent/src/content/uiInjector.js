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
        ✅ 放行提交
      </button>
      <button id="hitl-refill" style="flex: 1; padding: 6px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">
        🔄 重新填写
      </button>
      <button id="hitl-cancel" style="flex: 1; padding: 6px; background: transparent; color: #f87171; border: 1px solid #f87171; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🛑 中止任务
      </button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('hitl-refill').addEventListener('click', () => {
    modal.remove();
    chrome.runtime.sendMessage({ type: "REFILL_AGENT" });
  });

  document.getElementById('hitl-confirm').addEventListener('click', () => {
    modal.remove();
    chrome.runtime.sendMessage({ type: "RESUME_AGENT" });
  });
}

function showFormReviewModal(message) {
  const oldModal = document.getElementById("agent-form-review-modal");
  if (oldModal) oldModal.remove();

  const overlay = document.createElement("div");
  overlay.id = "agent-form-review-modal";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15,23,42,0.28);
    display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    width: min(520px, calc(100vw - 32px)); background: #fff; border: 1px solid #d9d9d9; border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18); padding: 18px; color: #222;
  `;
  modal.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:18px;color:#111;">Web Agent 填表已暂停</h3>
    <p style="font-size:14px;line-height:1.55;margin:0 0 14px;">${escapeHtml(message)}</p>
    <p style="font-size:13px;line-height:1.5;margin:0 0 14px;color:#555;">如果你修改了表单，并希望以后记住这些修改，请在插件小窗口点击“更新知识库（当前表单）”。</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="agent-review-close" style="padding:8px 12px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;cursor:pointer;">我去检查</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("agent-review-close").addEventListener("click", () => overlay.remove());
}

function showKnowledgeUpdateModal(payload) {
  const oldModal = document.getElementById("agent-knowledge-update-modal");
  if (oldModal) oldModal.remove();

  const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
  const overlay = document.createElement("div");
  overlay.id = "agent-knowledge-update-modal";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15,23,42,0.28);
    display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    width: min(680px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px));
    overflow: auto; background: #fff; border: 1px solid #d9d9d9; border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18); padding: 18px; color: #222;
  `;

  const rows = proposals.length
    ? proposals.map((item, index) => `
      <label style="display:block;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin:8px 0;">
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <input type="checkbox" class="agent-knowledge-check" data-index="${index}" checked style="margin-top:3px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:14px;">${escapeHtml(item.label || item.key || "新字段")}</div>
            <div style="font-size:13px;color:#555;margin-top:4px;">原值：${escapeHtml(item.currentValue || "无")}</div>
            <label style="display:block;font-size:13px;color:#111;margin-top:6px;">
              确认保存的值
              <textarea class="agent-knowledge-value" data-index="${index}" rows="2" style="width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #d9d9d9;border-radius:4px;padding:6px;font-size:13px;">${escapeHtml(item.newValue || "")}</textarea>
            </label>
            <div style="font-size:12px;color:#666;margin-top:4px;">${escapeHtml(item.reason || "")}</div>
          </div>
        </div>
      </label>
    `).join("")
    : `<p style="font-size:14px;color:#555;">没有发现需要更新到知识库的差异。</p>`;

  modal.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:18px;">是否更新个人知识库</h3>
    <p style="font-size:14px;line-height:1.55;margin:0 0 12px;">Agent 对比了当前表单内容和已有知识库。请勾选你想保存的修改。</p>
    <div>${rows}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button id="agent-knowledge-close" style="padding:8px 12px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;cursor:pointer;">暂不更新</button>
      <button id="agent-knowledge-apply" style="padding:8px 12px;border:0;background:#1677ff;color:#fff;border-radius:4px;cursor:pointer;">保存勾选项</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("agent-knowledge-close").addEventListener("click", () => overlay.remove());
  document.getElementById("agent-knowledge-apply").addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".agent-knowledge-check:checked"))
      .map((checkbox) => {
        const index = Number(checkbox.dataset.index);
        const proposal = proposals[index];
        const input = document.querySelector(`.agent-knowledge-value[data-index="${index}"]`);
        if (!proposal) return null;
        return {
          ...proposal,
          newValue: input ? input.value.trim() : proposal.newValue
        };
      })
      .filter((item) => item && item.newValue);
    chrome.runtime.sendMessage({
      type: "APPLY_KNOWLEDGE_UPDATES",
      payload: { updates: selected }
    });
    overlay.remove();
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
