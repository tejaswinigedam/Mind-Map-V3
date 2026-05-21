import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SkillOrchestrator } from './skills/SkillOrchestrator';
import { OrchestratorState } from './orchestrator/types';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const activeSessions = new Map<WebSocket, SkillOrchestrator>();

wss.on('connection', (ws: WebSocket) => {
  console.log('[WebSocket] Client connected.');

  const send = (type: string, data: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  };

  ws.on('message', async (raw: string) => {
    try {
      const event = JSON.parse(raw);
      console.log(`[WebSocket] Event: ${event.type}`);

      switch (event.type) {

        case 'START_WORKFLOW': {
          const { topic } = event;
          if (!topic) { send('ERROR', { message: 'Topic is required.' }); return; }

          console.log(`[SkillOrchestrator] Starting skill workflow for: "${topic}"`);
          const orchestrator = new SkillOrchestrator(topic, (state: OrchestratorState) => {
            send('STATE_UPDATE', { state });
          });
          activeSessions.set(ws, orchestrator);
          await orchestrator.startWorkflow();
          break;
        }

        case 'SUBMIT_ANSWERS': {
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) { send('ERROR', { message: 'No active session.' }); return; }
          await orchestrator.submitAnswers(event.answers);
          break;
        }

        case 'EXPAND_NODE': {
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) { send('ERROR', { message: 'No active session.' }); return; }

          const { nodeId, nodeLabel, parentTopic, depth } = event;
          if (!nodeId || !nodeLabel || !parentTopic) {
            send('ERROR', { message: 'EXPAND_NODE requires nodeId, nodeLabel, and parentTopic.' });
            return;
          }
          const safeDepth: 'basic' | 'detailed' | 'deep' = depth || 'detailed';
          await orchestrator.expandNode(nodeId, nodeLabel, parentTopic, safeDepth);
          break;
        }

        case 'ASK_NODE_QUESTION': {
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) { send('ERROR', { message: 'No active session.' }); return; }

          const { nodeId, nodeLabel, parentTopic, question } = event;
          if (!nodeId || !nodeLabel || !parentTopic || !question) {
            send('ERROR', { message: 'ASK_NODE_QUESTION requires nodeId, nodeLabel, parentTopic, and question.' });
            return;
          }
          const result = await orchestrator.answerNodeQuestion(nodeId, nodeLabel, parentTopic, question);
          send('NODE_ANSWER', result);
          break;
        }

        case 'REFINE_MAP': {
          // Legacy: treat refinement as a node expansion on the root topic
          const orchestrator = activeSessions.get(ws);
          if (!orchestrator) { send('ERROR', { message: 'No active session.' }); return; }
          const state = orchestrator.getState();
          const topic = state.memory.originalInput;
          const depth = (state.memory.skillIntentResult?.depth) ?? 'detailed';
          await orchestrator.expandNode('root', topic, topic, depth);
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          send('ERROR', { message: `Unknown event type: ${event.type}` });
      }
    } catch (err: any) {
      console.error('[WebSocket] Error:', err);
      send('ERROR', { message: `Internal error: ${err.message}` });
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected.');
    activeSessions.delete(ws);
  });
});

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

export { httpServer };
