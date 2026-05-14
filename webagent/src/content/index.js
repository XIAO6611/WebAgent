
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_ACTION") executeAction(message.action);
  if (message.type === "GET_TEXT_CONTENT") sendResponse(extractTextContent());
  if (message.type === "GET_DOM_INFO") sendResponse(extractInteractiveElements());
  return true; 
});