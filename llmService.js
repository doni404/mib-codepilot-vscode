const axios = require('axios');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

class OpenAIService {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error("OpenAI API key is required.");
        }
        this.apiKey = apiKey;
        this.endpoint = 'https://api.openai.com/v1/chat/completions';
    }

    async generateResponse(modelName, messages) {
        // Ensure messages are in the format OpenAI expects: [{ role: "user/assistant/system", content: "..." }]
        // The role 'bot' from internal storage should be mapped to 'assistant'.
        const formattedMessages = messages.map(msg => ({
            role: msg.role === 'bot' ? 'assistant' : msg.role,
            content: msg.content
        }));

        try {
            const response = await axios.post(this.endpoint, {
                model: modelName,
                messages: formattedMessages
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.choices && response.data.choices.length > 0 && response.data.choices[0].message) {
                return response.data.choices[0].message.content.trim();
            } else {
                throw new Error("Invalid response structure from OpenAI.");
            }
        } catch (error) {
            console.error("Error calling OpenAI Service:", error.response ? error.response.data : error.message);
            let errorMessage = "Error fetching reply from OpenAI.";
            if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
                errorMessage += ` Details: ${error.response.data.error.message}`;
            }
            throw new Error(errorMessage);
        }
    }
}

class GeminiService {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error("Gemini API key is required.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async generateResponse(modelName, messages) {
        // Gemini expects model names like 'gemini-1.0-pro', 'gemini-1.5-flash-latest'
        // We'll map our internal selectedModel values if needed, or assume they are correct.
        const model = this.genAI.getGenerativeModel({ model: modelName });

        // Transform messages to Gemini's format:
        // [{ role: "user", parts: [{ text: "..." }] }, { role: "model", parts: [{ text: "..." }] }]
        // Filter out system messages if any, as Gemini handles system prompts differently or not in history.
        const history = messages
            .filter(msg => msg.role === 'user' || msg.role === 'bot') // Gemini uses 'user' and 'model'
            .map(msg => ({
                role: msg.role === 'bot' ? 'model' : msg.role,
                parts: [{ text: msg.content }]
            }));

        // The last message is the current prompt, remove it from history for startChat
        const currentPromptMsg = history.pop();
        if (!currentPromptMsg || currentPromptMsg.role !== 'user') {
            throw new Error("Last message must be from the user for Gemini chat.");
        }
        const currentPrompt = currentPromptMsg.parts[0].text;

        try {
            const chat = model.startChat({
                history: history,
                generationConfig: {
                    // maxOutputTokens: 200, // Optional
                },
                // Safety settings can be configured here if needed
                // safetySettings: [
                //   { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                // ],
            });

            const result = await chat.sendMessage(currentPrompt);
            const response = result.response;
            return response.text();
        } catch (error) {
            console.error("Error calling Gemini Service:", error);
            throw new Error(`Error fetching reply from Gemini: ${error.message}`);
        }
    }
}

module.exports = {
    OpenAIService,
    GeminiService
};