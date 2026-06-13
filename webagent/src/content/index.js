
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_ACTION") executeAction(message.action);
  if (message.type === "GET_TEXT_CONTENT") sendResponse(extractTextContent());
  if (message.type === "GET_DOM_INFO") sendResponse(extractInteractiveElements());
  if (message.type === "DETECT_PAGE_BLOCKER") sendResponse(detectPageBlocker());
  if (message.type === "SCAN_FORM_FIELDS") sendResponse(scanFormFields());
  if (message.type === "FILL_FORM_FIELDS") sendResponse(fillFormFields(message.payload || []));
  if (message.type === "COLLECT_CURRENT_FORM_VALUES") sendResponse(collectCurrentFormValues());
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
