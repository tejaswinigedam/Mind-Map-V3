import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('GOOGLE_API_KEY not found in backend/.env!');
  process.exit(1);
}

console.log('Testing API Key:', apiKey.substring(0, 8) + '...');

const genAI = new GoogleGenerativeAI(apiKey);

async function testModel(modelName: string) {
  try {
    console.log(`[Test] Calling model "${modelName}"...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent('Say hello in exactly 3 words.');
    console.log(`[Success] "${modelName}" response:`, result.response.text().trim());
    return true;
  } catch (error: any) {
    console.error(`[Failed] "${modelName}" failed:`, error.message || error);
    return false;
  }
}

async function run() {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-2.0-flash-exp', 'gemini-2.0-flash'];
  for (const model of models) {
    const success = await testModel(model);
    if (success) {
      console.log(`💡 Model "${model}" is fully operational!`);
    }
    console.log('---------------------------------------------');
  }
}

run();
