import dotenv from 'dotenv';
dotenv.config();

import { httpServer } from './server';

const PORT = process.env.PORT || 3003;

httpServer.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` AGENTIC MIND MAPPING BACKEND IS LIVE `);
  console.log(` Port: ${PORT} `);
  console.log(` WebSocket URL: ws://localhost:${PORT} `);
  console.log(` HTTP Health check: http://localhost:${PORT}/api/health `);
  console.log(`==================================================`);
});
