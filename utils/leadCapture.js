// utils/leadCapture.js
// Simple file-based lead logging (works on shared hosting without DB)

const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const LOG_FILE = path.join(__dirname, '../data/chat_logs.json');

// Ensure data directory exists
function ensureDataDir() {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Save a lead to file
 */
function saveLead(leadData) {
  try {
    ensureDataDir();
    
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) {
      const raw = fs.readFileSync(LEADS_FILE, 'utf8');
      leads = JSON.parse(raw);
    }
    
    const lead = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...leadData
    };
    
    leads.push(lead);
    
    // Keep last 1000 leads
    if (leads.length > 1000) {
      leads = leads.slice(-1000);
    }
    
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    return lead;
  } catch (err) {
    console.error('[LeadCapture] Error saving lead:', err.message);
    return null;
  }
}

/**
 * Detect if user message contains contact info
 */
function extractContactInfo(message) {
  const info = {};
  
  // Phone number detection (Indian numbers)
  const phoneRegex = /(?:\+91|91|0)?[6-9]\d{9}/g;
  const phones = message.match(phoneRegex);
  if (phones && phones.length > 0) {
    info.phone = phones[0].replace(/^\+91|^91|^0/, '');
  }
  
  // Email detection
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = message.match(emailRegex);
  if (emails && emails.length > 0) {
    info.email = emails[0];
  }
  
  return info;
}

/**
 * Detect buying intent level
 */
function detectIntent(message) {
  const msg = message.toLowerCase();
  
  const hotKeywords = ['buy', 'order', 'purchase', 'price', 'cost', 'rate', 'quotation', 'quote', 'kharidna', 'lena hai', 'chahiye'];
  const warmKeywords = ['interested', 'requirement', 'project', 'plant', 'factory', 'install'];
  
  if (hotKeywords.some(k => msg.includes(k))) return 'hot';
  if (warmKeywords.some(k => msg.includes(k))) return 'warm';
  return 'browsing';
}

/**
 * Log chat session (anonymized)
 */
function logSession(sessionId, messages, metadata) {
  try {
    ensureDataDir();
    
    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      logs = JSON.parse(raw);
    }
    
    logs.push({
      sessionId: sessionId.substring(0, 8) + '...', // anonymize
      timestamp: new Date().toISOString(),
      messageCount: messages.length,
      intent: metadata?.lead?.intent || 'unknown',
      whatsappReached: metadata?.whatsappSuggested || false
    });
    
    // Keep last 500 logs
    if (logs.length > 500) {
      logs = logs.slice(-500);
    }
    
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    // Non-critical, don't crash
    console.error('[LeadCapture] Log error:', err.message);
  }
}

/**
 * Get all leads (for admin use)
 */
function getLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) return [];
    const raw = fs.readFileSync(LEADS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

module.exports = { saveLead, extractContactInfo, detectIntent, logSession, getLeads };
