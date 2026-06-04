chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_ACTION") {
    executeAction(message.action);
    sendResponse({ ok: true });
  }

  if (message.type === "GET_TEXT_CONTENT") {
    let text = document.body.innerText || "";
    if (text.length > 8000) text = text.substring(0, 8000);
    sendResponse(text);
  }

  if (message.type === "GET_DOM_INFO") {
    sendResponse(extractInteractiveElements());
  }

  if (message.type === "DETECT_PAGE_BLOCKER") {
    sendResponse(detectPageBlocker());
  }

  if (message.type === "SCAN_FORM_FIELDS") {
    sendResponse(scanFormFields());
  }

  if (message.type === "FILL_FORM_FIELDS") {
    sendResponse(fillFormFields(message.payload || []));
  }

  if (message.type === "COLLECT_CURRENT_FORM_VALUES") {
    sendResponse(collectCurrentFormValues());
  }

  if (message.type === "SHOW_FORM_REVIEW_MODAL") {
    showFormReviewModal(message.message || "表单已填写，请检查后再提交。");
    sendResponse({ ok: true });
  }

  if (message.type === "SHOW_KNOWLEDGE_UPDATE_MODAL") {
    showKnowledgeUpdateModal(message.payload || {});
    sendResponse({ ok: true });
  }

  return true;
});

function executeAction(action) {
  const actionType = action.action || action.type;

  if (actionType === "click") {
    const element = findActionElement(action);
    if (element) {
      element.focus();
      element.click();
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    }
  } else if (actionType === "type") {
    const element = findActionElement(action) || getEditableActiveElement();
    if (element) {
      writeElementValue(element, action.text || "");
    }
  } else if (actionType === "press_enter") {
    if (document.activeElement) {
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      document.activeElement.dispatchEvent(enterEvent);
    }
  } else if (actionType === "scroll") {
    window.scrollBy({ top: window.innerHeight * 0.8, left: 0, behavior: "smooth" });
  } else if (actionType === "show_hitl") {
    showHITLModal(action.message);
  }
}

function extractInteractiveElements() {
  const elements = [];
  const query = document.querySelectorAll("input, textarea, button, a[href], select, [contenteditable='true'], [role='textbox'], [role='button']");

  query.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 &&
        rect.top >= 0 && rect.top <= window.innerHeight &&
        rect.left >= 0 && rect.left <= window.innerWidth) {
      elements.push({
        id: index,
        type: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        selector: buildStableSelector(el),
        text: getElementText(el),
        placeholder: el.getAttribute("placeholder") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2)
      });
    }
  });
  return elements;
}

function findActionElement(action) {
  if (action.selector) {
    const selected = document.querySelector(action.selector);
    if (selected) return normalizeClickableOrEditableTarget(selected, action);
  }

  if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
    const pointed = document.elementFromPoint(action.x, action.y);
    if (pointed) return normalizeClickableOrEditableTarget(pointed, action);
  }

  return null;
}

function normalizeClickableOrEditableTarget(element, action) {
  if ((action.action || action.type) === "type") {
    return element.closest("input, textarea, [contenteditable='true'], [role='textbox']") || element;
  }

  return element.closest("button, a[href], input, textarea, select, [role='button'], [role='textbox'], [contenteditable='true']") || element;
}

function getEditableActiveElement() {
  const active = document.activeElement;
  if (!active) return null;
  if (active.matches("input, textarea, [contenteditable='true'], [role='textbox']")) return active;
  return null;
}

function scanFormFields() {
  const fields = [];
  const controls = document.querySelectorAll(
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), textarea, select"
  );

  controls.forEach((el, index) => {
    if (!isVisible(el) || el.disabled || el.readOnly) return;

    const rect = el.getBoundingClientRect();
    fields.push({
      id: index,
      selector: buildStableSelector(el),
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || el.tagName).toLowerCase(),
      name: el.getAttribute("name") || "",
      idAttr: el.id || "",
      label: findLabelText(el),
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      value: getControlValue(el),
      required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
      options: getSelectOptions(el),
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2)
    });
  });

  return {
    url: location.href,
    title: document.title,
    isLoginPage: detectLoginPage(),
    fields
  };
}

function fillFormFields(assignments) {
  const results = [];

  assignments.forEach((item) => {
    if (!item || !item.selector || item.value === undefined || item.value === null) return;

    const element = document.querySelector(item.selector);
    if (!element) {
      results.push({ selector: item.selector, ok: false, reason: "element_not_found" });
      return;
    }

    const ok = writeElementValue(element, item.value);
    results.push({
      selector: item.selector,
      label: findLabelText(element),
      value: getControlValue(element),
      ok
    });
  });

  return { ok: true, results };
}

function writeElementValue(element, value) {
  element.focus();

  if (element.tagName === "SELECT") {
    const normalized = String(value).trim().toLowerCase();
    const option = Array.from(element.options).find((opt) => {
      return opt.value.trim().toLowerCase() === normalized ||
        opt.textContent.trim().toLowerCase() === normalized;
    });
    if (option) element.value = option.value;
  } else if (element.type === "checkbox") {
    element.checked = Boolean(value) && String(value).toLowerCase() !== "false";
  } else if (element.type === "radio") {
    const group = document.querySelectorAll(`input[type="radio"][name="${attrEscape(element.name)}"]`);
    const normalized = String(value).trim().toLowerCase();
    const matched = Array.from(group).find((radio) => {
      const label = findLabelText(radio).toLowerCase();
      return radio.value.toLowerCase() === normalized || label.includes(normalized);
    });
    if (matched) matched.checked = true;
    else element.checked = true;
  } else if (element.isContentEditable) {
    element.innerText = String(value);
  } else {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, String(value));
    else element.value = String(value);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.blur();
  return true;
}

function showFormReviewModal(message) {
  const oldModal = document.getElementById("agent-form-review-modal");
  if (oldModal) oldModal.remove();

  console.log("[Web Agent] 表单填写已暂停，等待用户检查。", message);
  const overlay = document.createElement("div");
  overlay.id = "agent-form-review-modal";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15,23,42,0.28);
    display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.id = "agent-form-review-modal";
  modal.style.cssText = `
    width: min(520px, calc(100vw - 32px)); background: #fff; border: 1px solid #d9d9d9; border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18); padding: 18px; font-family: Arial, sans-serif;
    color: #222;
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
  console.log("[Web Agent] 知识库更新建议：", proposals);

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

function collectCurrentFormValues() {
  const scan = scanFormFields();
  return {
    url: scan.url,
    title: scan.title,
    capturedAt: new Date().toISOString(),
    fields: scan.fields
      .map((field) => ({
        key: field.label || field.placeholder || field.name || field.idAttr,
        value: field.value
      }))
      .filter((item) => item.key && item.value)
  };
}

function detectLoginPage() {
  const hasPassword = Boolean(document.querySelector("input[type='password']"));
  const text = `${document.title} ${document.body.innerText || ""}`.toLowerCase();
  const hasLoginWords = ["login", "sign in", "登录", "登入", "手机号登录", "账号登录"].some((word) => text.includes(word));
  return hasPassword && hasLoginWords;
}

function detectPageBlocker() {
  const text = `${document.title} ${document.body.innerText || ""}`.toLowerCase();
  const blockerWords = [
    "登录", "登入", "注册", "手机号登录", "账号登录", "验证码", "短信验证",
    "人机验证", "安全验证", "滑块验证", "captcha", "verify", "verification",
    "login", "sign in", "sign up", "choose", "请选择", "确认选择"
  ];

  if (detectLoginPage()) {
    return {
      blocked: true,
      reason: "检测到当前页面需要登录，Agent 已暂停，请用户登录后继续。"
    };
  }

  const visibleDialogs = Array.from(document.querySelectorAll(
    "[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, .login, .captcha"
  )).filter(isVisible);

  const dialogText = visibleDialogs
    .map((node) => node.innerText || node.textContent || "")
    .join(" ")
    .toLowerCase();

  const hasBlockingDialog = visibleDialogs.length > 0 &&
    blockerWords.some((word) => dialogText.includes(word));
  if (hasBlockingDialog) {
    return {
      blocked: true,
      reason: "检测到登录、验证或需要用户选择的弹窗，Agent 已暂停，请用户处理后继续。"
    };
  }

  const hasCaptcha = blockerWords.some((word) => text.includes(word)) &&
    Boolean(document.querySelector("input[type='password'], input[name*='code'], input[placeholder*='验证码'], canvas, iframe"));
  if (hasCaptcha) {
    return {
      blocked: true,
      reason: "检测到验证码或安全验证，Agent 无法可靠自动处理，请用户手动完成。"
    };
  }

  return { blocked: false, reason: "" };
}

function findLabelText(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${attrEscape(el.id)}"]`);
    if (label && label.innerText.trim()) return label.innerText.trim();
  }

  const parentLabel = el.closest("label");
  if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const labelNode = document.getElementById(ariaLabelledBy);
    if (labelNode && labelNode.innerText.trim()) return labelNode.innerText.trim();
  }

  const geometryLabel = findNearbyTextByGeometry(el);
  if (geometryLabel) return geometryLabel;

  const nearby = [];
  let node = el.parentElement;
  for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
    const text = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE || child.tagName === "LABEL")
      .map((child) => child.textContent.trim())
      .filter(Boolean)
      .join(" ");
    if (text) nearby.push(text);
  }

  return nearby[0] || el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function findNearbyTextByGeometry(el) {
  const rect = el.getBoundingClientRect();
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length > 80) return NodeFilter.FILTER_REJECT;
      if (/^[*:\-\s]+$/.test(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "OPTION"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node = walker.nextNode();
  while (node) {
    const parentRect = node.parentElement.getBoundingClientRect();
    const verticalDistance = rect.top - parentRect.bottom;
    const horizontalOverlap = Math.min(rect.right, parentRect.right) - Math.max(rect.left, parentRect.left);
    const leftDistance = rect.left - parentRect.right;

    const above = verticalDistance >= -8 && verticalDistance <= 120 && parentRect.left <= rect.right;
    const left = Math.abs(parentRect.top - rect.top) <= 80 && leftDistance >= -8 && leftDistance <= 260;
    if (above || left || horizontalOverlap > 0) {
      candidates.push({
        text: node.textContent.trim().replace(/^\*\s*/, "").replace(/^\d+[.、]\s*/, ""),
        score: Math.abs(verticalDistance) + Math.abs(leftDistance)
      });
    }
    node = walker.nextNode();
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? candidates[0].text : "";
}

function getElementText(el) {
  return el.innerText.trim() ||
    el.placeholder ||
    el.value ||
    el.getAttribute("aria-label") ||
    findLabelText(el) ||
    "";
}

function getControlValue(el) {
  if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value || "true" : "";
  if (el.tagName === "SELECT") {
    const option = el.options[el.selectedIndex];
    return option ? option.textContent.trim() || option.value : "";
  }
  return el.value || "";
}

function getSelectOptions(el) {
  if (el.tagName !== "SELECT") return [];
  return Array.from(el.options).map((option) => ({
    value: option.value,
    text: option.textContent.trim()
  }));
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none";
}

function buildStableSelector(el) {
  if (el.id) return `#${cssEscape(el.id)}`;
  if (el.name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${attrEscape(el.name)}"]`;
  }

  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    const siblings = Array.from(node.parentElement ? node.parentElement.children : []);
    const sameTag = siblings.filter((item) => item.tagName === node.tagName);
    if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function attrEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showHITLModal(warningMessage) {
  if (document.getElementById("agent-hitl-modal")) return;
  console.log("[Web Agent] Agent 已暂停，等待用户处理。", warningMessage);

  const overlay = document.createElement("div");
  overlay.id = "agent-hitl-modal";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15,23,42,0.28);
    display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: #fff; border: 2px solid #ff4d4f; border-radius: 8px;
    padding: 20px; box-shadow: 0 8px 28px rgba(0,0,0,0.18); width: min(480px, calc(100vw - 32px));
    font-family: sans-serif;
  `;
  modal.innerHTML = `
    <h3 style="margin-top:0; color: #ff4d4f; font-size: 16px;">Agent 拦截提示</h3>
    <p style="font-size: 14px; color: #333;">${escapeHtml(warningMessage || "")}</p>
    <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
      <button id="hitl-cancel" style="padding: 8px 16px; cursor: pointer;">我知道了</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("hitl-cancel").addEventListener("click", () => overlay.remove());
}
