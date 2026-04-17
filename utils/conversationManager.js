// utils/conversationManager.js
// In-memory conversation store with TTL cleanup

const { v4: uuidv4 } = require('uuid');

class ConversationManager {
  constructor(ttlMs = 1800000) { // 30 min default
    this.sessions = new Map();
    this.ttl = ttlMs;
    
    // Cleanup expired sessions every 10 minutes
    setInterval(() => this.cleanup(), 600000);
  }

  /**
   * Create a new session
   */
  createSession() {
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      messages: [],
      metadata: {
        createdAt: Date.now(),
        lastActivity: Date.now(),
        // MCC flow tracking
        mccFlow: {
          active: false,
          step: 0,
          collected: {
            totalLoad: null,
            numMotors: null,
            starterType: null,
            incomers: null
          }
        },
        // Lead data
        lead: {
          name: null,
          phone: null,
          company: null,
          intent: 'browsing' // browsing | interested | hot
        },
        // Message count for WhatsApp nudge timing
        messageCount: 0,
        whatsappSuggested: false
      }
    };
    
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check TTL
    if (Date.now() - session.metadata.lastActivity > this.ttl) {
      this.sessions.delete(sessionId);
      return null;
    }
    
    // Update last activity
    session.metadata.lastActivity = Date.now();
    return session;
  }

  /**
   * Add message to session
   */
  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    
    session.messages.push({
      role,
      content,
      timestamp: Date.now()
    });
    
    if (role === 'user') {
      session.metadata.messageCount++;
    }
    
    // Keep last 20 messages for context (prevents token overflow)
    if (session.messages.length > 20) {
      // Always keep first message (context) and trim middle
      const trimmed = session.messages.slice(-18);
      session.messages = trimmed;
    }
    
    return session;
  }

  /**
   * Get messages formatted for OpenAI API
   */
  getMessagesForAPI(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return [];
    
    return session.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Update session metadata
   */
  updateMetadata(sessionId, updates) {
    const session = this.getSession(sessionId);
    if (!session) return;
    
    // Deep merge metadata
    Object.keys(updates).forEach(key => {
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        session.metadata[key] = { ...session.metadata[key], ...updates[key] };
      } else {
        session.metadata[key] = updates[key];
      }
    });
  }

  /**
   * Get session metadata
   */
  getMetadata(sessionId) {
    const session = this.getSession(sessionId);
    return session ? session.metadata : null;
  }

  /**
   * Check if session should suggest WhatsApp
   */
  shouldSuggestWhatsApp(sessionId) {
    const meta = this.getMetadata(sessionId);
    if (!meta) return false;
    
    // Suggest after 4 messages if not already suggested
    return meta.messageCount >= 4 && !meta.whatsappSuggested;
  }

  /**
   * Cleanup expired sessions
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.metadata.lastActivity > this.ttl) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[ConversationManager] Cleaned ${cleaned} expired sessions. Active: ${this.sessions.size}`);
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      uptime: process.uptime()
    };
  }
}

// Singleton instance
const manager = new ConversationManager(
  parseInt(process.env.CONVERSATION_TTL) || 1800000
);

module.exports = manager;
