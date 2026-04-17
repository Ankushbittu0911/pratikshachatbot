// routes/chat.js
// Main chat API endpoint

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const conversationManager = require('../utils/conversationManager');
const { saveLead, extractContactInfo, detectIntent, logSession } = require('../utils/leadCapture');
const { SYSTEM_PROMPT } = require('../config/systemPrompt');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '919876543210';

/**
 * POST /api/chat/start
 * Initialize a new conversation session
 */
router.post('/start', (req, res) => {
  try {
    const sessionId = conversationManager.createSession();
    
    res.json({
      success: true,
      sessionId,
      greeting: null // Frontend handles initial greeting
    });
  } catch (err) {
    console.error('[Chat/Start]', err);
    res.status(500).json({ success: false, error: 'Session creation failed' });
  }
});

/**
 * POST /api/chat/message
 * Send a message and get AI response
 */
router.post('/message', async (req, res) => {
  const { sessionId, message } = req.body;
  
  // Validation
  if (!sessionId || !message) {
    return res.status(400).json({ success: false, error: 'sessionId and message required' });
  }
  
  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid message' });
  }
  
  if (message.length > 500) {
    return res.status(400).json({ success: false, error: 'Message too long (max 500 chars)' });
  }
  
  // Get or validate session
  let session = conversationManager.getSession(sessionId);
  let isNewSession = false;
  
  if (!session) {
    // Session expired - create new one silently
    const newId = conversationManager.createSession();
    session = conversationManager.getSession(newId);
    isNewSession = true;
    console.log(`[Chat] Session ${sessionId.substring(0,8)} expired, created new: ${newId.substring(0,8)}`);
  }
  
  const activeSessionId = isNewSession ? session.id : sessionId;
  
  try {
    // Extract any contact info from message
    const contactInfo = extractContactInfo(message.trim());
    const intent = detectIntent(message.trim());
    
    // Update lead metadata if new info found
    if (contactInfo.phone || contactInfo.email) {
      conversationManager.updateMetadata(activeSessionId, {
        lead: { ...contactInfo }
      });
      
      // Save lead
      const metadata = conversationManager.getMetadata(activeSessionId);
      saveLead({
        sessionId: activeSessionId.substring(0, 8),
        ...contactInfo,
        intent: metadata?.lead?.intent || intent,
        source: 'chat_widget'
      });
    }
    
    if (intent === 'hot' || intent === 'warm') {
      conversationManager.updateMetadata(activeSessionId, {
        lead: { intent }
      });
    }
    
    // Add user message to session
    conversationManager.addMessage(activeSessionId, 'user', message.trim());
    
    // Build messages for OpenAI
    const conversationHistory = conversationManager.getMessagesForAPI(activeSessionId);
    const metadata = conversationManager.getMetadata(activeSessionId);
    
    // Build context injection for flow state
    let contextNote = '';
    if (metadata?.mccFlow?.active) {
      const flow = metadata.mccFlow;
      const collected = Object.entries(flow.collected)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      if (collected) {
        contextNote = `\n[SYSTEM NOTE: MCC flow in progress. Already collected: ${collected}. Do NOT re-ask these. Next step: ${flow.step}]`;
      }
    }
    
    const shouldSuggestWA = conversationManager.shouldSuggestWhatsApp(activeSessionId);
    if (shouldSuggestWA) {
      contextNote += `\n[SYSTEM NOTE: User has sent ${metadata.messageCount} messages. If appropriate, naturally suggest connecting on WhatsApp for faster help. WhatsApp: ${WHATSAPP_NUMBER}]`;
      conversationManager.updateMetadata(activeSessionId, { whatsappSuggested: true });
    }
    
    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT + contextNote
        },
        ...conversationHistory
      ],
      max_tokens: 300,
      temperature: 0.75,
      presence_penalty: 0.3,
      frequency_penalty: 0.3
    });
    
    const aiMessage = response.choices[0]?.message?.content?.trim();
    
    if (!aiMessage) {
      throw new Error('Empty response from AI');
    }
    
    // Add AI response to session
    conversationManager.addMessage(activeSessionId, 'assistant', aiMessage);
    
    // Detect if AI mentioned WhatsApp
    const mentionedWA = /whatsapp|wa\.me|9\d{9}/i.test(aiMessage);
    
    // Build response
    const responseData = {
      success: true,
      message: aiMessage,
      sessionId: activeSessionId,
      meta: {
        showWhatsApp: mentionedWA || shouldSuggestWA,
        whatsappNumber: WHATSAPP_NUMBER,
        sessionRestored: isNewSession,
        tokens: response.usage?.total_tokens || 0
      }
    };
    
    res.json(responseData);
    
  } catch (err) {
    console.error('[Chat/Message] Error:', err.message);
    
    // User-friendly error messages
    let userMessage = 'Kuch technical issue aa gaya. Thoda wait karo aur try karo. 🙏';
    
    if (err.code === 'insufficient_quota') {
      userMessage = 'Service temporarily unavailable. Please contact us directly on WhatsApp. 📞';
    } else if (err.code === 'rate_limit_exceeded') {
      userMessage = 'Bahut saare messages aa rahe hain abhi. Thodi der baad try karo. 🙏';
    }
    
    res.status(500).json({
      success: false,
      error: userMessage,
      sessionId: activeSessionId
    });
  }
});

/**
 * GET /api/chat/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const stats = conversationManager.getStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...stats
  });
});

/**
 * DELETE /api/chat/session/:id
 * Clear a session (user closed chat)
 */
router.delete('/session/:id', (req, res) => {
  const { id } = req.params;
  const metadata = conversationManager.getMetadata(id);
  const messages = conversationManager.getMessagesForAPI(id);
  
  // Log the session before deletion
  if (messages.length > 0) {
    logSession(id, messages, metadata);
  }
  
  // Sessions auto-expire, just acknowledge
  res.json({ success: true });
});

/**
 * GET /api/chat/whatsapp-url
 * Generate WhatsApp URL with pre-filled message
 */
router.post('/whatsapp-url', (req, res) => {
  const { sessionId, context } = req.body;
  const number = WHATSAPP_NUMBER;
  
  let message = 'Hello! Main Pratiksha Technologies ke chatbot se connect ho raha tha aur mujhe electrical panel ke baare mein discuss karna tha.';
  
  if (context) {
    message = `Hello! ${context} Kya aap mujhe proper quotation de sakte hain?`;
  }
  
  const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  res.json({ success: true, url });
});

module.exports = router;
