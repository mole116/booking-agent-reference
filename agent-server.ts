import express, { Request, Response } from 'express';
import { API_BASE_URL, runAgent } from './agent.js';
import { serverLog } from './logger.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/agent', async (req: Request, res: Response) => {
  const { message, history, sessionId } = req.body as {
    message?: unknown;
    history?: unknown;
    sessionId?: unknown;
  };

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const sid = typeof sessionId === 'string' ? sessionId : 'unknown';
  const hist = Array.isArray(history) ? history : [];

  serverLog.request('POST', '/agent', { sessionId: sid, messagePreview: message.slice(0, 80) });

  try {
    const result = await runAgent(message.trim(), hist, sid, {
      // Report which tool is executing so the UI can show a live status label.
      // Best-effort: a failed progress ping must never fail the turn.
      onToolStart: (toolName) => {
        void fetch(`${API_BASE_URL}/agent-activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, tool: toolName }),
        }).catch(() => {});
      },
    });
    serverLog.response('POST', '/agent', 200, {
      sessionId: sid,
      bookingChanged: result.bookingChanged,
      ui: result.ui,
    });
    return res.json(result);
  } catch (err) {
    serverLog.error('/agent', err);
    return res.status(500).json({ error: 'Agent execution failed.' });
  }
});

// Health check so the main server can probe availability
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.AGENT_PORT || 3001;

app.listen(PORT, () => {
  console.log(`🤖 Agent service running on http://localhost:${PORT}`);
});
