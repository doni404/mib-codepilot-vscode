const vscode = require('vscode');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const { OpenAIService, GeminiService, DeepSeekService } = require('./llmService'); // Import new LLM services

const CONVERSATIONS_KEY = 'mibCodePilot.conversations';
const ACTIVE_CONV_ID_KEY = 'mibCodePilot.activeConversationId';

function activate(context) {
    console.log('Congratulations, your extension "mib-codepilot-vscode" is now active!');

    // Register the Webview View Provider
    // Pass the extension context to the provider for globalState access
    const provider = new MibCodePilotViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MibCodePilotViewProvider.viewType, provider)
    );

    // Register commands for chat management
    context.subscriptions.push(
        vscode.commands.registerCommand('mib-codepilot-vscode.newChat', () => {
            // We'll call a method on the provider instance
            provider.createNewConversation();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mib-codepilot-vscode.viewChatHistory', async () => {
            // This might be an async operation if it involves UI like QuickPick
            await provider.selectConversationFromHistory();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mib-codepilot-vscode.sendSelectedTextToChat', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.selection && !editor.selection.isEmpty) {
                const selectedText = editor.document.getText(editor.selection);
                provider.sendTextToWebviewInput(selectedText);
            } else {
                vscode.window.showInformationMessage('No text selected in the active editor.');
            }
        })
    );

    // Keep the helloWorld command for now, or remove if not needed
    let helloWorldDisposable = vscode.commands.registerCommand('mib-codepilot-vscode.helloWorld', function () {
        vscode.window.showInformationMessage('Hello World from MIB CodePilot!');
    });
    context.subscriptions.push(helloWorldDisposable);
}

// Define a more specific interface for our QuickPick items
/**
 * @typedef {vscode.QuickPickItem & { id: string }} ConversationQuickPickItem
 */


class MibCodePilotViewProvider {
    static viewType = 'mibCodePilotChatView'; // Must match the id in package.json

    _view;
    _extensionUri;
    _context; // ExtensionContext for globalState
    _configListenerDisposable; // To store the disposable for the config listener

    _conversations = [];
    _activeConversationId = null;
    _openaiApiKey = ''; // Initialize
    _geminiApiKey = ''; // Initialize
    _deepseekApiKey = ''; // Initialize for DeepSeek
    _openaiService;
    _geminiService;
    _deepseekService; // Initialize for DeepSeek

    constructor(extensionUri, extensionContext) {
        this._extensionUri = extensionUri;
        this._context = extensionContext;

        // Load API keys initially
        this._openaiApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.openai').get('apiKey');
        this._geminiApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.gemini').get('apiKey');
        this._deepseekApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.deepseek').get('apiKey');
        this._initializeServices();

        // Listen for configuration changes to update API keys
        this._configListenerDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mib-codepilot-vscode.openai.apiKey')) {
                this._openaiApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.openai').get('apiKey');
                this._initializeServices(); // Re-initialize service with new key
            }
            if (e.affectsConfiguration('mib-codepilot-vscode.gemini.apiKey')) {
                this._geminiApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.gemini').get('apiKey');
                this._initializeServices(); // Re-initialize service with new key
            }
            if (e.affectsConfiguration('mib-codepilot-vscode.deepseek.apiKey')) {
                this._deepseekApiKey = vscode.workspace.getConfiguration('mib-codepilot-vscode.deepseek').get('apiKey');
                this._initializeServices(); // Re-initialize service with new key
            }
        });

        this._loadState(); // Call _loadState to initialize or retrieve conversation data
    }

    _loadState() {
        this._conversations = this._context.globalState.get(CONVERSATIONS_KEY, []);
        // Ensure messages are an array, correcting potential old state issues
        this._conversations.forEach(conv => {
            if (!Array.isArray(conv.messages)) {
                console.warn(`Conversation ${conv.id} had invalid messages format, resetting.`);
                conv.messages = [];
            }
        });

        this._activeConversationId = this._context.globalState.get(ACTIVE_CONV_ID_KEY);

        if (!this._activeConversationId && this._conversations.length > 0) {
            // If no active ID but conversations exist, pick the most recent one (by lastActivity or createdAt)
            // For now, let's just pick the first one if we implement sorting later.
            // Or, more simply, if we always unshift new conversations, the first is the newest.
            this._conversations.sort((a, b) => (b.lastActivity || b.createdAt || 0) - (a.lastActivity || a.createdAt || 0));
            if (this._conversations.length > 0) { // Check again after sort, though it should be the same
                this._activeConversationId = this._conversations[0].id;
            }
        }

        // If still no active conversation (e.g., no conversations existed, or activeId was invalid)
        // or if the active ID doesn't point to a valid conversation
        if (!this._activeConversationId || !this._conversations.find(c => c.id === this._activeConversationId)) {
            this._createNewConversationInternal(); // Create a new one
        }
        this._saveState(); // Ensure state is consistent after loading/initialization
    }

    _initializeServices() {
        if (this._openaiApiKey) {
            this._openaiService = new OpenAIService(this._openaiApiKey);
        } else {
            this._openaiService = null; // Or handle as an error state
        }
        if (this._geminiApiKey) {
            this._geminiService = new GeminiService(this._geminiApiKey);
        } else {
            this._geminiService = null;
        }
        if (this._deepseekApiKey) {
            this._deepseekService = new DeepSeekService(this._deepseekApiKey);
        } else {
            this._deepseekService = null;
        }
    }
    _saveState() {
        this._context.globalState.update(CONVERSATIONS_KEY, this._conversations);
        this._context.globalState.update(ACTIVE_CONV_ID_KEY, this._activeConversationId);
    }

    _createNewConversationInternal(setActive = true) {
        const newConversationId = uuidv4();
        const now = Date.now();
        const newConversation = {
            id: newConversationId,
            title: `Chat ${new Date(now).toLocaleString()}`, // Default title
            messages: [], // Start with an empty messages array
            createdAt: now,
            lastActivity: now,
            lastModelUsed: null // Initialize new property
        };
        this._conversations.unshift(newConversation); // Add to the beginning for easy access to newest
        if (setActive) {
            this._activeConversationId = newConversationId;
        }
        // Note: _saveState() is typically called by the public method that uses this, or by _loadState.
        return newConversation;
    }

    _getActiveConversation() {
        if (!this._activeConversationId) return null;
        return this._conversations.find(c => c.id === this._activeConversationId);
    }

    _getConversationById(conversationId) {
        if (!conversationId) return null;
        return this._conversations.find(c => c.id === conversationId);
    }

    _addMessageToActiveConversation(role, content) {
        let activeConversation = this._getActiveConversation();
        if (!activeConversation) {
            // This case should ideally be rare if _loadState is robust,
            // but as a fallback, create a new conversation.
            activeConversation = this._createNewConversationInternal();
            // If view is visible, it might need an update that a new conversation was auto-created
            if (this._view) this._sendActiveConversationToWebview();
        }

        activeConversation.messages.push({ role, content, timestamp: Date.now() });
        activeConversation.lastActivity = Date.now();

        // Update title with first user message if it's the first actual message and title is default
        if (activeConversation.messages.length === 1 && role === 'user' && content.length > 0 && activeConversation.title.startsWith("Chat ")) {
            activeConversation.title = content.substring(0, 35) + (content.length > 35 ? '...' : '');
        }

        this._saveState(); // Save after adding a message
    }

    _deleteConversation(conversationId) {
        const conversationToDelete = this._conversations.find(c => c.id === conversationId);
        if (!conversationToDelete) return; // Should not happen if called from QuickPick

        this._conversations = this._conversations.filter(c => c.id !== conversationId);

        if (this._activeConversationId === conversationId) {
            // If the deleted conversation was active, we need to select a new active one.
            this._activeConversationId = null;
            // Don't immediately load another state, instead, clear the webview to show welcome.
            // _loadState() will handle picking a new default or creating one if the view is re-resolved or extension reloads.
            this._saveState(); // Save the fact that there's no active conversation and the updated list.
            if (this._view) {
                this._view.webview.postMessage({ command: 'loadConversation', messages: [] }); // This will show the welcome screen
            }
        } else {
            // If a non-active conversation was deleted, just save the state.
            this._saveState();
        }
        vscode.window.showInformationMessage(`Conversation "${conversationToDelete.title}" deleted.`);
        // The QuickPick will be closed by the event handler.
        // If we wanted to refresh the QuickPick in place, it's more complex.
        // For now, user can re-open history to see the updated list.
    }

    sendTextToWebviewInput(text) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'populateInput',
                text: text
            });
            // Ensure the webview is visible and focused
            if (this._view.show) {
                this._view.show(false); // false to take focus
            }
        }
    }

    // Public method to be called by the command
    createNewConversation() {
        const activeConversation = this._getActiveConversation();

        // If there's an active conversation and it's already empty (implying welcome screen is shown or should be),
        // don't create a new one. Just ensure the webview reflects this empty state.
        if (activeConversation && activeConversation.messages.length === 0) {
            // No explicit info message needed, the webview refreshing the welcome animation is feedback.
            if (this._view) {
                this._sendActiveConversationToWebview(); // This will re-send the empty conversation, triggering welcome
            }
            return; // Exit early
        }

        // Otherwise, proceed to create a new conversation
        this._createNewConversationInternal(); // This sets the new conversation as active
        this._saveState();
        vscode.window.showInformationMessage("New chat started.");
        if (this._view) {
            this._sendActiveConversationToWebview(); // Send the new, empty conversation
        }
    }

    // Public method to be called by the command
    async selectConversationFromHistory() {
        if (this._conversations.length === 0) {
            vscode.window.showInformationMessage("No chat history found. Start a new chat!");
            return;
        }

        // Sort conversations by lastActivity, most recent first
        const sortedConversations = [...this._conversations].sort((a, b) =>
            (b.lastActivity || b.createdAt || 0) - (a.lastActivity || a.createdAt || 0)
        );

        const items = sortedConversations.map(c => {
            let titlePreview = (c.title && !c.title.startsWith("Chat "))
                ? c.title
                : (c.messages.length > 0 && c.messages[0].role === 'user'
                    ? c.messages[0].content.substring(0, 40) + (c.messages[0].content.length > 40 ? '...' : '')
                    : c.title); // Fallback to original title if no user messages
            
            // Helper map for display names
            const modelDisplayNames = {
                "openai_gpt-3.5-turbo": "GPT-3.5T",
                "openai_gpt-4o": "GPT-4o",
                "gemini_1.5_flash": "Gemini 1.5F",
                "deepseek_chat": "DeepSeek-V3 (Chat)",
                "deepseek_reasoner": "DeepSeek-R1 (Reasoner)"
                // Add more mappings as you add models
            };

            const isCurrentChat = c.id === this._activeConversationId;

            const lastUpdated = new Date(c.lastActivity || c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const today = new Date().toLocaleDateString();
            const lastActivityDate = new Date(c.lastActivity || c.createdAt).toLocaleDateString();
            const dateString = (lastActivityDate === today) ? `today at ${lastUpdated}` : `on ${lastActivityDate} at ${lastUpdated}`;

            let modelUsedDisplay = '';
            if (c.lastModelUsed && modelDisplayNames[c.lastModelUsed]) {
                modelUsedDisplay = ` (Model: ${modelDisplayNames[c.lastModelUsed]})`;
            } else if (c.lastModelUsed) { // Fallback if not in map, show raw value
                modelUsedDisplay = ` (Model: ${c.lastModelUsed.replace(/_/g, ' ').replace('gpt', 'GPT')})`; // Basic formatting
            }

            return {
                label: `${isCurrentChat ? '✅ Current: ' : ''}${titlePreview}`,
                description: `Updated ${dateString} (${c.messages.length} messages)${modelUsedDisplay}`,
                id: c.id,
                buttons: [ // Add button for deletion
                    {
                        iconPath: new vscode.ThemeIcon('trash'), // Standard VS Code trash icon
                        tooltip: 'Delete Conversation'
                    }
                ]
            };
        });

        const quickPick = vscode.window.createQuickPick();
        // Although 'items' contains ConversationQuickPickItem, assign to QuickPickItem[] as expected by API.
        // The specific type will be handled by casting when retrieving items.
        quickPick.items = items;
        quickPick.placeholder = "Select a conversation to load, or click the trash icon to delete";
        quickPick.matchOnDescription = true;

        quickPick.onDidAccept(() => {
            // Cast the retrieved item to our specific type
            const selectedItem = /** @type {ConversationQuickPickItem | undefined} */ (quickPick.selectedItems[0]);

            if (selectedItem && selectedItem.id) {
                this._activeConversationId = selectedItem.id;
                this._saveState();
                this._sendActiveConversationToWebview();
                vscode.window.showInformationMessage(`Loaded conversation: ${selectedItem.label}`);
            }
            quickPick.hide();
            quickPick.dispose();
        });

        quickPick.onDidTriggerItemButton(e => {
            // e.button is the button that was clicked. e.item is the item it belongs to.
            // Cast e.item to our specific type to access the 'id' property
            const conversationItem = /** @type {ConversationQuickPickItem} */ (e.item);
            if (conversationItem && conversationItem.id) { // We only have one button type (trash) for now
                this._deleteConversation(conversationItem.id); // Use the 'id' from the casted item
            }
            quickPick.hide();
            quickPick.dispose();
        });

        quickPick.onDidHide(() => quickPick.dispose()); // Important to dispose QuickPick
        quickPick.show();
    }

    _sendActiveConversationToWebview() {
        if (this._view) {
            const activeConversation = this._getActiveConversation();
            this._view.webview.postMessage({
                command: 'loadConversation',
                messages: activeConversation ? activeConversation.messages : [] // Send messages of active chat
            });
        }
    }

    dispose() {
        // Clean up disposables
        if (this._configListenerDisposable) {
            this._configListenerDisposable.dispose();
        }
    }

    resolveWebviewView(webviewView, context, token) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            // Restrict the webview to only loading content from our extension's directory.
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'sendMessage':
                        const userMessage = message.text;
                        const selectedModel = message.selectedModel; // New: get selected model
                        const activeConversation = this._getActiveConversation();

                        if (activeConversation) {
                            this._addMessageToActiveConversation('user', userMessage);
                            this._handleLlmRequest(userMessage, activeConversation.id, selectedModel);
                        } else {
                            vscode.window.showErrorMessage("No active conversation. Please start a new chat.");
                        }
                        return;
                    case 'requestInitialLoad': // Webview requests current conversation on load
                        this._sendActiveConversationToWebview();
                        return;

                }
            },
            undefined,
            // context.subscriptions // This was causing an error, should be this._context.subscriptions if MibCodePilotViewProvider had its own context, or manage disposables differently.
                                  // For onDidReceiveMessage, the disposables are typically managed by the webviewView itself or the main extension context.
                                  // Let's pass undefined for the disposables array for now, or ensure it's correctly managed if needed.
                                  // The `vscode.Disposable` returned by `onDidReceiveMessage` should be pushed to `context.subscriptions` if we want to clean it up on deactivation.
                                  // For simplicity here, we'll rely on the webviewView disposal.
        );
    }

    async _handleLlmRequest(text, conversationId, selectedModel) {
        const activeConversation = this._getConversationById(conversationId);
        if (!activeConversation) {
            vscode.window.showErrorMessage('Error: Could not find active conversation for LLM request.');
            return;
        }

        // Store the model selected for this request on the conversation
        activeConversation.lastModelUsed = selectedModel;
        this._saveState(); // Save this update

        // Map dropdown values to actual model names and service types
        let serviceToUse;
        let modelNameToCall;
        if (selectedModel === "gemini_1.5_flash") { // Updated to only check for gemini_1.5_flash
            console.log(`Gemini model selected: ${selectedModel}. Using Gemini API Key.`);
            if (!this._geminiApiKey) {
                const apiKeyWarning = "Google Gemini API key not configured. Please set it in VS Code settings under 'MIB CodePilot > Gemini: Api Key'.";
                this._view.webview.postMessage({ command: 'receiveMessage', text: apiKeyWarning });
                this._addMessageToActiveConversation('bot', apiKeyWarning);
                vscode.window.showErrorMessage(apiKeyWarning, "Open Settings").then(selection => {
                    if (selection === "Open Settings") {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'mib-codepilot-vscode.gemini.apiKey');
                    }
                });
                return;
            }
            if (!this._geminiService) {
                vscode.window.showErrorMessage("Gemini service not initialized. Check API key."); return;
            }
            serviceToUse = this._geminiService;
            modelNameToCall = "gemini-1.5-flash-latest"; // Directly use the latest flash model

        } else if (selectedModel.startsWith("deepseek_")) { // Check if it's any DeepSeek model
            console.log(`DeepSeek Coder model selected: ${selectedModel}. Using DeepSeek API Key.`);
            if (!this._deepseekApiKey) {
                const apiKeyWarning = "DeepSeek API key not configured. Please set it in VS Code settings under 'MIB CodePilot > Deepseek: Api Key'.";
                this._view.webview.postMessage({ command: 'receiveMessage', text: apiKeyWarning });
                this._addMessageToActiveConversation('bot', apiKeyWarning);
                vscode.window.showErrorMessage(apiKeyWarning, "Open Settings").then(selection => {
                    if (selection === "Open Settings") {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'mib-codepilot-vscode.deepseek.apiKey');
                    }
                });
                return;
            }
            if (!this._deepseekService) { vscode.window.showErrorMessage("DeepSeek service not initialized. Check API key."); return; }
            serviceToUse = this._deepseekService;

            // Map the selected dropdown value to the actual DeepSeek API model name
            // !!! IMPORTANT: Verify these API model names from DeepSeek's documentation !!!
            switch (selectedModel) {
                case "deepseek_reasoner":
                    modelNameToCall = "deepseek-reasoner"; // Or the specific API identifier
                    break;
                case "deepseek_chat":
                default:
                    modelNameToCall = "deepseek-chat"; // Or the specific API identifier
                    break;
            } // Removed the code-davinci-002 check
        } else if (selectedModel === "openai_gpt-4o" || selectedModel === "openai_gpt-3.5-turbo") { // Condition simplified
            console.log(`OpenAI model selected: ${selectedModel}. Using OpenAI API Key.`);
            if (!this._openaiApiKey) {
                const apiKeyWarning = "OpenAI API key not configured. Please set it in VS Code settings under 'MIB CodePilot > OpenAI: Api Key'.";
                this._view.webview.postMessage({ command: 'receiveMessage', text: apiKeyWarning });
                this._addMessageToActiveConversation('bot', apiKeyWarning);
                vscode.window.showErrorMessage(apiKeyWarning, "Open Settings").then(selection => {
                    if (selection === "Open Settings") {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'mib-codepilot-vscode.openai.apiKey');
                    }
                });
                return;
            }
            if (!this._openaiService) {
                vscode.window.showErrorMessage("OpenAI service not initialized. Check API key."); return;
            }
            serviceToUse = this._openaiService;
            // Map selectedModel to actual API model name
            if (selectedModel === "openai_gpt-4o") {
                modelNameToCall = "gpt-4o";
            } else { // For "openai_gpt-3.5-turbo"
                modelNameToCall = "gpt-3.5-turbo";
            }

        } else {
            vscode.window.showErrorMessage(`Unknown model selected: ${selectedModel}`);
            this._addMessageToActiveConversation('bot', `Error: Unknown model selected - ${selectedModel}`);
            this._view.webview.postMessage({ command: 'receiveMessage', text: `Error: Unknown model selected - ${selectedModel}` });
            return;
        }

        // Prepare messages. The services will handle their specific formatting.
        // We pass the raw internal message history.
        const conversationHistory = activeConversation.messages;

        try {
            const reply = await serviceToUse.generateResponse(modelNameToCall, conversationHistory);
            this._addMessageToActiveConversation('bot', reply);
            this._view.webview.postMessage({ command: 'receiveMessage', text: reply });
        } catch (error) {
            console.error(`Error calling ${selectedModel} service:`, error.message);
            this._addMessageToActiveConversation('bot', error.message);
            this._view.webview.postMessage({ command: 'receiveMessage', text: error.message });
            vscode.window.showErrorMessage(error.message);
        }
    }

    _getHtmlForWebview(webview) {
        // Get the local path to main script run in the webview, then convert it to a URI we can use in the webview.
        // const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

        // For simplicity, we'll inline the script for now.
        // In a real extension, you'd want to use `asWebviewUri` for scripts and stylesheets.

        // Get URIs for local resources
        // const mainScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        // const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css'));
        // For markdown-it, if you were to bundle it or include it locally:
        // const markdownItUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'markdown-it.min.js'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading styles from our extension's media folder,
                    and scripts that have a specific nonce or from approved CDNs (like for markdown-it).
                    Adjust 'script-src' if you bundle markdown-it locally.
                -->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>MIB CodePilot Assist</title>
                <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/markdown-it/13.0.1/markdown-it.min.js"></script>
                <style>
                    body {
                        font-family: var(--vscode-font-family, 'Segoe WPC', 'Segoe UI', sans-serif);
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-sideBar-background, #252526); /* More integrated background */
                        padding: 0; /* Remove default padding, control with inner elements */
                        display: flex;
                        flex-direction: column;
                        height: 100vh; box-sizing: border-box; margin: 0;
                    }

                    .welcome-container {
                        text-align: center;
                        padding: 40px 20px;
                        /* margin-bottom: 20px; Let chat container padding handle space */
                        border-bottom: 1px solid var(--vscode-editorWidget-border, #454545); /* Themed border */
                    }
                    /* Hide welcome message by default, show via JS if chat is empty */
                    .welcome-container h2 {
                        font-size: 1.8em;
                        margin-bottom: 0.6em; /* Slightly more margin */
                        font-weight: 600;
                        /* Gradient text color */
                        background: linear-gradient(to right, #e74c3c, #f39c12, #f1c40f, #2ecc71, #3498db, #9b59b6); /* Rainbow: Red, Orange, Yellow, Green, Blue, Purple */
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        background-clip: text;
                        text-fill-color: transparent;
                        display: inline-block; /* Important for background-clip to work as expected on block elements */
                    }
                    .welcome-container p {
                        font-size: 1.1em;
                        color: var(--vscode-descriptionForeground); /* Use VS Code theme color */
                        min-height: 1.3em; /* Prevent layout jump during typing, adjust if font/line-height changes */
                        position: relative; /* For cursor positioning if needed, though direct append is used */
                    }

                    /* Typing cursor for the welcome subtitle */
                    .typing-cursor {
                        display: inline-block;
                        width: 2px;
                        height: 1.1em; /* Should match the font size of the subtitle */
                        background-color: var(--vscode-descriptionForeground);
                        animation: blink 0.7s infinite;
                        margin-left: 3px;
                        vertical-align: text-bottom; /* Aligns cursor nicely with the text */
                    }

                    @keyframes blink {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0; }
                    }

                    #chat-container {
                        flex-grow: 1;
                        overflow-y: auto;
                        padding: 15px; /* More padding */
                        border: none; /* Remove border, body bg provides container feel */
                    }
                    .message-wrapper {
                        display: flex;
                        flex-direction: column;
                        /* padding-bottom will be handled by user/bot specific wrappers or content spacing */
                        margin-bottom: 15px; /* Space after the conceptual separator, before the next message */
                        position: relative; /* For absolute positioning of the pseudo-element separator */
                    }
                    /* Full-width, thin line separator */
                    .message-wrapper:not(:last-child)::after {
                        content: '';
                        position: absolute;
                        /* Extend to the edge, counteracting #chat-container padding */
                        left: -15px;
                        right: -15px;
                        /* Position at the very bottom of the wrapper, before its margin-bottom */
                        bottom: 0;
                        height: 1px;
                        background-color: var(--vscode-editorWidget-border, #45454530); /* Very subtle/thin color */
                    }
                    .message-header { display: flex; align-items: center; margin-bottom: 8px; }
                    .icon {
                        width: 28px; height: 28px; /* Slightly larger */
                        border-radius: 50%;
                        margin-right: 10px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: bold;
                        color: var(--vscode-button-foreground);
                    }
                    .user-icon { background-color: var(--vscode-terminalCommandDecoration-defaultBackground, #007acc); } /* User initials or simple icon */
                    .bot-icon { background-color: var(--vscode-terminalCommandDecoration-successBackground, #4CAF50); } /* Bot initials or simple icon */

                    .sender-name { font-weight: 600; font-size: 0.9em; color: var(--vscode-editorHint-foreground); }

                    .message-content {
                        word-wrap: break-word;
                        line-height: 1.6;
                        font-size: 0.95em; /* Base font size for content */
                        /* No margin-left, content flows from the start */
                        /* No max-width, it will be 100% of its container by default */
                        border-radius: 0; /* No border radius for flowing text */
                    }
                    .user.message-wrapper {
                        /* Reset to be like bot messages, no special background or padding */
                        padding-bottom: 10px; /* Consistent spacing like bot messages */
                    }
                    .user .message-content {
                        /* Styles for user text, inherits background from wrapper */
                        color: var(--vscode-editor-foreground);
                        font-size: 1em; /* Slightly larger font for user's chat */
                    }
                    .bot.message-wrapper {
                        padding-bottom: 10px; /* Space after bot content before the separator line */
                    }
                    .bot .message-content {
                        /* Bot message content flows with chat background (transparent wrapper) */
                        color: var(--vscode-editor-foreground); /* Use main editor foreground for bot text */
                    }

                    /* Specific padding for paragraphs and lists inside bot messages for better flow */
                    .bot .message-content p, .bot .message-content ul, .bot .message-content ol { margin-top: 0; margin-bottom: 0.5em; }
                    .bot .message-content p:last-child, .bot .message-content ul:last-child, .bot .message-content ol:last-child { margin-bottom: 0; }

                    .bot .message-content pre {
                        background-color: var(--vscode-textCodeBlock-background, #0a0a0a);
                        color: var(--vscode-editor-foreground);
                        padding: 1em;
                        overflow-x: auto; /* Allows horizontal scrolling for wide code */
                        border-radius: 4px;
                        margin: 0.8em 0;
                        max-width: 100%; /* Ensures pre doesn't overflow its container */
                        box-sizing: border-box; /* Includes padding and border in the element's total width and height */
                    }
                    .bot .message-content code { font-family: 'Courier New', Courier, monospace; font-size: 0.9em; }
                    .bot .message-content :not(pre) > code { background-color: var(--vscode-textSeparator-foreground, #555); padding: 0.2em 0.4em; border-radius: 3px; color: var(--vscode-editor-foreground); }

                    #input-area { display: flex; padding: 10px 15px; background-color: var(--vscode-editor-background, #1e1e1e); border-top: 1px solid var(--vscode-editorWidget-border, #454545); align-items: flex-end; /* Align items to bottom for textarea growth */ }
                    /* Wrapper for model selector and text input area */
                    #input-controls-wrapper { display: flex; flex-direction: column; flex-grow: 1; }
                    #model-selector-container { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
                    #llm-model-select {
                        padding: 5px 8px;
                        border-radius: 4px;
                        background-color: var(--vscode-input-background, #3c3c3c);
                        color: var(--vscode-input-foreground, #cccccc);
                        border: 1px solid var(--vscode-input-border, #3c3c3c);
                        font-family: inherit;
                        font-size: 0.9em;
                    }
                    /* Holds textarea and send button */
                    #text-input-area { display: flex; align-items: flex-end; width: 100%; }
                    #message-input { flex-grow: 1; padding: 10px; border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 6px; background-color: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-family: inherit; font-size: 1em; line-height: 1.4; resize: none; overflow-y: auto; max-height: 150px; min-height: 24px; box-sizing: border-box; }
                    #message-input:focus { border-color: var(--vscode-focusBorder, #007fd4); outline: none; }
                    /* Adjusted send button to be part of text-input-area */
                    #send-button { background-color: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, white); border: none; border-radius: 6px; padding: 0; width: 40px; height: 40px; margin-left: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s ease; flex-shrink: 0; /* Prevent button from shrinking */ }
                    #send-button:hover { background-color: var(--vscode-button-hoverBackground, #1177bb); }
                    #send-button svg { width: 20px; height: 20px; fill: currentColor; }
                </style>
			</head>
			<body>
                <div id="welcome-message" class="welcome-container">
                    <h2>MIB CodePilot at your service!</h2>
                    <p id="welcome-subtitle">&nbsp;</p> <!-- Subtitle will be typed here -->
                </div>
				<div id="chat-container">
                    <!-- Messages will appear here -->
                </div>
                <div id="input-area">
                    <div id="input-controls-wrapper">
                        <div id="model-selector-container">
                            <label for="llm-model-select" style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Model:</label>
                            <select name="llm-model" id="llm-model-select">
                                <option value="openai_gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI - Paid)</option>
                                <option value="openai_gpt-4o">GPT-4o (OpenAI - Paid)</option>
                                <option value="gemini_1.5_flash">Gemini 1.5 Flash (Google - Free Tier)</option>
                                <option value="deepseek_chat">DeepSeek-V3 (DeepSeek - Chat)</option>
                                <option value="deepseek_reasoner">DeepSeek-R1 (DeepSeek - Reasoner)</option>
                            </select>
                        </div>
                        <div id="text-input-area">
                            <textarea id="message-input" placeholder="Ask MIB CodePilot..." rows="1"></textarea>
                            <button id="send-button" title="Send Message">
                                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>

				<script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const chatContainer = document.getElementById('chat-container');
                    const welcomeMessageContainer = document.getElementById('welcome-message');
                    const md = window.markdownit(); // Initialize markdown-it
                    const welcomeSubtitleElement = document.getElementById('welcome-subtitle');
                    const llmModelSelect = document.getElementById('llm-model-select'); // Get model selector
                    const fullSubtitleText = "Ready to supercharge your coding workflow? Ask me anything or let's explore your code together!";
                    let subtitleTyped = false; // Flag to ensure animation runs only once

                    const messageInput = document.getElementById('message-input'); // Now a textarea
                    const sendButton = document.getElementById('send-button');


                    // Request initial conversation load when webview is ready
                    vscode.postMessage({ command: 'requestInitialLoad' });

                    sendButton.addEventListener('click', () => {
                        sendMessage();
                    });

                    messageInput.addEventListener('keydown', (event) => { // Changed to keydown for better control
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault(); // Prevent default Enter behavior (newline)
                            sendMessage();
                        }
                        // Auto-resize textarea
                        setTimeout(() => { // Timeout ensures value is updated before height calculation
                            messageInput.style.height = 'auto';
                            messageInput.style.height = (messageInput.scrollHeight) + 'px';
                        }, 0);
                    });

                    // Initial resize for placeholder or pre-filled text
                    messageInput.addEventListener('input', () => {
                        messageInput.style.height = 'auto';
                        if (messageInput.scrollHeight > 0) { // Check scrollHeight to avoid issues when empty
                            messageInput.style.height = (messageInput.scrollHeight) + 'px';
                        }
                    });

                    function sendMessage() {
                        const text = messageInput.value;
                        if (text.trim() === '') return;
                        const selectedModel = llmModelSelect.value; // Get selected model

                        welcomeMessageContainer.style.display = 'none'; // Hide welcome message
                        // Display user message immediately
                        appendMessage({ role: 'user', content: text });

                        vscode.postMessage({
                            command: 'sendMessage',
                            text: text,
                            selectedModel: selectedModel // Send selected model
                        });
                        messageInput.value = '';
                        messageInput.style.height = 'auto'; // Reset height after sending
                        messageInput.focus();
                    }

                    function appendMessage(message) {
                        const isUser = message.role === 'user';
                        const wrapper = document.createElement('div');
                        wrapper.className = 'message-wrapper ' + (isUser ? 'user' : 'bot');

                        const header = document.createElement('div');
                        header.className = 'message-header';

                        const icon = document.createElement('div');
                        icon.className = 'icon ' + (isUser ? 'user-icon' : 'bot-icon');
                        // You could put initials or a simple SVG here if desired
                        // icon.textContent = isUser ? 'U' : 'M';

                        const name = document.createElement('span');
                        name.className = 'sender-name';
                        name.textContent = isUser ? 'You' : 'MIB CodePilot';

                        header.appendChild(icon);
                        header.appendChild(name);

                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';

                        if (!isUser) { // Bot message, render markdown
                            contentDiv.innerHTML = md.render(message.content);
                        } else { // User message, plain text
                            contentDiv.textContent = message.content;
                        }

                        wrapper.appendChild(header);
                        wrapper.appendChild(contentDiv);
                        chatContainer.appendChild(wrapper);

                        chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom
                    }

                    function typeWriter(element, text, speed, callback) {
                        let i = 0;
                        element.innerHTML = ''; // Clear initial content (e.g., &nbsp;)
                        
                        const textNode = document.createTextNode('');
                        element.appendChild(textNode);

                        const cursorSpan = document.createElement('span');
                        cursorSpan.className = 'typing-cursor';
                        element.appendChild(cursorSpan);

                        function type() {
                            if (i < text.length) {
                                textNode.nodeValue += text.charAt(i);
                                i++;
                                setTimeout(type, speed);
                            } else {
                                // Typing finished
                                if (callback) callback();
                            }
                        }
                        type();
                    }

                    window.addEventListener('message', event => {
                        const message = event.data; // The JSON data our extension sent
                        switch (message.command) {
                            case 'receiveMessage':
                                welcomeMessageContainer.style.display = 'none'; // Hide welcome message
                                appendMessage({ role: 'bot', content: message.text });
                                break;
                            case 'loadConversation':
                                chatContainer.innerHTML = ''; // Clear existing messages
                                let showWelcome = true; // Assume welcome should be shown by default

                                if (message.messages && Array.isArray(message.messages)) {
                                    message.messages.forEach(msg => appendMessage(msg));
                                    if (message.messages.length > 0) {
                                        showWelcome = false; // We have messages, so don't show welcome
                                    }
                                }

                                welcomeMessageContainer.style.display = showWelcome ? 'block' : 'none';

                                // If the welcome message is being displayed, reset the subtitleTyped flag
                                // so the animation can run again.
                                if (showWelcome) {
                                    subtitleTyped = false;
                                }

                                chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom after loading
                                
                                // Start typing animation if welcome message is visible and not yet typed
                                if (!subtitleTyped && welcomeMessageContainer.style.display === 'block') {
                                    subtitleTyped = true;
                                    typeWriter(welcomeSubtitleElement, fullSubtitleText, 50, () => {
                                    });
                                }
                                break;
                            case 'populateInput':
                                messageInput.value = message.text;
                                messageInput.focus();
                                // Trigger input event to resize textarea if populated with multi-line text
                                const event = new Event('input', { bubbles: true, cancelable: true });
                                messageInput.dispatchEvent(event);

                                break;
                        }
                    });
				</script>
			</body>
			</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function deactivate() {
    // If the provider was stored globally or needs explicit cleanup, do it here.
    // For now, assuming VS Code handles disposal of registered providers.
    // If MibCodePilotViewProvider had disposables, they should be cleaned up.
}

module.exports = {
    activate,
    deactivate
};
