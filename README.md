# MIB-CodePilot for VS Code

![MIB-CodePilot Logo Placeholder](link-to-your-logo-or-badge-here) # Optional: Add a logo or badge later

Your flexible AI coding companion directly within Visual Studio Code. MIB-CodePilot provides intelligent code suggestions, completions, and assistance, powered by your choice of leading AI models.

## Features

-   **Pluggable AI Models:** Easily switch between different AI backends like OpenAI, Claude, Gemini, and more.
-   **Intelligent Code Suggestions:** Get context-aware code completions as you type.
-   **Code Actions:** (Coming Soon) Implement quick fixes, refactorings, explanations, and other AI-driven actions.
-   **Customizable:** Configure your preferred model and API keys via VS Code settings.

## Supported Models

Currently supports (or planning to support):

-   OpenAI (GPT-3.5, GPT-4, etc.)
-   Anthropic Claude (Claude 3, etc.)
-   Google Gemini (Gemini Pro, etc.)
-   *(Add others as you implement them)*

## Installation

1.  Open VS Code.
2.  Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3.  Search for "MIB-CodePilot" (Once published to the VS Code Marketplace).
4.  Click "Install".

**Alternatively, if installing from source:**

1.  Clone this repository: `git clone https://github.com/YourGitHubUsername/mib-codepilot-vscode.git`
2.  Navigate into the cloned directory: `cd mib-codepilot-vscode`
3.  Install dependencies: `npm install`
4.  Open the project in VS Code: `code .`
5.  Press `F5` to run the extension in a new Extension Development Host window.

## Configuration

After installing, you need to configure which AI model to use and provide your API key.

1.  Open VS Code Settings (`File > Preferences > Settings` or `Code > Preferences > Settings`).
2.  Search for "MIB Code Assist" or "mibCodeAssist".
3.  Configure the following settings:
    *   **`mibCodeAssist.model`**: Select your preferred AI model from the dropdown (e.g., `openai`, `claude`, `gemini`).
    *   **`mibCodeAssist.openaiApiKey`**: Enter your OpenAI API key if you selected OpenAI.
    *   **`mibCodeAssist.claudeApiKey`**: Enter your Claude API key if you selected Claude.
    *   **`mibCodeAssist.geminiApiKey`**: Enter your Gemini API key if you selected Gemini.
    *   *(Add other model-specific settings here)*

**Important:** Keep your API keys secure and do not commit them to your repository!

## Usage

Once configured, MIB-CodePilot will automatically start providing code assistance based on the selected model.

-   **Code Completions:** As you type, suggestions from the AI model will appear. Press `Tab` (or your configured keybinding) to accept them.
-   **Code Actions:** (Coming Soon) Right-click on code or look for the lightbulb icon to see available AI-powered actions.

*(You can add more specific usage examples or screenshots here as features are built)*

## Contributing

We welcome contributions! If you'd like to contribute, please see our CONTRIBUTING.md file (Create this file later).

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgements

-   Thanks to the VS Code team for the excellent extension API.
-   Thanks to OpenAI, Anthropic, Google, and other AI providers for their models.
-   *(Add any other relevant acknowledgements)*

---

**Man In Base**

*(Optional: Add a link to your personal website or organization)*