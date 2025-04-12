require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Chat history storage (in-memory, consider a database for production)
const chatSessions = {};

// Helper function to initialize or get chat session
function getChatSession(sessionId, modelName = 'gemini-1.5-pro-latest') {
  if (!chatSessions[sessionId]) {
    const model = genAI.getGenerativeModel({ model: modelName });
    chatSessions[sessionId] = model.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.9,
        topP: 0.95,
      },
    });
  }
  return chatSessions[sessionId];
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Gemini AI Chatbot API is running' });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
      const { message, sessionId = 'default' } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }
  
      // Initialize model with timeout
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-pro-latest',
        requestOptions: {
          timeout: 10000, // 10 second timeout
        }
      });
  
      // Retry logic (3 attempts)
      let attempts = 0;
      let lastError = null;
      
      while (attempts < 3) {
        try {
          const result = await model.generateContent(message);
          const response = await result.response;
          const text = response.text();
          
          return res.json({
            response: text,
            sessionId,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          lastError = error;
          attempts++;
          if (attempts < 3) {
            console.log(`Retry attempt ${attempts}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
          }
        }
      }
  
      throw lastError; // If all retries failed
  
    } catch (error) {
      console.error('Chat Error:', error);
      
      // More specific error messages
      let errorMessage = 'Failed to process chat message';
      if (error.message.includes('fetch failed')) {
        errorMessage = 'Network error connecting to Gemini API';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timed out';
      }
      
      res.status(500).json({ 
        error: errorMessage,
        details: error.message,
        solution: 'Please check your internet connection and try again'
      });
    }
  });

// Clear chat history endpoint
app.post('/api/clear', (req, res) => {
  const { sessionId = 'default' } = req.body;
  if (chatSessions[sessionId]) {
    delete chatSessions[sessionId];
  }
  res.json({ status: 'OK', message: 'Chat history cleared', sessionId });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Gemini AI Chatbot API is ready`);
});