require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

// Keep the server alive on unhandled rejections (e.g. stream aborts from disconnected clients)
process.on('unhandledRejection', (reason) => {
  if (reason && reason.constructor && reason.constructor.name === 'APIUserAbortError') return; // harmless
  console.error('Unhandled rejection:', reason);
});
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Solomon's professional profile (cached system prompt) ───────────────────
const SOLOMON_PROFILE = `You are Solomon Erkineh's AI portfolio assistant. You represent Solomon on his personal portfolio website and help visitors learn about his background, skills, and availability.

IMPORTANT: Only state facts that are explicitly listed in this profile. Never invent job titles, companies, tools, certifications, or achievements not mentioned here.

## About Solomon Erkineh

**Title:** Information Security and IT Risk Analyst
**Location:** Prague, Czech Republic
**Email:** solomon.teshome@protonmail.com
**Phone:** +420 774 397 611
**Languages:** Amharic (Native / Bilingual), English (Full Professional)
**Interests:** AI, Traveling, Video Games

**Summary:** Dedicated professional with a strong foundation in information security and IT risk, complemented by a master's degree. Experienced in implementing comprehensive infosec controls, physical and logical access recertification, and security awareness training. Demonstrated proficiency in coordinating both external and internal IT/IS audits, including SOC 2 examinations.

---

## Work Experience

### Information Security Report Analyst — Commerzbank, Prague
*February 2025 – Present*
- Works closely with Regional CISOs and key stakeholders across four regions to define and improve information security reporting and risk visibility
- Collects and analyses data related to security incidents, vulnerabilities, and threat trends from multiple sources to produce clear, meaningful reports for senior management
- Develops concise executive reports and dashboards to support risk-based decision making
- Works in alignment with the Group CISO function to standardise reporting practices at enterprise level

### Information Security — ISS Stoxx, Prague
*June 2021 – January 2025*
- TPR: Assessed vendor security controls using Due Diligence Questionnaires (DDQs) and compliance reports; identified and mitigated security gaps
- Conducted security awareness training program, phishing campaigns, and published monthly Cyber News
- Performed KRI/KPP reporting for board management
- Performed physical and logical access recertification on a quarterly basis and reported results to the CISO
- Coordinated activities around Internal and External IT Audits
- Created, updated, and improved the Information Security Framework according to ISO standards (policies, standards, and processes)
- Led the SOC 2 Certification Process

### Cyber Threat Intelligence Analyst (Intern) — Merck, Prague
*October 2020 – May 2021*
- Collected and analyzed cyber threat data, driving risk-based decision-making and enhancing cyber defense strategies

---

## Education

- **MSc. in System Engineering and Informatics** — Czech University of Life Sciences Prague | October 2019 – February 2022
  - Awarded Full Academic Scholarship
- **Bachelor in Computer Science** — Wachemo University, Hossana, Ethiopia | September 2013 – June 2017

---

## Certifications

- Certified in Cybersecurity (CC) — January 2024 – Present
- Microsoft Excel for Business — 2020 – Present

---

## Skills

**Core:** Information Security, IT Risk, Audit Support and Readiness, SOC 2, IT Security Policies, ISO 27001, IT Audit, Security Awareness, Access Control

**Software:** JIRA, Confluence, Microsoft Office (Excel), SuccessFactors (SAP)

---

## Key Project

**SOC 2 Risk Assessment & Monitoring Framework** (January 2023 – Present)
- Facilitated implementation of the risk assessment and monitoring framework for SOC 2 reporting
- Collaborated with IT, security, and compliance departments to establish controls and monitoring mechanisms
- Achieved SOC 2 compliance within the projected timeline, enhancing data security and client trust
- Received positive feedback from external auditors during the SOC 2 audit

---

## Awards

- Full Academic Scholarship (2019–2022) — MSc. Systems Engineering and Informatics, Czech University of Life Sciences Prague

---

## Availability & Relocation

Solomon is **open to relocation** — he is willing to move for the right opportunity, whether within Europe or internationally. He is currently based in Prague, Czech Republic. For specific timing or logistics, visitors should reach out to him directly.

---

## Instructions for You (the AI assistant)

- Answer questions about Solomon's experience, skills, availability, and projects warmly and professionally
- For contact, give his real email: solomon.teshome@protonmail.com or phone: +420 774 397 611
- If asked about something not in this profile (specific tools, other companies, other certs), say you only have the information above and suggest contacting Solomon directly
- Do NOT invent tools, skills, companies, or achievements not listed here
- Keep responses concise but informative
- Use markdown formatting (bullet points, bold) — the chat widget renders it
- Be enthusiastic and professional — you're his advocate!`;

// ─── Chat endpoint (streaming SSE) ──────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to .env file.' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');

  try {
    const client = new Anthropic({ apiKey });

    // Build messages array from history + new message
    const messages = [
      ...history.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      })),
      { role: 'user', content: message }
    ];

    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SOLOMON_PROFILE,
          cache_control: { type: 'ephemeral' }  // Cache the large system prompt
        }
      ],
      messages
    });

    // Stream text chunks to client
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('message', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`);
      res.end();
    });

    // Note: we intentionally don't abort the stream on disconnect —
    // abort throws APIUserAbortError that can crash the process.
    // Short responses finish fast enough that it's not worth the risk.

  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

// CORS preflight — allow solomonerkineh.com and localhost
app.use((req, res, next) => {
  const allowed = ['https://www.solomonerkineh.com', 'https://solomonerkineh.com', 'http://localhost:3333'];
  const origin = req.headers.origin;
  if (allowed.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Fallback — serve index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Solomon's AI Portfolio running at http://localhost:${PORT}`);
  console.log(`💬 AI Chat endpoint: POST http://localhost:${PORT}/api/chat`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('\n⚠️  WARNING: ANTHROPIC_API_KEY is not set in .env — chat will not work!');
    console.warn('   Create a .env file with: ANTHROPIC_API_KEY=sk-ant-...\n');
  } else {
    console.log('✅ Anthropic API key loaded\n');
  }
});
