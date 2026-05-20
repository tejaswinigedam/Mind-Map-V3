import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from './orchestrator/Orchestrator';
import { ClarifyingAnswer, OrchestratorState } from './orchestrator/types';

const app = express();
app.use(cors());
app.use(express.json());

// Healthy probe endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Map to track active sessions
const activeSessions = new Map<WebSocket, Orchestrator>();

wss.on('connection', (ws: WebSocket) => {
  console.log('[WebSocket] Client connected.');

  const sendEvent = (type: string, data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  };

  ws.on('message', async (message: string) => {
    try {
      const event = JSON.parse(message);
      console.log(`[WebSocket] Received event: ${event.type}`);

      switch (event.type) {
        case 'START_WORKFLOW': {
          const { topic } = event;
          if (!topic) {
            sendEvent('ERROR', { message: 'Topic is required to start workflow.' });
            return;
          }

          console.log(`[WebSocket] Starting agentic workflow for topic: "${topic}"`);
          
          // Instantiate a fresh Orchestrator for this WebSocket client
          const orchestrator = new Orchestrator(topic, (state: OrchestratorState) => {
            // Broadcast state updates to the user in real-time
            sendEvent('STATE_UPDATE', { state });
          });

          activeSessions.set(ws, orchestrator);

          // Launch the background execution
          await orchestrator.startWorkflow();
          break;
        }

        case 'SUBMIT_ANSWERS': {
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) {
            sendEvent('ERROR', { message: 'No active session found. Please start a workflow first.' });
            return;
          }

          const answers = event.answers as ClarifyingAnswer[];
          console.log('[WebSocket] User submitted clarifying answers. Resuming pipeline.');
          
          await orchestrator.submitClarifyingAnswers(answers);
          break;
        }

        case 'REFINE_MAP': {
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) {
            sendEvent('ERROR', { message: 'No active session found.' });
            return;
          }

          const { prompt } = event;
          console.log(`[WebSocket] User requested node refinement: "${prompt}"`);

          await orchestrator.refineMindMap(prompt);
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          console.warn(`[WebSocket] Unknown event type: ${event.type}`);
          sendEvent('ERROR', { message: `Unknown event type: ${event.type}` });
      }
    } catch (err: any) {
      console.error('[WebSocket] Error handling message:', err);
      sendEvent('ERROR', { message: `Internal server error: ${err.message}` });
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected.');
    activeSessions.delete(ws);
  });
});

// Upgrade HTTP connection to WebSockets
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

export { httpServer };
