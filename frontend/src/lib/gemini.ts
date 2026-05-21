import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ClarifyingQuestion,
  ExtractedIntent,
  KnowledgeExpansion,
  StructurePlan,
  MindMapNode,
  MindMapEdge,
  ExplorationDepth,
  SkillIntentResult,
  SkillMapResult,
  SkillMapNode,
  SkillExpansionResult,
  SkillConversationResult,
  SkillClarificationAnswer,
} from './types';

// Next.js exposes server-side env vars directly (no dotenv needed)
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
let genAI: GoogleGenerativeAI | null = null;

if (apiKey) {
  console.log('[GeminiService] API Key detected. Using Google Gemini API.');
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn('[GeminiService] GOOGLE_API_KEY not found. Running in offline simulation mode.');
}

// Models tried in order. On quota (429) or not-found (404) we skip to the next.
// Only a hard auth failure (403/401) stops the chain early.
const MODEL_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-flash-latest',
];

async function callGeminiJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  fallbackGenerator: () => T
): Promise<T> {
  if (!genAI) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return fallbackGenerator();
  }

  for (const modelName of MODEL_CHAIN) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after 30s on ${modelName}`)), 30000)
      );

      const result = await Promise.race([model.generateContent(userPrompt), timeoutPromise]);
      const text = result.response.text();
      console.log(`[GeminiService] Success with model: ${modelName}`);
      return JSON.parse(text) as T;
    } catch (error: any) {
      const msg: string = error.message || String(error);

      // Hard stop ONLY on authentication failures
      const isAuthFailure =
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('invalid api key') ||
        msg.includes('unauthorized');

      if (isAuthFailure) {
        console.error(`[GeminiService] Auth failure — stopping chain:`, msg.slice(0, 200));
        break;
      }

      // Everything else (quota, 404, timeout, JSON parse, network) → try next model
      console.warn(`[GeminiService] Model ${modelName} skipped (${msg.slice(0, 120)}) — trying next.`);
      continue;
    }
  }

  console.warn('[GeminiService] All models exhausted or failed. Using offline fallback.');
  await new Promise(resolve => setTimeout(resolve, 800));
  return fallbackGenerator();
}

export class GeminiService {
  static async validateTopic(
    topic: string
  ): Promise<{ status: 'clear' | 'ambiguous' | 'invalid'; message: string; options?: string[] }> {
    const systemPrompt = `
      You are the Topic Validation Agent. Classify the input into exactly one of three categories:
      1. "clear": well-defined subject (e.g., "skincare", "machine learning", "quantum physics")
      2. "ambiguous": meaningful but too broad/vague to map directly (e.g., "stress", "growth")
      3. "invalid": meaningless, gibberish, or random characters

      Format: { "status": "clear"|"ambiguous"|"invalid", "message": "...", "options": ["..."] }
      options is REQUIRED only if status is "ambiguous". Provide 5-7 specific pathways.
    `;
    const userPrompt = `Input: "${topic}"`;

    return callGeminiJSON(systemPrompt, userPrompt, () => {
      const lower = topic.trim().toLowerCase();
      if (lower.length < 3) {
        return {
          status: 'invalid' as const,
          message: `Please enter a more specific topic to generate a mind map.`,
        };
      }
      return { status: 'clear' as const, message: 'Proceeding to intent clarification.' };
    });
  }

  static async generateClarifyingQuestions(
    topic: string,
    priorAnswers: { questionId: string; questionText: string; answerText: string }[]
  ): Promise<{ questions: ClarifyingQuestion[] }> {
    const systemPrompt = `
      You are the Context Clarity Agent. Ask exactly 3 adaptive, thought-provoking clarifying questions.
      Do NOT use generic templates. Questions must feel natural and conversational.
      Format: { "questions": [{ "id": "q1", "question": "...", "rationale": "...", "options": ["..."] }] }
    `;
    const userPrompt = `Topic: "${topic}"\nPrior Answers: ${JSON.stringify(priorAnswers)}\nGenerate exactly 3 clarifying questions.`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({
      questions: [
        {
          id: 'q1',
          question: `What is your primary goal for mapping out ${topic}?`,
          rationale: 'Aligns the map with your actual intent.',
          options: ['Creative brainstorming', 'Structured learning', 'Critical analysis'],
        },
        {
          id: 'q2',
          question: 'How detailed should the map be?',
          rationale: 'Determines the depth of nesting.',
          options: ['Surface overview', 'Intermediate details', 'Deep analysis'],
        },
        {
          id: 'q3',
          question: `What aspect of ${topic} should we focus on?`,
          rationale: 'Structures the primary branches.',
          options: ['Core concepts', 'Practical examples', 'Future implications'],
        },
      ],
    }));
  }

  static async extractIntent(
    topic: string,
    answers: { questionId: string; questionText: string; answerText: string }[]
  ): Promise<ExtractedIntent> {
    const systemPrompt = `
      You are the Intent Extraction Agent. Analyze topic and answers to deduce user intent.
      Respond only with JSON: { "goals": ["string"], "useCase": "string", "learningStyle": "string",
      "explorationDepth": "surface"|"intermediate"|"deep"|"strategic"|number, "expertiseLevel": "string",
      "breadthPreference": "breadth"|"specialization"|"balanced" }
    `;
    const userPrompt = `Topic: "${topic}"\nAnswers: ${JSON.stringify(answers)}`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({
      goals: [`Understand ${topic} comprehensively`],
      useCase: 'Knowledge Discovery',
      learningStyle: 'Visual & Hierarchical',
      explorationDepth: 'intermediate' as ExplorationDepth,
      expertiseLevel: 'Intermediate',
      breadthPreference: 'balanced' as const,
    }));
  }

  static async expandKnowledge(topic: string, intent: ExtractedIntent): Promise<KnowledgeExpansion> {
    const systemPrompt = `
      You are the Knowledge Expansion Agent. Uncover adjacent sub-fields, related concepts, hidden branches,
      and interdisciplinary perspectives for the topic.
      Respond only with JSON: { "missingAreas": ["string"], "relatedConcepts": ["string"],
      "hiddenBranches": ["string"], "recommendedPerspectives": ["string"] }
    `;
    const userPrompt = `Topic: "${topic}"\nIntent: ${JSON.stringify(intent)}`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({
      missingAreas: [`Historical foundations of ${topic}`, `Current industry standards`],
      relatedConcepts: [`Emerging methodologies in ${topic}`, `Advanced analytical frameworks`],
      hiddenBranches: [`Underlying assumptions`, `Unresolved paradigms`],
      recommendedPerspectives: [`Economic and environmental analysis`, `Ethical considerations`],
    }));
  }

  static async planStructure(
    topic: string,
    intent: ExtractedIntent,
    expansion: KnowledgeExpansion
  ): Promise<StructurePlan> {
    const systemPrompt = `
      You are the Structure Planning Agent. Plan clusters, hierarchy, and flow order.
      Respond only with JSON: { "clusters": [{ "name": "string", "conceptIds": ["string"] }],
      "hierarchy": [{ "parentId": "string", "childIds": ["string"] }], "flowOrder": ["string"] }
    `;
    const userPrompt = `Topic: "${topic}"\nIntent: ${JSON.stringify(intent)}\nExpansion: ${JSON.stringify(expansion)}`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({
      clusters: [{ name: 'Core Foundations', conceptIds: ['root', 'c1', 'c2'] }],
      hierarchy: [{ parentId: 'root', childIds: ['c1', 'c2'] }],
      flowOrder: ['root', 'c1', 'c2'],
    }));
  }

  static async generateMindMap(
    topic: string,
    intent: ExtractedIntent,
    architecture: unknown
  ): Promise<{ nodes: MindMapNode[]; edges: MindMapEdge[] }> {
    const systemPrompt = `
      You are the Mind Map Generation Agent. Generate nodes and edges for a React Flow mind map.
      Root node at x:0, y:0. Layer 1 nodes at x:250. Layer 2 at x:500.
      Return JSON: { "nodes": [...], "edges": [...] }
    `;
    const userPrompt = `Topic: "${topic}"\nIntent: ${JSON.stringify(intent)}\nArchitecture: ${JSON.stringify(architecture)}`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({ nodes: [], edges: [] }));
  }

  static async compressMemory(
    history: { role: 'user' | 'assistant'; content: string }[],
    currentSummary: string
  ): Promise<{ compressedSummary: string }> {
    const systemPrompt = `Summarize the conversation state. Respond with JSON: { "compressedSummary": "..." }`;
    const userPrompt = `History: ${JSON.stringify(history)}\nCurrent: "${currentSummary}"`;

    return callGeminiJSON(systemPrompt, userPrompt, () => ({
      compressedSummary: `Session in progress for "${history[0]?.content || 'topic'}".`,
    }));
  }

  // ─── Skill-based methods ───────────────────────────────────────────────────

  static async clarifyIntent(
    topic: string,
    priorAnswers?: SkillClarificationAnswer[]
  ): Promise<SkillIntentResult> {
    const systemPrompt = `
      You are IntentClarifierSkill. Analyze the topic (and any prior clarification answers) and output:
      - topic: cleaned topic string
      - intent: learning | planning | brainstorming | research | problem-solving
      - depth: basic | detailed | deep
      - clarifications: list of 1-3 questions ONLY if topic is vague/ambiguous. Empty array if clear.
      - userGoal: one-sentence description of what the user is likely trying to accomplish
      - confidence: 0.0-1.0 (use >= 0.9 when topic is specific or answers have been provided)

      Respond ONLY with valid JSON:
      { "topic": "", "intent": "", "depth": "", "clarifications": [], "userGoal": "", "confidence": 0.0 }
    `;
    const answersContext =
      priorAnswers && priorAnswers.length > 0
        ? `\nUser has already answered:\n${priorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n')}`
        : '';
    const userPrompt = `Topic: "${topic}"${answersContext}\n\nAnalyze and return the intent result JSON.`;

    return callGeminiJSON<SkillIntentResult>(systemPrompt, userPrompt, () => {
      const lower = topic.toLowerCase();
      const hasAnswers = priorAnswers && priorAnswers.length > 0;
      const wordCount = topic.trim().split(/\s+/).length;
      const isSpecific = wordCount >= 4 || hasAnswers;

      let intent: SkillIntentResult['intent'] = 'learning';
      if (lower.includes('plan') || lower.includes('roadmap')) intent = 'planning';
      else if (lower.includes('research') || lower.includes('investigate')) intent = 'research';
      else if (lower.includes('brainstorm') || lower.includes('idea')) intent = 'brainstorming';
      else if (lower.includes('problem') || lower.includes('fix')) intent = 'problem-solving';

      let depth: SkillIntentResult['depth'] = 'detailed';
      if (lower.includes('basic') || lower.includes('overview')) depth = 'basic';
      else if (lower.includes('deep') || lower.includes('advanced')) depth = 'deep';

      const clarifications: string[] = [];
      if (!isSpecific) {
        clarifications.push(
          `Are you trying to learn ${topic} concepts, create a plan, or research it deeply?`,
          `How detailed should the map be — a quick overview, or a thorough breakdown?`
        );
      }

      return {
        topic,
        intent,
        depth,
        clarifications,
        userGoal: `Learn and understand the core concepts of ${topic}`,
        confidence: isSpecific ? 0.92 : 0.72,
      };
    });
  }

  static async buildKnowledgeMap(intentResult: SkillIntentResult): Promise<SkillMapResult> {
    const { topic, intent, depth, userGoal } = intentResult;

    const depthInstructions = {
      basic: `Generate 3-4 top-level named concepts directly under the root. Leave children arrays empty.
Each branch must be a SPECIFIC named thing that belongs inside the topic — not a category label.`,
      detailed: `Generate 4-5 top-level named concepts. Each gets 2-3 child nodes one level deeper.
Children must be the specific components, mechanisms, or named sub-fields of their parent.`,
      deep: `Generate 4-5 top-level concepts. Each gets 2-3 child nodes. Each child gets 1-2 grandchild nodes.
At every level the nodes must become MORE granular and named — never more generic or abstract.`,
    };

    const systemPrompt = `
You are KnowledgeArchitectSkill. Generate a semantically precise, hierarchical mind map tree.

SEMANTIC DEPTH LAW — ENFORCED AT EVERY LEVEL:
Each child node must be a specific NAMED concept that naturally and logically lives inside its parent.

ABSOLUTELY FORBIDDEN label patterns:
  × "Advanced [X]"  × "[X] Fundamentals"  × "[X] Overview"  × "[X] Applications"
  × "Introduction to [X]"  × "Deep Dive into [X]"  × "Key [X]"  × "Modern [X]"

REQUIRED: Every label must be one of:
  ✓ A named theory, law, or model (e.g., "Hebbian Learning", "Nash Equilibrium")
  ✓ A named algorithm or technique (e.g., "Gradient Descent", "K-Fold Cross-Validation")
  ✓ A named phenomenon or mechanism (e.g., "Vanishing Gradient Problem")
  ✓ A named tool, framework, or system (e.g., "Transformer Architecture")
  ✓ A named measurement or concept (e.g., "VO2 Max", "Leucine Threshold")

Depth structure: ${depthInstructions[depth]}
User intent: ${intent}
User goal: ${userGoal}
Node IDs: numeric dot notation — "1", "1-1", "1-1-1"
Descriptions: one phrase under 10 words, factual and specific.

Respond ONLY with valid JSON:
{
  "root": "${topic}",
  "children": [{ "id": "1", "label": "Named Concept", "description": "Specific factual phrase", "children": [] }]
}
    `;
    const userPrompt = `Topic: "${topic}"\nIntent: ${intent}\nDepth: ${depth}\nGoal: ${userGoal}\n\nGenerate the mind map tree. Every label must be a specific named concept.`;

    return callGeminiJSON<SkillMapResult>(systemPrompt, userPrompt, () => ({
      root: topic,
      children: [],
    }));
  }

  static async exploreNode(
    selectedNode: string,
    parentTopic: string,
    depth: 'basic' | 'detailed' | 'deep'
  ): Promise<SkillExpansionResult> {
    const childCount = depth === 'basic' ? 3 : depth === 'detailed' ? 4 : 5;

    const systemPrompt = `
You are ExplorationSkill. Expand a selected node by generating its true, specific sub-concepts.

ABSOLUTELY FORBIDDEN:
  × "Advanced ${selectedNode}"  × "${selectedNode} Fundamentals"  × "${selectedNode} Overview"
  × Any label that is just the parent name with a generic adjective or suffix

REQUIRED: Each label must be a SPECIFIC NAMED thing:
  ✓ Named algorithm, theory, law, or model
  ✓ Named biological mechanism, chemical process, or physical phenomenon
  ✓ Named tool, dataset, architecture, or system
  ✓ Named metric, threshold, or measurement

Generate exactly ${childCount} children for: "${selectedNode}" (within "${parentTopic}")
Node IDs: use "exp-1", "exp-2", etc.

Respond ONLY with valid JSON:
{ "newChildren": [{ "id": "exp-1", "label": "Specific Named Concept", "description": "Factual sub-phrase", "children": [] }] }
    `;
    const userPrompt = `Selected Node: "${selectedNode}"\nParent Topic: "${parentTopic}"\nDepth: ${depth}\n\nGenerate ${childCount} specific named child concepts.`;

    return callGeminiJSON<SkillExpansionResult>(systemPrompt, userPrompt, () => ({
      newChildren: [],
    }));
  }

  static async answerNodeQuestion(
    selectedNode: string,
    parentTopic: string,
    question: string,
    branchContext?: string
  ): Promise<SkillConversationResult> {
    const systemPrompt = `
      You are NodeConversationSkill. Answer questions about specific nodes in context of their parent topic.
      Be concise but informative (2-4 sentences). Stay grounded to the node and its context.
      You are answering about node: "${selectedNode}" in topic: "${parentTopic}"
      ${branchContext ? `Branch context: ${branchContext}` : ''}
      Respond ONLY with valid JSON: { "answer": "Your answer here." }
    `;
    const userPrompt = `Question: "${question}"`;

    return callGeminiJSON<SkillConversationResult>(systemPrompt, userPrompt, () => ({
      answer: `${selectedNode} is a key concept within ${parentTopic}. Understanding it helps build a complete picture of the topic and its practical connections.`,
    }));
  }
}
