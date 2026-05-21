import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import {
  ClarifyingQuestion,
  ExtractedIntent,
  SemanticArchitecture,
  KnowledgeExpansion,
  StructurePlan,
  MindMapNode,
  MindMapEdge,
  SharedMemory,
  ExplorationDepth
} from '../orchestrator/types';
import {
  SkillIntentResult,
  SkillMapResult,
  SkillMapNode,
  SkillExpansionResult,
  SkillConversationResult,
  SkillClarificationAnswer
} from '../skills/types';

dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
let genAI: GoogleGenerativeAI | null = null;

if (apiKey) {
  console.log('[GeminiService] API Key detected. Using Google Gemini API.');
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn('[GeminiService] GOOGLE_API_KEY / GEMINI_API_KEY not found in environment. Booting in Agent Simulation Mode.');
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

/**
 * Helper to call Gemini model with system prompt and JSON expectation.
 * Walks MODEL_CHAIN on quota/not-found errors so exhausted or missing
 * models don't immediately fall back to empty stubs.
 */
async function callGeminiJSON<T>(systemPrompt: string, userPrompt: string, fallbackGenerator: () => T): Promise<T> {
  if (!genAI) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return fallbackGenerator();
  }

  for (const modelName of MODEL_CHAIN) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
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

      // Hard stop ONLY on authentication failures — no point trying other models
      const isAuthFailure =
        msg.includes('401') || msg.includes('403') ||
        msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') ||
        msg.includes('invalid api key') || msg.includes('unauthorized');

      if (isAuthFailure) {
        console.error(`[GeminiService] Auth failure — stopping chain:`, msg.slice(0, 200));
        break;
      }

      // Everything else (quota, 404, timeout, JSON parse error, network error) → try next model
      console.warn(`[GeminiService] Model ${modelName} skipped (${msg.slice(0, 120)}) — trying next.`);
      continue;
    }
  }

  console.warn('[GeminiService] All models exhausted or failed. Using offline fallback.');
  await new Promise(resolve => setTimeout(resolve, 800));
  return fallbackGenerator();
}

export class GeminiService {
  /**
   * Topic Validation Agent: Evaluates the semantic clarity and confidence of the input topic.
   * Classifies inputs into:
   * 1. 'clear' (proceed with generation normally)
   * 2. 'ambiguous' (vague but meaningful, ask clarifying questions to narrow down)
   * 3. 'invalid' (extremely vague/meaningless, politely prompt for better input)
   */
  static async validateTopic(
    topic: string
  ): Promise<{ status: 'clear' | 'ambiguous' | 'invalid'; message: string; options?: string[] }> {
    
    const systemPrompt = `
      You are the Topic Validation Agent. Your job is to analyze the user's input topic or query and evaluate its semantic clarity and confidence.
      Classify the input into exactly one of three categories:
      
      1. "clear": The topic represents a well-defined subject, concept, problem, or goal (e.g., "skincare", "machine learning", "quantum physics", "cooking sourdough", "running a marathon").
      
      2. "ambiguous": The input has meaningful semantic content, but it is too broad, highly vague, or contextually ambiguous to map out directly without help (e.g., "gets tired", "stress", "confidence", "growth", "diet", "books"). For these, you must provide 5-7 tailored pathway options to help the user specify what they want to explore.
      
      3. "invalid": The input is meaningless, extremely vague, random characters, or gibberish (e.g., "abc", "XYZ", "nothing", "asdfasdf", "hello").
      
      Format your response as a strict JSON object conforming to:
      {
        "status": "clear" | "ambiguous" | "invalid",
        "message": "A polite, encouraging, and collaborative guiding explanation for the user, especially if status is ambiguous or invalid.",
        "options": ["Option 1", "Option 2", ...] // REQUIRED ONLY if status is "ambiguous". Provide 5-7 highly specific, creative pathways.
      }
    `;

    const userPrompt = `Input: "${topic}"`;

    return callGeminiJSON<{ status: 'clear' | 'ambiguous' | 'invalid'; message: string; options?: string[] }>(
      systemPrompt, 
      userPrompt, 
      () => {
        // Robust Offline Fallback Validator
        const lower = topic.trim().toLowerCase();
        
        // Gibberish / Too Short / Extremely vague
        if (lower.length < 3 || (/^[a-z0-9\s!@#$%^&*()_+=-]+$/i.test(lower) && (lower === 'xyz' || lower === 'abc' || lower === 'nothing' || lower === 'hello' || lower === 'asdf' || lower === 'asd' || lower === 'qwer' || lower === 'stuff' || lower === 'things' || lower === 'random'))) {
          return {
            status: 'invalid',
            message: `I’m not fully sure what topic you'd like to build a mind map around yet.\n\nTry entering:\n• a topic (e.g., "skincare" or "artificial intelligence")\n• a goal (e.g., "learn to paint with oils")\n• a problem (e.g., "mitigating server latency bottlenecks")\n• a question or something you want to brainstorm.`
          };
        }

        // Check for ambiguous single words or highly general phrases
        const ambiguousWords = [
          'tired', 'gets tired', 'fatigue', 'exhausted',
          'stress', 'stressed', 'burnout',
          'growth', 'grow', 'success', 'confidence',
          'diet', 'eating', 'food', 'cooking',
          'books', 'reading', 'music', 'art', 'sleep', 'learning'
        ];

        const isExactAmbiguous = ambiguousWords.some(w => lower === w || lower === `${w}s` || lower.includes(`getting ${w}`) || lower === `gets ${w}`);
        const isVeryShortWord = lower.split(/\s+/).length === 1 && lower.length <= 8;

        if (isExactAmbiguous || (isVeryShortWord && !['skincare', 'coding', 'physics', 'math', 'ai', 'rust', 'react'].includes(lower))) {
          // Generate tailored options based on keywords
          let options = [
            'General overview and history',
            'Practical real-world tools and systems',
            'Advanced conceptual deep-dive',
            'Common challenges & strategic solutions',
            'Future trends and societal impact'
          ];

          let message = `Could you clarify what you'd like to explore about "${topic}"?`;

          if (lower.includes('tired') || lower.includes('fatigue') || lower.includes('exhaust')) {
            message = `Could you clarify what you'd like to explore about "getting tired"?`;
            options = [
              'Physical Fatigue & Muscle Recovery',
              'Mental Exhaustion & Cognitive Overload',
              'Sleep Quality & Circadian Rhythms',
              'Burnout & Workplace Stress Management',
              'Nutritional Factors & Energy Production',
              'Fitness, Endurance & Cardiovascular Capacity'
            ];
          } else if (lower.includes('stress') || lower.includes('burnout')) {
            message = `Could you clarify what you'd like to explore about "stress"?`;
            options = [
              'Psychological Triggers & Stress Responses',
              'Somatic & Physical Relaxation Techniques',
              'Workplace Burnout & Boundary Setting',
              'Time Management & Cognitive Reframing',
              'Micro-habits for Stress Resilience'
            ];
          } else if (lower.includes('growth') || lower.includes('success')) {
            message = `Could you clarify what aspect of "growth" you want to explore?`;
            options = [
              'Personal Growth & Behavioral Habits',
              'Business, Startup Scaling & Marketing Strategy',
              'Career Progression & Professional Development',
              'Economic Growth Theory & Market Dynamics',
              'Mental Growth, Resilience & Mindset'
            ];
          } else if (lower.includes('diet') || lower.includes('food') || lower.includes('eat')) {
            message = `Could you clarify what aspect of "diet" or "nutrition" you want to map out?`;
            options = [
              'Nutritional Foundations for Growing Kids',
              'Meal Planning and Batch Cooking Strategies',
              'Ketogenic, Vegan or Specialized Lifestyles',
              'Behavioral Habits & Selective/Picky Eating',
              'Weight Management & Metabolic Wellness'
            ];
          } else if (lower.includes('confidence') || lower.includes('esteem')) {
            message = `Could you clarify what you'd like to explore about "confidence"?`;
            options = [
              'Public Speaking & Communication Presence',
              'Social Self-Esteem & Overcoming Anxiety',
              'Imposter Syndrome & Professional Confidence',
              'Childhood Development & Self-Belief Habits',
              'Cognitive Behavioral Reframing Techniques'
            ];
          }

          return {
            status: 'ambiguous',
            message,
            options
          };
        }

        // Default to clear topic if it's longer or doesn't fit ambiguous criteria
        return {
          status: 'clear',
          message: 'The topic has high semantic confidence. Proceeding to clarification.'
        };
      }
    );
  }

  /**
   * Clarity Agent: Generate 3 context-aware clarifying questions based on input topic and answers
   */
  static async generateClarifyingQuestions(
    topic: string, 
    priorAnswers: { questionId: string; questionText: string; answerText: string }[]
  ): Promise<{ questions: ClarifyingQuestion[] }> {
    
    const systemPrompt = `
      You are the Context Clarity Agent. Your job is to analyze the user's ambiguous input topic/goal and ask exactly 3 adaptive, thought-provoking, and depth-appropriate clarifying questions.
      Identify missing context, detect ambiguity, and dynamically adjust questions based on prior answers.
      Do NOT use generic or static templates. Analyze what makes this specific topic complex.
      
      IMPORTANT UX + CONTEXT ALIGNMENT RULE:
      - Questions must feel natural, conversational, and use user-friendly language.
      - NEVER use terms like: pipeline, architecture, paradigms, strategic systems analysis, execution parameters, branching depth, cognitive complexity, ontology, orchestration runtime.
      - Act as a thoughtful tutor or brainstorming partner, NOT a workflow engine.
      - e.g., instead of "What is your technical background?", ask "How familiar are you with this topic?". Instead of "How many levels of branching?", ask "How detailed would you like your mind map to be?".

      Format your response as a JSON object containing:
      {
        "questions": [
          {
            "id": "q1",
            "question": "Question text...",
            "rationale": "Why this specific question helps build a better mind map...",
            "options": ["Option A", "Option B", "Option C"]
          }
        ]
      }
    `;

    const userPrompt = `
      Topic: "${topic}"
      Prior Answers given by user so far: ${JSON.stringify(priorAnswers)}
      
      Generate exactly 3 high-quality clarifying questions to tailor the brainstorming map.
    `;

    return callGeminiJSON<{ questions: ClarifyingQuestion[] }>(systemPrompt, userPrompt, () => {
      // Dynamic simulated questions based on topic keywords
      const t = topic.toLowerCase();
      const options = {
        tech: {
          q1: `How familiar are you with ${topic}?`,
          r1: 'Tailors node complexity and avoids explaining basic terminology.',
          o1: ['Beginner (needs simple overviews)', 'Intermediate (wants practical application)', 'Advanced (wants deep technical nuances)'],
          q2: 'How detailed would you like your mind map to be?',
          r2: 'Determines the exact level of child-node nesting (1 to 5 levels) on the canvas.',
          o2: [
            'Surface overview (Quick summary)',
            'Intermediate details',
            'Detailed structure',
            'In-depth analysis',
            'Extremely detailed (As deep as possible)'
          ],
          q3: `Which aspect of ${topic} should we prioritize?`,
          r3: "Structures the primary branches to match the user's specific sub-domain interest.",
          o3: ['Core concepts & technical foundation', 'Real-world applications & tools', 'Challenges, risks & tradeoffs']
        },
        generic: {
          q1: `What is your primary goal for mapping out ${topic}?`,
          r1: 'Aligns downstream agents with either brainstorming breadth or tactical depth.',
          o1: ['Creative brainstorming', 'Structured learning', 'Critical analysis & strategy'],
          q2: 'How detailed would you like your mind map to be?',
          r2: 'Determines the exact level of child-node nesting (1 to 5 levels) on the canvas.',
          o2: [
            'Surface overview (Quick summary)',
            'Intermediate details',
            'Detailed structure',
            'In-depth analysis',
            'Extremely detailed (As deep as possible)'
          ],
          q3: `What is your focus area within ${topic}?`,
          r3: 'Allows the Knowledge Expansion Agent to bypass irrelevant areas.',
          o3: ['General concepts', 'Detailed practical examples', 'Future implications & philosophy']
        }
      };

      const isTech = t.includes('ai') || t.includes('intelligence') || t.includes('code') || t.includes('react') || t.includes('system') || t.includes('software') || t.includes('web') || t.includes('data') || t.includes('llm') || t.includes('agent');
      const selection = isTech ? options.tech : options.generic;

      return {
        questions: [
          { id: 'q1', question: selection.q1, rationale: selection.r1, options: selection.o1 },
          { id: 'q2', question: selection.q2, rationale: selection.r2, options: selection.o2 },
          { id: 'q3', question: selection.q3, rationale: selection.r3, options: selection.o3 }
        ]
      };
    });
  }

  /**
   * Intent Extraction Agent: Formulate depth, usecase, expertise based on topic and clarifying answers
   */
  static async extractIntent(
    topic: string, 
    answers: { questionId: string; questionText: string; answerText: string }[]
  ): Promise<ExtractedIntent> {

    const systemPrompt = `
      You are the Intent Extraction Agent. Analyze the user's topic and answers to clarifying questions.
      You must deduce the exact cognitive intent of the user.
      Determine:
      1. goals: string array of user objectives.
      2. useCase: string describing the scenario (e.g. project blueprint, learning syllabus, thesis outline).
      3. learningStyle: string (e.g., visual-logical, systemic, step-by-step).
      4. explorationDepth: 'surface' | 'intermediate' | 'deep' | 'strategic' | number. If the user specifies an exact level or number of branching levels (e.g. Level 1 to 5), use that number (1, 2, 3, 4, or 5).
      5. expertiseLevel: string description of user expertise.
      6. breadthPreference: 'breadth' | 'specialization' | 'balanced'.
      
      Respond only with JSON conforming to this object:
      {
        "goals": ["string"],
        "useCase": "string",
        "learningStyle": "string",
        "explorationDepth": "surface" | "intermediate" | "deep" | "strategic" | number,
        "expertiseLevel": "string",
        "breadthPreference": "breadth" | "specialization" | "balanced"
      }
    `;

    const userPrompt = `
      Topic: "${topic}"
      Clarifying answers: ${JSON.stringify(answers)}
      
      Analyze and output the detailed extraction of intent.
    `;

    return callGeminiJSON<ExtractedIntent>(systemPrompt, userPrompt, () => {
      // Simulate intent extraction based on user answers
      let depth: ExplorationDepth = 'intermediate';
      let breadth: 'breadth' | 'specialization' | 'balanced' = 'balanced';
      let expertise = 'Intermediate';

      const a1 = answers.find(a => a.questionId === 'q1')?.answerText || '';
      const a2 = answers.find(a => a.questionId === 'q2')?.answerText || '';
      const a3 = answers.find(a => a.questionId === 'q3')?.answerText || '';

      if (a1.includes('Advanced') || a1.includes('Deep')) {
        expertise = 'Advanced / Professional';
      } else if (a1.includes('Beginner') || a1.includes('Surface')) {
        expertise = 'Beginner / Novel';
      }

      // Parse numeric level from answer if present (e.g., "Level 5")
      const levelMatch = a2.match(/Level\s*(\d+)/i);
      if (levelMatch) {
        depth = parseInt(levelMatch[1], 10);
      } else if (a2.includes('Surface') || a2.includes('1')) {
        depth = 1;
      } else if (a2.includes('Intermediate') || a2.includes('2')) {
        depth = 2;
      } else if (a2.includes('Deep') || a2.includes('Academic') || a2.includes('Systems') || a2.includes('5')) {
        depth = 5;
      } else if (a2.includes('Strategic')) {
        depth = 5;
      }

      if (a3.includes('Architecture') || a3.includes('Specialization')) {
        breadth = 'specialization';
      } else if (a3.includes('Applications') || a3.includes('Breadth')) {
        breadth = 'breadth';
      }

      return {
        goals: [
          `Formulate a comprehensive cognitive model of ${topic}`,
          `Explore custom domains related to ${a3 || 'general aspects'}`
        ],
        useCase: a2.includes('Practical') || a2.includes('Level 4') || a2.includes('Level 5') ? 'System Architecture & Implementation Plan' : 'Knowledge Discovery & Conceptual Synthesis',
        learningStyle: (depth as any) === 'strategic' || (typeof depth === 'number' && depth >= 4) ? 'Systemic & Analytical' : 'Visual & Hierarchical',
        explorationDepth: depth,
        expertiseLevel: expertise,
        breadthPreference: breadth
      };
    });
  }

  /**
   * Knowledge Expansion Agent: Expand missing areas, hidden branches, related concepts
   */
  static async expandKnowledge(
    topic: string, 
    intent: ExtractedIntent
  ): Promise<KnowledgeExpansion> {

    const systemPrompt = `
      You are the Knowledge Expansion Agent. Your job is to expand the boundaries of the topic "${topic}" based on the user's intent.
      Uncover:
      - missingAreas: adjacent sub-fields the user might have forgotten.
      - relatedConcepts: modern high-value topics relevant to their expertise level.
      - hiddenBranches: deep concepts, controversial debates, or underlying assumptions.
      - recommendedPerspectives: interdisciplinary angles (e.g. ethical, socio-economic, historical, system constraints).
      
      Match the depth level: ${intent.explorationDepth}.
      
      Respond only with JSON:
      {
        "missingAreas": ["string"],
        "relatedConcepts": ["string"],
        "hiddenBranches": ["string"],
        "recommendedPerspectives": ["string"]
      }
    `;

    const userPrompt = `
      Topic: "${topic}"
      Intent: ${JSON.stringify(intent)}
      
      Perform deep, structured knowledge expansion.
    `;

    return callGeminiJSON<KnowledgeExpansion>(systemPrompt, userPrompt, () => {
      // Simulate knowledge expansion based on topic and depth
      const d = intent.explorationDepth;
      if (topic.toLowerCase().includes('ai') || topic.toLowerCase().includes('artificial') || topic.toLowerCase().includes('llm')) {
        return {
          missingAreas: [
            d === 'surface' ? 'AI applications in daily life' : 'Neuro-symbolic AI & Hybrid Systems',
            d === 'surface' ? 'Ethics and safety basics' : 'Neural Scaling Laws & Hardware Bottlenecks'
          ],
          relatedConcepts: [
            'Agentic Orchestration Frameworks',
            d === 'strategic' ? 'Socio-economic impact & AGI timelines' : 'Retrieval-Augmented Generation (RAG)'
          ],
          hiddenBranches: [
            d === 'strategic' ? 'RLHF vs Constitutional AI & alignment challenges' : 'Black-box neural network interpretability',
            'Compute-optimal training parameters (Chinchilla scaling)'
          ],
          recommendedPerspectives: [
            'Hardware constraints (HBM & GPU scaling)',
            'Safety & alignment (Superalignment & Red Teaming)'
          ]
        };
      }

      // Generic topic simulation
      return {
        missingAreas: [
          `Historical foundations of ${topic}`,
          `Current industry standards and ecosystems`
        ],
        relatedConcepts: [
          `Emerging methodologies in ${topic}`,
          `Advanced analytical frameworks`
        ],
        hiddenBranches: [
          `Underlying ontological assumptions`,
          `Unresolved paradigms and conflicting theories`
        ],
        recommendedPerspectives: [
          `Economic and environmental cost analysis`,
          `Ethical, legal, and human factor considerations`
        ]
      };
    });
  }

  /**
   * Structure Planning Agent: Form clusters, hierarchy parent-child flow
   */
  static async planStructure(
    topic: string,
    intent: ExtractedIntent,
    expansion: KnowledgeExpansion
  ): Promise<StructurePlan> {

    const systemPrompt = `
      You are the Structure Planning Agent. Your job is to structure the mental schema of the mind map.
      Organize the nodes, construct parents and child relations, and plan cluster groups.
      Output:
      1. clusters: grouping of related conceptIds (conceptual clusters).
      2. hierarchy: parent-child mapping of nodes.
      3. flowOrder: an array of concept IDs ordered by how a human should learn them (cognitive flow).
      
      Respond only with JSON:
      {
        "clusters": [
          { "name": "Cluster Name", "conceptIds": ["id1", "id2"] }
        ],
        "hierarchy": [
          { "parentId": "parent_id", "childIds": ["child1", "child2"] }
        ],
        "flowOrder": ["id1", "id2", "id3"]
      }
    `;

    const userPrompt = `
      Topic: "${topic}"
      Intent: ${JSON.stringify(intent)}
      Expanded Knowledge: ${JSON.stringify(expansion)}
      
      Plan a structured learning/brainstorming hierarchy.
    `;

    return callGeminiJSON<StructurePlan>(systemPrompt, userPrompt, () => {
      // Create a deterministic simulated structure plan
      return {
        clusters: [
          { name: 'Core Foundations', conceptIds: ['root', 'c1', 'c2'] },
          { name: 'Advanced Methodologies', conceptIds: ['c3', 'c4'] },
          { name: 'Implications & Future', conceptIds: ['c5', 'c6'] }
        ],
        hierarchy: [
          { parentId: 'root', childIds: ['c1', 'c2'] },
          { parentId: 'c1', childIds: ['c3', 'c4'] },
          { parentId: 'c2', childIds: ['c5', 'c6'] }
        ],
        flowOrder: ['root', 'c1', 'c3', 'c4', 'c2', 'c5', 'c6']
      };
    });
  }

  /**
   * Mind Map Generation Agent: Generates Nodes & Edges based on structured context and depth
   */
  static async generateMindMap(
    topic: string,
    intent: ExtractedIntent,
    architecture: SemanticArchitecture
  ): Promise<{ nodes: MindMapNode[]; edges: MindMapEdge[] }> {

    const systemPrompt = `
      You are the Mind Map Generation Agent.
      Generate an interactive, hierarchical graph with nodes and edges.
      The nodes must be arranged in a neat tree-like layout.
      
      Rules for Node placement (coordinates must follow a tidy tree layout):
      - Root node at x: 0, y: 0
      - Layer 1 nodes spread vertically or horizontally (e.g., x: 250, y: -1200, -150, 150, 450)
      - Layer 2 nodes spread further (e.g., x: 500, y: ...)
      
      Rules for content depending on DEPTH (${intent.explorationDepth}):
      - LOW DEPTH (surface): 5-8 nodes max, beginner friendly, simple layout.
      - HIGH DEPTH (deep/strategic): 12-20 nodes, technical/advanced concepts.
      
      CRITICAL DYNAMIC EXPANSION RULES (ESPECIALLY FOR DEEPER BRANCHES - LEVELS 4 & 5):
      - Deeper branches must become MORE concrete, domain-specific, useful, and granular. They should NOT become more abstract.
      - Avoid recursive analytical templates such as appending generic suffixes or concepts (e.g., "applications", "mechanisms", "tradeoffs", "implications", "constraints") unless natively central to the domain.
      - When expanding a node, ask: "What meaningful subtopics naturally belong under this concept in human understanding?" NOT "What generic analytical framework can be recursively applied here?"
      - Every child node MUST feel like a natural subdivision of its parent node. If the relationship feels artificial, recursive, or framework-generated, do not create the branch.

      Node schema:
      {
        "id": "unique_string",
        "type": "custom", // or default
        "data": {
          "label": "Brief Node Name",
          "description": "Short, clear subtitle explaining the concept",
          "depth": number (0 for root, 1, 2, 3),
          "details": "Highly detailed multi-sentence description for right-side drawer inspection",
          "importance": "high" | "medium" | "low",
          "tradeoff": "Optional tradeoff, debate, or contradiction related to this node"
        },
        "position": { "x": number, "y": number }
      }

      Edge schema:
      {
        "id": "e_source_target",
        "source": "source_id",
        "target": "target_id",
        "animated": boolean (set true for active flow paths),
        "label": "Optional connection verb (e.g., 'leads to', 'implements', 'debates')"
      }

      Return a single JSON:
      {
        "nodes": [...],
        "edges": [...]
      }
    `;

    const userPrompt = `
      Topic: "${topic}"
      Intent: ${JSON.stringify(intent)}
      Architecture: ${JSON.stringify(architecture)}

      Generate a detailed, beautifully arranged mind map in React Flow format.
    `;

    return callGeminiJSON<{ nodes: MindMapNode[]; edges: MindMapEdge[] }>(systemPrompt, userPrompt, () => {
      return { nodes: [], edges: [] };
    });
  }



  /**
   * Memory/Compression Agent: Compress history
   */
  static async compressMemory(
    history: { role: 'user' | 'assistant'; content: string }[],
    currentSummary: string
  ): Promise<{ compressedSummary: string }> {

    const systemPrompt = `
      You are the Memory/Compression Agent. Your job is to summarize and compress the active conversational state.
      Create a highly dense, bullet-point summary of what the user wants, what is agreed upon, their expertise, preferred style, and key constraints.
      
      Respond only with JSON:
      {
        "compressedSummary": "Your compressed summary text here..."
      }
    `;

    const userPrompt = `
      History: ${JSON.stringify(history)}
      Current Summary: "${currentSummary}"
      
      Compress and update the shared cognitive memory.
    `;

    return callGeminiJSON<{ compressedSummary: string }>(systemPrompt, userPrompt, () => {
      return {
        compressedSummary: `Session initialized for topic "${history[0]?.content || 'Brainstorming'}" with focus on structured reasoning. User is exploring at an expert-level systems perspective. Key priorities: architectural trade-offs, alignment paradigms, and compute constraints. System running in live multi-agent orchestration mode.`
      };
    });
  }

  /**
   * Refinement Agent: Validate semantic coherence and prune repetitive structures
   */
  static async refineMindMap(
    topic: string,
    architecture: SemanticArchitecture,
    mindMap: { nodes: MindMapNode[]; edges: MindMapEdge[] }
  ): Promise<{ nodes: MindMapNode[]; edges: MindMapEdge[] }> {
    
    // In a real API call, we would ask Gemini to analyze the nodes and prune bad ones.
    // For this simulation, we'll implement a basic programmatic semantic coherence check.
    
    // Filter out generic bad words
    const badWords = ['Tradeoffs', 'Mechanisms', 'Paradigms', 'Implications', 'Frameworks'];
    
    const refinedNodes = mindMap.nodes.filter(node => {
      // If it's a deep node and contains a generic framework word, prune it
      if (node.data.depth && node.data.depth >= 2) {
        if (badWords.some(bw => node.data.label.includes(bw))) {
          return false;
        }
      }
      return true;
    });

    const validNodeIds = new Set(refinedNodes.map(n => n.id));
    const refinedEdges = mindMap.edges.filter(edge => validNodeIds.has(edge.source) && validNodeIds.has(edge.target));

    return {
      nodes: refinedNodes,
      edges: refinedEdges
    };
  }

  // =========================================================
  // SKILL-BASED METHODS (4 modular AI skills)
  // =========================================================

  /**
   * IntentClarifierSkill: Determine user intent, depth, and clarifications needed.
   */
  static async clarifyIntent(
    topic: string,
    priorAnswers?: SkillClarificationAnswer[]
  ): Promise<SkillIntentResult> {
    const systemPrompt = `
      You are IntentClarifierSkill. Your job is to understand what the user is actually trying to do
      before a mind map is generated.

      Analyze the topic (and any prior clarification answers) and output:
      - topic: the cleaned topic string
      - intent: one of learning | planning | brainstorming | research | problem-solving
      - depth: one of basic | detailed | deep
      - clarifications: list of questions to ask the user ONLY if the topic is vague or ambiguous.
        Ask 1-3 focused questions. If the topic is clear and specific, return an empty array.
        Conversational, natural language. Never ask unnecessary questions.
      - userGoal: a one-sentence description of what the user is likely trying to accomplish
      - confidence: 0.0-1.0 how confident you are about intent and depth
        Use confidence >= 0.9 when the topic is specific or answers have been provided.

      Possible intents:
        - learning: understand concepts, education, overview
        - planning: create a plan, organize tasks, project setup
        - brainstorming: generate ideas, explore possibilities
        - research: deep investigation, academic, evidence-based
        - problem-solving: solve a specific problem, debug, improve

      Possible depth levels:
        - basic: quick overview, 2 levels max
        - detailed: layered hierarchy, 3 levels
        - deep: recursive, comprehensive, 4+ levels

      If prior answers are provided, use them to improve confidence and avoid repeating questions.

      Respond ONLY with valid JSON:
      {
        "topic": "",
        "intent": "",
        "depth": "",
        "clarifications": [],
        "userGoal": "",
        "confidence": 0.0
      }
    `;

    const answersContext = priorAnswers && priorAnswers.length > 0
      ? `\nUser has already answered:\n${priorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n')}`
      : '';

    const userPrompt = `Topic: "${topic}"${answersContext}\n\nAnalyze and return the intent result JSON.`;

    return callGeminiJSON<SkillIntentResult>(systemPrompt, userPrompt, () => {
      const lower = topic.toLowerCase();
      const hasAnswers = priorAnswers && priorAnswers.length > 0;
      const wordCount = topic.trim().split(/\s+/).length;
      const isSpecific = wordCount >= 4 || hasAnswers;

      // Determine intent from keywords
      let intent: SkillIntentResult['intent'] = 'learning';
      if (lower.includes('plan') || lower.includes('schedule') || lower.includes('project') || lower.includes('roadmap')) {
        intent = 'planning';
      } else if (lower.includes('research') || lower.includes('study') || lower.includes('analyse') || lower.includes('analyze') || lower.includes('investigate')) {
        intent = 'research';
      } else if (lower.includes('brainstorm') || lower.includes('idea') || lower.includes('explore') || lower.includes('creative')) {
        intent = 'brainstorming';
      } else if (lower.includes('problem') || lower.includes('solve') || lower.includes('fix') || lower.includes('debug') || lower.includes('improve')) {
        intent = 'problem-solving';
      }

      // Determine depth from keywords or answers
      let depth: SkillIntentResult['depth'] = 'detailed';
      if (lower.includes('basic') || lower.includes('beginner') || lower.includes('overview') || lower.includes('intro') || lower.includes('quick')) {
        depth = 'basic';
      } else if (lower.includes('deep') || lower.includes('advanced') || lower.includes('comprehensive') || lower.includes('thorough') || lower.includes('expert')) {
        depth = 'deep';
      }
      if (hasAnswers) {
        const allAnswers = (priorAnswers || []).map(a => a.answer.toLowerCase()).join(' ');
        if (allAnswers.includes('basic') || allAnswers.includes('beginner') || allAnswers.includes('overview')) depth = 'basic';
        if (allAnswers.includes('deep') || allAnswers.includes('advanced') || allAnswers.includes('comprehensive')) depth = 'deep';
      }

      // Generate clarifications only when topic is short and no prior answers
      const clarifications: string[] = [];
      if (!isSpecific) {
        clarifications.push(
          `Are you trying to learn ${topic} concepts, create a plan, or research it deeply?`,
          `How detailed should the map be — a quick overview, or a thorough breakdown?`
        );
        if (!lower.includes('personal') && !lower.includes('work') && !lower.includes('school')) {
          clarifications.push(`Is this for personal use, academics, or professional work?`);
        }
      }

      const confidence = isSpecific ? 0.92 : 0.72;
      const goalMap: Record<string, string> = {
        learning: `Learn and understand the core concepts of ${topic}`,
        planning: `Create a structured plan around ${topic}`,
        brainstorming: `Explore and generate ideas about ${topic}`,
        research: `Research and investigate ${topic} in depth`,
        'problem-solving': `Solve and address challenges related to ${topic}`
      };

      return {
        topic,
        intent,
        depth,
        clarifications,
        userGoal: goalMap[intent],
        confidence
      };
    });
  }

  /**
   * KnowledgeArchitectSkill: Generate a hierarchical mind map tree.
   */
  static async buildKnowledgeMap(intentResult: SkillIntentResult): Promise<SkillMapResult> {
    const { topic, intent, depth, userGoal } = intentResult;

    const depthInstructions = {
      basic: `Generate 3-4 top-level named concepts directly under the root. Leave children arrays empty.
Each branch must be a SPECIFIC named thing that belongs inside the topic — not a category label.`,
      detailed: `Generate 4-5 top-level named concepts. Each gets 2-3 child nodes one level deeper.
Children must be the specific components, mechanisms, or named sub-fields of their parent — not
just a more specific-sounding version of the parent name.`,
      deep: `Generate 4-5 top-level concepts. Each gets 2-3 child nodes. Each child gets 1-2 grandchild nodes.
At every level the nodes must become MORE granular and named — never more generic or abstract.
A grandchild like "Leucine Threshold" under "Protein" is correct.
A grandchild like "Advanced Protein" or "Protein Deep Dive" is wrong and forbidden.`
    };

    const systemPrompt = `
You are KnowledgeArchitectSkill. Generate a semantically precise, hierarchical mind map tree.

SEMANTIC DEPTH LAW — ENFORCED AT EVERY LEVEL:
Each child node must be a specific NAMED concept that naturally and logically lives inside its parent.
The relationship must be "X is a component / mechanism / named sub-field of Y" —
never "X is a deeper analysis of Y."

ABSOLUTELY FORBIDDEN label patterns:
  × "Advanced [X]"          × "[X] Fundamentals"       × "[X] Overview"
  × "[X] Applications"      × "[X] Techniques"          × "[X] Concepts"
  × "Introduction to [X]"   × "Deep Dive into [X]"      × "Understanding [X]"
  × "Key [X]"               × "[X] Basics"              × "[X] Principles"
  × "Exploring [X]"         × "[X] Methods"             × "Modern [X]"

REQUIRED: Every label must be one of:
  ✓ A named theory, law, or model (e.g., "Hebbian Learning", "Nash Equilibrium")
  ✓ A named algorithm or technique (e.g., "Gradient Descent", "K-Fold Cross-Validation")
  ✓ A named phenomenon or mechanism (e.g., "Vanishing Gradient Problem", "Permafrost Thaw")
  ✓ A named tool, framework, or system (e.g., "Transformer Architecture", "Cap-and-Trade")
  ✓ A named measurement or concept (e.g., "VO2 Max", "Leucine Threshold", "LCOE")

GOOD example — topic "Machine Learning", depth "deep":
  Level 1: "Gradient Descent"
    Level 2: "Learning Rate Scheduling"
      Level 3: "Cyclical Learning Rates"
  Level 1: "Regularization"
    Level 2: "L1 / L2 Penalties"
      Level 3: "Elastic Net"

BAD example (forbidden):
  Level 1: "ML Optimization Techniques"
    Level 2: "Advanced Gradient Descent"
      Level 3: "Deep Dive into Learning Rates"

Depth structure: ${depthInstructions[depth]}
User intent: ${intent}
User goal: ${userGoal}
Node IDs: numeric dot notation — "1", "1-1", "1-1-1"
Descriptions: one phrase under 10 words, factual and specific.

Respond ONLY with valid JSON:
{
  "root": "${topic}",
  "children": [
    {
      "id": "1",
      "label": "Named Concept",
      "description": "Specific factual phrase",
      "children": []
    }
  ]
}
    `;

    const userPrompt = `Topic: "${topic}"\nIntent: ${intent}\nDepth: ${depth}\nGoal: ${userGoal}\n\nGenerate the mind map tree. Every label must be a specific named concept.`;

    return callGeminiJSON<SkillMapResult>(systemPrompt, userPrompt, () => {
      return { root: topic, children: [] };
    });
  }

  /**
   * ExplorationSkill: Dynamically expand a selected node with new children.
   */
  static async exploreNode(
    selectedNode: string,
    parentTopic: string,
    depth: 'basic' | 'detailed' | 'deep'
  ): Promise<SkillExpansionResult> {
    const childCount = depth === 'basic' ? 3 : depth === 'detailed' ? 4 : 5;

    const systemPrompt = `
You are ExplorationSkill. You expand a selected node in a mind map by generating its true,
specific sub-concepts — the actual named things that live inside this concept.

CORE RULE: Every child you generate must be something that IS a part of, or IS a specific type
of, the selected node. Ask yourself: "What are the real named components, mechanisms, algorithms,
phenomena, or named methods that belong specifically inside '${selectedNode}'?"

ABSOLUTELY FORBIDDEN:
  × "Advanced ${selectedNode}"    × "${selectedNode} Fundamentals"
  × "${selectedNode} Overview"    × "${selectedNode} Applications"
  × "${selectedNode} Techniques"  × "Key ${selectedNode} Concepts"
  × "Introduction to ${selectedNode}"   × "Understanding ${selectedNode}"
  × Any label that is just the parent name with a generic adjective or suffix

REQUIRED: Each label must be a SPECIFIC NAMED thing:
  ✓ Named algorithm, theory, law, or model
  ✓ Named biological mechanism, chemical process, or physical phenomenon
  ✓ Named tool, dataset, architecture, or system
  ✓ Named metric, threshold, or measurement
  ✓ Named event, person, or landmark study

EXAMPLES of correct expansion:
  Parent "Gradient Descent" → children: "Learning Rate Decay", "Momentum", "Saddle Point Problem", "Vanishing Gradients"
  Parent "Nutrition" → children: "Protein Synthesis", "Glycemic Index", "Gut Microbiome", "Insulin Sensitivity"
  Parent "Market Research" → children: "Total Addressable Market", "Mom Test Protocol", "Kano Model", "Cohort Analysis"
  Parent "Carbon Cycle" → children: "Ocean Carbon Sequestration", "Permafrost Thaw", "Terrestrial Biomass Sink", "Aerosol Scattering"

Generate exactly ${childCount} children for: "${selectedNode}" (within the broader topic "${parentTopic}")

Node IDs: use "exp-1", "exp-2", etc.
Descriptions: one specific factual phrase under 10 words.

Respond ONLY with valid JSON:
{
  "newChildren": [
    { "id": "exp-1", "label": "Specific Named Concept", "description": "Factual sub-phrase", "children": [] }
  ]
}
    `;

    const userPrompt = `Selected Node: "${selectedNode}"\nParent Topic: "${parentTopic}"\nDepth: ${depth}\n\nGenerate ${childCount} specific named child concepts.`;

    return callGeminiJSON<SkillExpansionResult>(systemPrompt, userPrompt, () => {
      return { newChildren: [] };
    });
  }

  /**
   * NodeConversationSkill: Answer contextual questions about a selected node.
   */
  static async answerNodeQuestion(
    selectedNode: string,
    parentTopic: string,
    question: string,
    branchContext?: string
  ): Promise<SkillConversationResult> {
    const systemPrompt = `
      You are NodeConversationSkill. You allow users to have a conversation with their mind map.
      You answer questions about specific nodes in context of their parent topic.

      Rules:
      - Stay grounded to the selected node and its context
      - Be concise but informative (2-4 sentences)
      - Use accessible, clear language
      - Reference the parent topic when relevant
      - If the question is unrelated to the node, gently redirect

      You are answering a question about the node: "${selectedNode}"
      In the context of the topic: "${parentTopic}"
      ${branchContext ? `Branch context: ${branchContext}` : ''}

      Respond ONLY with valid JSON:
      { "answer": "Your answer here." }
    `;

    const userPrompt = `Question: "${question}"`;

    return callGeminiJSON<SkillConversationResult>(systemPrompt, userPrompt, () => {
      return {
        answer: `${selectedNode} is a key concept within ${parentTopic}. Understanding it helps build a complete picture of the topic and its practical connections.`
      };
    });
  }

}
