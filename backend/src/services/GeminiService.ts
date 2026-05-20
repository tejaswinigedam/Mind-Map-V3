import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { 
  ClarifyingQuestion, 
  ExtractedIntent, 
  KnowledgeExpansion, 
  StructurePlan, 
  MindMapNode, 
  MindMapEdge, 
  SharedMemory,
  ExplorationDepth
} from '../orchestrator/types';

dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
let genAI: GoogleGenerativeAI | null = null;

if (apiKey) {
  console.log('[GeminiService] API Key detected. Using Google Gemini API.');
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn('[GeminiService] GOOGLE_API_KEY / GEMINI_API_KEY not found in environment. Booting in Agent Simulation Mode.');
}

/**
 * Helper to call Gemini model with system prompt and JSON expectation
 */
async function callGeminiJSON<T>(systemPrompt: string, userPrompt: string, fallbackGenerator: () => T): Promise<T> {
  if (!genAI) {
    // Artificial delay to mimic API latency (1-2 seconds) for realistic pacing
    await new Promise(resolve => setTimeout(resolve, 1500));
    return fallbackGenerator();
  }

  try {
    // Dynamically select a supported model. Prefer the highest‑tier model that supports generateContent.
    const modelName = await (async () => {
      try {
        const allModels = await (genAI as any).listModels();
        // Filter models that support generateContent (responseMimeType JSON) and sort by name descending.
        const candidates = allModels.models?.filter((m: any) => m.supportsGenerateContent) || [];
        if (candidates.length > 0) {
          // Prefer newer Gemini models if available.
          const sorted = candidates.sort((a: any, b: any) => (b.name || '').localeCompare(a.name || ''));
          return sorted[0].name as string;
        }
      } catch (e) {
        console.warn('[GeminiService] Failed to list models, defaulting to fallback model.');
      }
      // Fallback to a known stable model name that works for most free‑tier keys.
      return 'gemini-2.0-flash';
    })();

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      }
    });

    // Enforce an 8-second timeout to handle proxy blocks, rate limits, or DNS delays
    const apiCall = model.generateContent(userPrompt);
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Google Gemini API request timed out after 8 seconds.')), 8000)
    );

    const result = await Promise.race([apiCall, timeoutPromise]);
    const text = result.response.text();
    return JSON.parse(text) as T;
  } catch (error: any) {
    console.error('[GeminiService] Error calling Gemini API:', error.message || error);
    console.log('[GeminiService] Network hang, invalid key, or timeout diagnosed. Falling back immediately to simulation engine.');
    
    // Delay slightly to maintain realistic pacing
    await new Promise(resolve => setTimeout(resolve, 1200));
    return fallbackGenerator();
  }
}

function detectCategory(topic: string): 'health' | 'tech' | 'creative' | 'business' | 'general' {
  const lower = topic.toLowerCase();
  
  const healthKeywords = ['diet', 'dietary', 'nutrition', 'food', 'wellness', 'health', 'cooking', 'recipe', 'kid', 'baby', 'toddler', 'child', 'eating', 'meal', 'nutritionist', 'pediatric', 'vitamins', 'fitness', 'exercise', 'weight', 'skin', 'sleep', 'growth', 'physical', 'body'];
  const techKeywords = ['software', 'programming', 'coding', 'web', 'engineering', 'math', 'science', 'physics', 'data', 'cloud', 'quantum', 'system', 'architecture', 'crypto', 'security', 'ai', 'intelligence', 'llm', 'agent', 'machine learning', 'tech', 'network', 'database', 'algorithm', 'blockchain'];
  const creativeKeywords = ['music', 'art', 'painting', 'writing', 'history', 'literature', 'design', 'philosophy', 'language', 'culture', 'creative', 'photography', 'drawing', 'drama', 'theatre', 'dance', 'film', 'poetry', 'sculpture'];
  const businessKeywords = ['business', 'finance', 'marketing', 'strategy', 'startup', 'sales', 'management', 'investment', 'economy', 'money', 'growth', 'career', 'corporate', 'product', 'customer', 'revenue', 'profit', 'hr', 'hiring', 'recruiting', 'retail', 'commerce'];

  if (healthKeywords.some(kw => lower.includes(kw))) return 'health';
  if (techKeywords.some(kw => lower.includes(kw))) return 'tech';
  if (creativeKeywords.some(kw => lower.includes(kw))) return 'creative';
  if (businessKeywords.some(kw => lower.includes(kw))) return 'business';
  return 'general';
}

const CATEGORY_NODE_DICTIONARY: Record<string, { label: string; desc: string; details: string }> = {
  // Health & Wellness (hlth)
  "hlth1": { label: "Nutritional Foundations", desc: "Essential nutrients, macro & micro balance", details: "Understanding the building blocks of healthy eating, including vitamins, minerals, proteins, healthy fats, and carbohydrates tailored to this topic." },
  "hlth2": { label: "Daily Meal Planning", desc: "Practical schedules and recipes", details: "Constructing balanced, delicious, and age-appropriate meals throughout the day, focusing on consistent schedules and food variety." },
  "hlth3": { label: "Healthy Habits & Education", desc: "Fostering positive relationships with food", details: "Techniques for introducing new foods, establishing mindful eating practices, and educating on long-term wellness habits." },
  "hlth4": { label: "Common Challenges & Solutions", desc: "Overcoming picky eating and allergies", details: "Practical strategies to address common nutritional struggles, dietary restrictions, food sensitivities, and selective eating behaviors." },
  
  "hlth1_a": { label: "Macronutrient Balance", desc: "Proteins, clean carbs & healthy lipids", details: "Balancing caloric intake across key energy sources to fuel daily activity and support healthy physical and mental development." },
  "hlth1_b": { label: "Micro & Trace Elements", desc: "Vitamins, minerals and hydration", details: "Securing essential vitamins and trace minerals required for core metabolic functions, growth, and immune defense." },
  "hlth1_a_a": { label: "Protein & Amino Acids", desc: "Structural building blocks", details: "Sourcing high-quality proteins to repair tissues, build muscles, and support hormone synthesis." },
  "hlth1_a_b": { label: "Complex Carbohydrates", desc: "Sustained glycogen & energy", details: "Focusing on slow-release starches and fibers to maintain steady energy levels and support digestive health." },
  "hlth1_b_a": { label: "Essential Vitamins", desc: "Micronutrients for metabolic support", details: "Securing vitamins like Vitamin D, C, and B-complex to act as vital coenzymes in cellular growth and immunity." },
  "hlth1_b_b": { label: "Hydration & Mineral Balance", desc: "Fluids, calcium, iron & zinc", details: "Maintaining cellular hydration and securing bone-building calcium and oxygen-transporting iron." },

  "hlth2_a": { label: "Breakfast & Lunch Fuel", desc: "Energizing start to the day", details: "Providing nutrient-dense morning options that set up cognitive focus and physical stamina." },
  "hlth2_b": { label: "Dinners & Smart Snacks", desc: "Restorative evening nutrition", details: "Offering balanced, satisfying dinners and low-sugar snacks to keep energy levels stable without sugar spikes." },
  "hlth2_a_a": { label: "Nutrient-Dense Breakfasts", desc: "Proteins and slow carbs", details: "Quick, balanced meals like oatmeal with nuts or eggs to kickstart the metabolism and support focus." },
  "hlth2_a_b": { label: "Balanced Portable Lunches", desc: "Nourishment for school/work", details: "Crafting easily transportable meals containing a solid balance of clean proteins, fresh produce, and whole grains." },
  "hlth2_b_a": { label: "Balanced Family Dinners", desc: "Diverse ingredients on one plate", details: "Preparing well-rounded evening meals featuring vegetables, healthy fats, and lean proteins for restorative nutrition." },
  "hlth2_b_b": { label: "Low-Sugar Healthy Snacks", desc: "Whole-food energy boosts", details: "Replacing packaged processed snacks with fruits, veggies, hummus, or seeds to bridge hunger gaps." },

  "hlth3_a": { label: "Positive Food Association", desc: "Encouraging exploration without pressure", details: "Using culinary interaction, sensory exploration, and low-stress environments to help people welcome new foods." },
  "hlth3_b": { label: "Eating Environment", desc: "Structuring calm, regular meals", details: "Establishing clean routines around dining, including distraction-free environments and social interaction." },
  "hlth3_a_a": { label: "Sensory Play & Cooking", desc: "Hands-on food interaction", details: "Involving individuals in washing, chopping, and plating to reduce fear of unfamiliar textures and tastes." },
  "hlth3_a_b": { label: "Role Modeling Habits", desc: "Leading by positive example", details: "Demonstrating diverse, healthy food appreciation at the table, as behaviors are caught rather than taught." },
  "hlth3_b_a": { label: "Screen-Free Dining", desc: "Mindful and focused eating", details: "Eliminating phones and televisions during meals to promote full satiety awareness and meaningful conversation." },
  "hlth3_b_b": { label: "Mindful Portions", desc: "Listening to natural satiety", details: "Teaching people to honor their bodies' hunger and fullness cues rather than enforcing 'clean plate' rules." },

  "hlth4_a": { label: "Selective Eating Strategy", desc: "Handling pickiness and aversion", details: "Overcoming food neophobia and texture sensitivities through patient, structured dietary introduction strategies." },
  "hlth4_b": { label: "Allergies & Sensitivities", desc: "Managing dietary restrictions safely", details: "Identifying allergens and building robust protocols to avoid adverse immune responses or systemic inflammation." },
  "hlth4_a_a": { label: "Exposure Therapy Methods", desc: "Systematic food desensitization", details: "Offering tiny, non-threatening portions of a new food alongside familiar favorites, up to 15 times, to build acceptance." },
  "hlth4_a_b": { label: "Creative Nutrient Density", desc: "Optimizing recipes seamlessly", details: "Incorporating puréed vegetables, ground seeds, or bone broth into sauces and soups to elevate nutrition smoothly." },
  "hlth4_b_a": { label: "Ingredient Substitutions", desc: "Finding safe, nutritious alternatives", details: "Using gluten-free grains, seed butters, or plant-based milks to replicate culinary textures safely." },
  "hlth4_b_b": { label: "Cross-Contamination Checks", desc: "Maintaining allergen-free spaces", details: "Adopting clear kitchen practices, separate utensils, and meticulous label reading to guarantee absolute food safety." },

  // Tech & Coding (tech)
  "tech1": { label: "Core Architecture & Logic", desc: "System design and foundational concepts", details: "Analyzing the structural pillars, core mathematical or algorithmic logic, and fundamental paradigms of this technology." },
  "tech2": { label: "Practical Implementations", desc: "Frameworks, tools, and code patterns", details: "Exploring popular open-source libraries, tooling environments, and real-world implementation methodologies." },
  "tech3": { label: "Performance Optimization", desc: "Scaling, latency, and resource limits", details: "Strategies for maximizing execution speed, tuning memory usage, and avoiding scaling bottlenecks." },
  "tech4": { label: "Challenges & Future Trends", desc: "Security, trade-offs, and next-gen tech", details: "Evaluating technical debt, modern security threats, compliance standards, and emergent industry directions." },

  "tech1_a": { label: "Algorithmic Foundations", desc: "Underlying computation models", details: "Analyzing core data models, logic syntax, and mathematical foundations that support computations in this domain." },
  "tech1_b": { label: "System Architecture", desc: "High-level component layout", details: "Designing robust patterns to organize software components, manage service state, and decouple dependencies." },
  "tech1_a_a": { label: "Data Structures", desc: "Organizing relational information", details: "Selecting optimal data arrangements (trees, graphs, key-value stores) to maximize retrieval efficiency." },
  "tech1_a_b": { label: "Complexity Analysis", desc: "Time and space computational bounds", details: "Measuring algorithm growth rates (Big O) to guarantee performance holds up as input sizes scale." },
  "tech1_b_a": { label: "Component Decoupling", desc: "Modular interface design", details: "Enforcing strict separation of concerns to allow modules to be updated or replaced independently." },
  "tech1_b_b": { label: "Interface Definitions", desc: "Strict system schemas", details: "Establishing unambiguous contracts (APIs, schemas, types) to coordinate communication between components." },

  "tech2_a": { label: "Tooling & Environments", desc: "Compilers, IDEs, and runtimes", details: "Setting up developer tools, compiler optimization flags, and local runtime sandboxes for maximum productivity." },
  "tech2_b": { label: "API Design & Patterns", desc: "Creating reusable integrations", details: "Structuring public and private interfaces using proven design patterns to expose capabilities safely." },
  "tech2_a_a": { label: "Standard Dev Suites", desc: "Essential local environments", details: "The basic setup of linters, formatters, and local debuggers required to write high-quality code." },
  "tech2_a_b": { label: "CI/CD Pipelines", desc: "Automating validation and deployment", details: "Setting up automated test runs and build processes to gate-check and deploy new code updates seamlessly." },
  "tech2_b_a": { label: "RESTful/GraphQL Standards", desc: "Decoupled web interfaces", details: "Adopting structured protocols to serialize, fetch, and mutate resources across distributed networks." },
  "tech2_b_b": { label: "State Management", desc: "Predictable data flows", details: "Tracking complex user or server states using immutable data stores and clear transactional actions." },

  "tech3_a": { label: "Latency Reduction", desc: "Improving execution speeds", details: "Eliminating blocking operations, slow I/O bottlenecks, and network roundtrips to achieve sub-millisecond response times." },
  "tech3_b": { label: "Resource Utilization", desc: "Optimizing memory & CPU overhead", details: "Minimizing baseline footprint, preventing memory leaks, and managing CPU cycles efficiently under high-load concurrency." },
  "tech3_a_a": { label: "Caching Protocols", desc: "In-memory data retrieval", details: "Storing high-demand query results in key-value caches (like Redis) to bypass expensive database lookups." },
  "tech3_a_b": { label: "Concurrent Threading", desc: "Parallel task execution", details: "Leveraging non-blocking asynchronous event loops or multi-core thread pools to process tasks simultaneously." },
  "tech3_b_a": { label: "Memory Leak Resolution", desc: "Mitigating allocation bloat", details: "Profiling runtimes to identify uncollected references, preventing slow resource degradation." },
  "tech3_b_b": { label: "Database Indexing", desc: "Query speed optimization", details: "Creating efficient lookup indexes on high-traffic database fields to avoid slow full-table scans." },

  "tech4_a": { label: "Security & Encryption", desc: "Protecting data and endpoints", details: "Implementing industry-standard cryptography, authorization protocols, and secure network boundaries." },
  "tech4_b": { label: "Technological Evolution", desc: "Future roadmaps and paradigms", details: "Tracking emergent language features, architectural trends, and planning non-disruptive migration strategies." },
  "tech4_a_a": { label: "Auth Protocols", desc: "OAuth2 and JWT protection", details: "Verifying user identities and scopes securely across distributed services without exposing secrets." },
  "tech4_a_b": { label: "Threat Vector Audits", desc: "Defending common vulnerabilities", details: "Testing systems against standard exploit vectors (SQL injection, XSS, CSRF) to harden production environments." },
  "tech4_b_a": { label: "Emerging Paradigms", desc: "Next-gen frameworks and runtimes", details: "Evaluating cutting-edge libraries or languages to see if they offer 10x gains in safety or performance." },
  "tech4_b_b": { label: "Legacy Migration", desc: "Refactoring without downtime", details: "Phasing out outdated software layers incrementally using patterns like the Strangler Fig to minimize service disruption." },

  // Creative & Arts (crtv)
  "crtv1": { label: "Theoretical & Historical Foundations", desc: "Origins, movements, and key concepts", details: "Investigating the historical evolution, philosophical frameworks, and creative movements that shaped this domain." },
  "crtv2": { label: "Creative Techniques & Mediums", desc: "Skills, tools, and practical execution", details: "Delving into standard artistic practices, tools of the trade, and specific technical skills required for mastery." },
  "crtv3": { label: "Style & Composition Analysis", desc: "Structure, form, and aesthetics", details: "Exploring elements of composition, structural design patterns, and aesthetic principles that make works compelling." },
  "crtv4": { label: "Modern Expression & Adaptations", desc: "Contemporary uses and digital shifts", details: "Analyzing how traditional techniques adapt to digital mediums, modern audiences, and cross-disciplinary collaborations." },

  "crtv1_a": { label: "Historical Evolution", desc: "Chronological development & milestones", details: "Tracing the origins, historical figures, and evolutionary cycles that brought this art form to its modern state." },
  "crtv1_b": { label: "Philosophical Frameworks", desc: "Ideologies and core theories", details: "Analyzing the underlying aesthetic theories, artistic philosophies, and core expressive intents that drive creators." },
  "crtv1_a_a": { label: "Pioneering Works", desc: "Masterpieces and key turn-points", details: "Studying critical historical works that disrupted standard conventions and birthed new stylistic sub-genres." },
  "crtv1_a_b": { label: "Cultural Milestones", desc: "Artistic response to history", details: "Examining how cultural shifts, societal events, and economic conditions directly shaped the evolution of creative output." },
  "crtv1_b_a": { label: "Aesthetic Theories", desc: "Defining beauty and expression", details: "Exploring different artistic paradigms (realism, impressionism, abstractionism) that govern how art is judged." },
  "crtv1_b_b": { label: "Conceptual Intent", desc: "Translating messages into forms", details: "Understanding the direct link between a creator's emotional or political message and their selected artistic shape." },

  "crtv2_a": { label: "Technical Mastery", desc: "Essential physical/digital skills", details: "Practicing the core motor coordinates, brushwork, wordcraft, or instrument fingerings required to execute ideas cleanly." },
  "crtv2_b": { label: "Practice Methodologies", desc: "Improving skills through routine", details: "Structuring creative habits, feedback loops, and daily exercises to steadily elevate execution precision." },
  "crtv2_a_a": { label: "Drafting & Crafting", desc: "Initial sketching and planning", details: "The crucial blueprint phase where layouts, outline structures, or raw melodies are drafted before detailing." },
  "crtv2_a_b": { label: "Material/Tool Selection", desc: "Choosing instruments and mediums", details: "Understanding how different papers, lenses, paint types, or word-processors modify the texture and mood of the final piece." },
  "crtv2_b_a": { label: "Deliberate Practice", desc: "Isolating weaknesses systematically", details: "Breaking down complex movements or writing challenges into isolated exercises to rebuild them stronger." },
  "crtv2_b_b": { label: "Iterative Refining", desc: "The editing and polishing phase", details: "Applying ruthless critical analysis to early drafts, chipping away elements that do not serve the central vision." },

  "crtv3_a": { label: "Structural Harmony", desc: "Balancing forms and expressions", details: "Organizing focal points, leading lines, melodic arcs, or narrative structures to guide the audience's attention." },
  "crtv3_b": { label: "Expressive Storytelling", desc: "Conveying narrative and emotion", details: "Layering metaphorical elements, atmospheric moods, or stylistic choices to trigger deep, visceral emotional reactions." },
  "crtv3_a_a": { label: "Proportions & Scale", desc: "Managing visual/auditory weight", details: "Arranging elements so that their relative sizes or volume dynamics create a pleasing sense of balance and focus." },
  "crtv3_a_b": { label: "Contrast & Tension", desc: "Generating dramatic interest", details: "Juxtaposing light and dark, consonance and dissonance, or action and stillness to keep the audience deeply engaged." },
  "crtv3_b_a": { label: "Symbolism & Metaphor", desc: "Layered subtextual communication", details: "Embedding subtle visual, lyrical, or narrative symbols that communicate complex concepts beneath the surface." },
  "crtv3_b_b": { label: "Atmospheric Depth", desc: "Creating immersive environments", details: "Using color palettes, acoustic reverb, or sensory writing descriptions to transport the audience into the work." },

  "crtv4_a": { label: "Digital Transformation", desc: "Modern digital tools and channels", details: "Leveraging digital illustration suites, DAWs, or generative software to multiply creative capabilities." },
  "crtv4_b": { label: "Audience Engagement", desc: "Connecting with modern viewers", details: "Publishing creative output across global networks, engaging communities, and managing digital portfolios." },
  "crtv4_a_a": { label: "Software Integration", desc: "Harnessing high-tech creative engines", details: "Learning to co-create with vector engines, synthesizer plugins, or advanced layout editors." },
  "crtv4_a_b": { label: "Online Portfolios", desc: "Showcasing work globally", details: "Setting up optimized web galleries or streaming profiles to showcase high-fidelity work directly to fans." },
  "crtv4_b_a": { label: "Interactive Elements", desc: "Breaking the fourth wall", details: "Creating immersive, branching, or responsive works that shift based on real-time viewer input." },
  "crtv4_b_b": { label: "Collaborative Formats", desc: "Cross-disciplinary co-creation", details: "Working in distributed teams combining code, sound, and visual arts to engineer rich, multi-sensory experiences." },

  // Business & Strategy (biz)
  "biz1": { label: "Strategic Foundations", desc: "Market dynamics and business models", details: "Analyzing market opportunities, value propositions, and foundational business design systems." },
  "biz2": { label: "Operational Execution", desc: "Tactics, workflows, and resource allocation", details: "Exploring functional workflows, team coordination, sales cycles, and standard operational protocols." },
  "biz3": { label: "Financial Growth & Risk", desc: "Revenue models, metrics, and compliance", details: "Structuring unit economics, funding strategies, pricing models, and key risk mitigation frameworks." },
  "biz4": { label: "Scaling & Global Expansion", desc: "Growth hacking and internationalization", details: "Strategies for customer acquisition, organizational scaling, international expansion, and long-term brand building." },

  "biz1_a": { label: "Market Research", desc: "Understanding audiences & competition", details: "Acquiring quantitative and qualitative insights regarding customer segments, buying triggers, and competitive landscapes." },
  "biz1_b": { label: "Value Proposition", desc: "Differentiating your core offering", details: "Formulating a crystal-clear statement that explains how your product solves problems uniquely compared to alternatives." },
  "biz1_a_a": { label: "Customer Persona Audits", desc: "Mapping demographic behaviors", details: "Building highly detailed avatars of ideal customers, mapping their daily friction points, goals, and budget limits." },
  "biz1_a_b": { label: "Competitor Landscapes", desc: "Analyzing industry rivals", details: "Evaluating competitors' feature sets, pricing models, and market shares to locate undefended niches." },
  "biz1_b_a": { label: "Unique Selling Points", desc: "Formulating core differentiators", details: "Defining the exact features, service speeds, or technological advantages that make your product irreplaceable." },
  "biz1_b_b": { label: "Product-Market Fit", desc: "Aligning offering to actual demand", details: "Iteratively refining your product features based on early customer feedback until usage metrics explode." },

  "biz2_a": { label: "Process Optimization", desc: "Streamlining daily business operations", details: "Identifying operational bottlenecks, defining clear team playbooks, and automating routine administrative steps." },
  "biz2_b": { label: "Sales & Funnel Design", desc: "Converting leads into loyal customers", details: "Structuring a multi-step customer journey that educates prospects, handles objections, and closes deals predictably." },
  "biz2_a_a": { label: "Workflow Automation", desc: "Removing human data transfer friction", details: "Integrating software (CRMs, APIs) to automatically parse invoices, route support tickets, and update databases." },
  "biz2_a_b": { label: "Team Collaboration Tools", desc: "Synchronizing distributed staff", details: "Establishing clean communication loops using task boards and unified chat suites to maintain clear alignment." },
  "biz2_b_a": { label: "Lead Acquisition Strategy", desc: "Attracting high-intent prospects", details: "Deploying organic content, SEO, and paid advertising to feed the top of your sales funnel consistently." },
  "biz2_b_b": { label: "Conversion Rate Auditing", desc: "Plugging leaks in customer paths", details: "Analyzing drop-off points in your web checkout or sales call scripts to maximize the return on acquisition spend." },

  "biz3_a": { label: "Unit Economics", desc: "Ensuring healthy profit margins", details: "Modeling the direct revenues and costs associated with a single customer transaction to ensure sustainable profit." },
  "biz3_b": { label: "Risk Management", desc: "Mitigating legal & financial threats", details: "Establishing strong cash reserves, secure contract terms, and regulatory compliance standards to buffer shocks." },
  "biz3_a_a": { label: "LTV-to-CAC Ratios", desc: "Measuring customer profitability", details: "Comparing a customer's Lifetime Value (LTV) against the Cost to Acquire them (CAC); a 3:1 ratio is the standard health target." },
  "biz3_a_b": { label: "Pricing Elasticity Model", desc: "Finding optimal pricing points", details: "Testing different price levels to understand how demand shifts, unlocking maximum revenue potential." },
  "biz3_b_a": { label: "Regulatory Compliance", desc: "Adhering to local & global laws", details: "Ensuring operations comply with privacy acts (GDPR, CCPA), tax codes, and employment laws to avoid catastrophic fines." },
  "biz3_b_b": { label: "Cash Flow Safeguarding", desc: "Monitoring burn and runway", details: "Tracking monthly outgoing capital against incoming revenues to guarantee the business never runs out of operational liquidity." },

  "biz4_a": { label: "Growth Engineering", desc: "High-leverage marketing tactics", details: "Deploying viral referral programs, SEO loops, and strategic integrations to acquire customers exponentially." },
  "biz4_b": { label: "Organizational Scaling", desc: "Building teams and leadership", details: "Transitioning from founder-led execution to structured middle management and high-performing specialized teams." },
  "biz4_a_a": { label: "Viral Loop Construction", desc: "Building user-driven acquisition", details: "Designing in-app incentives that naturally prompt active users to invite colleagues or friends, creating organic growth." },
  "biz4_a_b": { label: "SEO & Content Engines", desc: "Dominating high-intent search terms", details: "Publishing authoritative, high-ranking educational guides that attract organic traffic without recurring ad costs." },
  "biz4_b_a": { label: "Hiring & Talent Funnels", desc: "Sourcing top-tier staff", details: "Designing structured technical assessments and value-alignment interviews to hire exceptional talent." },
  "biz4_b_b": { label: "Corporate Culture Scaling", desc: "Maintaining vision at scale", details: "Defining clear core values, feedback cadences, and transparent promotion pathways to retain top performers." },

  // General & Hobbies (gen)
  "gen1": { label: "Core Fundamentals", desc: "Origins, rules, and basic terms", details: "Getting started with the foundational terminology, history, rules, and basic equipment or skills." },
  "gen2": { label: "Practical Techniques", desc: "Daily activities and hands-on exercises", details: "Step-by-step methods, skills, and activities required to put these concepts into practice." },
  "gen3": { label: "Key Benefits & Growth", desc: "Mental, physical, and social impacts", details: "Understanding the primary advantages, milestones of progress, and positive impacts of this pursuit." },
  "gen4": { label: "Common Barriers & Solutions", desc: "Troubleshooting mistakes and challenges", details: "Overcoming standard plateaus, resource limitations, common errors, and practical troubleshooting steps." },

  "gen1_a": { label: "Essential Equipment", desc: "Selecting the right gear and workspace", details: "Identifying, sourcing, and arranging the hardware, physical materials, or software environments needed to begin." },
  "gen1_b": { label: "Foundational Concepts", desc: "Core terms and essential rules", details: "Learning the fundamental vocabulary, core theories, governing rules, and basic safety protocols of this field." },
  "gen1_a_a": { label: "Starter Gear Selection", desc: "Cost-effective beginner equipment", details: "Choosing entry-level tools that offer solid quality without requiring massive up-front capital investment." },
  "gen1_a_b": { label: "Setting Up Your Space", desc: "Creating an optimized environment", details: "Designing a clean, comfortable, and distraction-free physical or digital workspace tailored to this pursuit." },
  "gen1_b_a": { label: "Basic Nomenclature", desc: "Mastering domain vocabulary", details: "Understanding high-frequency terms, abbreviations, and common concepts used by active practitioners." },
  "gen1_b_b": { label: "Safety & Rules Protocol", desc: "Reducing risks and errors", details: "Studying key safety procedures, rules of conduct, or operational constraints to avoid injuries or critical mistakes." },

  "gen2_a": { label: "First Practices", desc: "Beginner-friendly introductory tasks", details: "Engaging in simple, low-stakes introductory exercises designed to build initial confidence and muscle memory." },
  "gen2_b": { label: "Intermediate Progress", desc: "Moving beyond basic drills", details: "Advancing toward complex routines, compound activities, and self-audited challenges to break through early plateaus." },
  "gen2_a_a": { label: "Step-by-Step Drills", desc: "Isolating core motions or sub-tasks", details: "Repetitively practicing basic elements to develop deep-seated subconscious habit coordinates." },
  "gen2_a_b": { label: "Habit Formation Loops", desc: "Creating consistent routines", details: "Linking this practice with daily anchors to ensure regular, friction-free engagement over weeks." },
  "gen2_b_a": { label: "Complex Combinations", desc: "Integrating separate skills", details: "Synthesizing individual sub-skills into fluid, continuous workflows that mimic real-world scenarios." },
  "gen2_b_b": { label: "Performance Audits", desc: "Self-recording and critiquing progress", details: "Using recordings, logs, or benchmarks to systematically locate and correct errors in execution." },

  "gen3_a": { label: "Personal Benefits", desc: "Mental clarity and physical wellness", details: "Experiencing immediate and long-range boosts in cognitive stamina, focus, stress reduction, or physical coordination." },
  "gen3_b": { label: "Community & Sharing", desc: "Connecting with fellow enthusiasts", details: "Finding belonging, sharing projects, and learning from peers by integrating into local or global communities." },
  "gen3_a_a": { label: "Cognitive Engagement", desc: "Activating focus and neuroplasticity", details: "Stimulating new neural pathways by challenging the brain with fresh, highly complex coordinates." },
  "gen3_a_b": { label: "Stress Reduction Dynamics", desc: "Entering deep flow states", details: "Achieving mindfulness and calming cortisol levels by immersing entirely in an engaging, hands-on activity." },
  "gen3_b_a": { label: "Forums & Local Meetups", desc: "Locating your tribe", details: "Locating online platforms, local clubs, or specialized spaces to share knowledge, questions, and achievements." },
  "gen3_b_b": { label: "Collaborative Projects", desc: "Working together on creative goals", details: "Joining forces with other enthusiasts to build large-scale, compound works that are impossible to execute alone." },

  "gen4_a": { label: "Troubleshooting Errors", desc: "Avoiding common beginner pitfalls", details: "Identifying systemic mistakes early and learning standard troubleshooting protocols to maintain momentum." },
  "gen4_b": { label: "Resource Management", desc: "Balancing time and cost barriers", details: "Strategies to fit this pursuit into a busy schedule and find budget-friendly alternative materials." },
  "gen4_a_a": { label: "Identifying Bad Habits", desc: "Early error self-correction", details: "Recognizing bad postures, sloppy logic patterns, or improper techniques before they calcify into muscle memory." },
  "gen4_a_b": { label: "Correction Techniques", desc: "Systematic remediation patterns", details: "Using targeted drills or seeking expert reviews to systematically untangle and repair deeply-entrained errors." },
  "gen4_b_a": { label: "Time Blocking Strategy", desc: "Finding time in busy lives", details: "Allocating recurring 15-to-30 minute focused blocks to maintain progress without disrupting primary obligations." },
  "gen4_b_b": { label: "Cost-Effective Alternatives", desc: "Sourcing open-source or used items", details: "Acquiring second-hand gear, using free open-source software, or building DIY tools to keep expenses low." }
};

export class GeminiService {
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
          q1: `What is your technical background with ${topic}?`,
          r1: `Tailors node complexity and avoids explaining basic terminology.`,
          o1: ['Beginner (needs conceptual overviews)', 'Intermediate (wants structured application)', 'Advanced (wants deep architectural nuances)'],
          q2: `How many levels of branching would you like to explore in this mind map?`,
          r2: `Determines the exact level of child-node nesting (1 to 5 levels) on the canvas.`,
          o2: [
            'Level 1: Surface overview',
            'Level 2: Intermediate structure',
            'Level 3: Detailed taxonomy',
            'Level 4: Deep academic analysis',
            'Level 5: Strategic systems analysis (As deep as possible)'
          ],
          q3: `Which aspect of ${topic} should we prioritize?`,
          r3: `Structures the primary branches to match the user's specific sub-domain interest.`,
          o3: ['Core Paradigms & Architecture', 'Real-world Applications & Ecosystem', 'Challenges, Contradictions & Tradeoffs']
        },
        generic: {
          q1: `What is your primary goal for mapping out ${topic}?`,
          r1: `Aligns downstream agents with either brainstorming breadth or tactical depth.`,
          o1: ['Creative brainstorming', 'Structured learning', 'Critical analysis & strategy'],
          q2: `How many levels of branching would you like to explore in this mind map?`,
          r2: `Determines the exact level of child-node nesting (1 to 5 levels) on the canvas.`,
          o2: [
            'Level 1: Surface overview',
            'Level 2: Intermediate structure',
            'Level 3: Detailed taxonomy',
            'Level 4: Deep academic analysis',
            'Level 5: Strategic systems analysis (As deep as possible)'
          ],
          q3: `What is your focus area within ${topic}?`,
          r3: `Allows the Knowledge Expansion Agent to bypass irrelevant areas.`,
          o3: ['General concepts', 'Detailed practical tools', 'Future implications & philosophy']
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
    expansion: KnowledgeExpansion,
    structure: StructurePlan
  ): Promise<{ nodes: MindMapNode[]; edges: MindMapEdge[] }> {

    const systemPrompt = `
      You are the Mind Map Generation Agent.
      Generate an interactive, hierarchical graph with nodes and edges.
      The nodes must be arranged in a neat tree-like layout.
      
      Rules for Node placement (coordinates must follow a tidy tree layout):
      - Root node at x: 0, y: 0
      - Layer 1 nodes spread vertically or horizontally (e.g., x: 250, y: -200, 0, 200)
      - Layer 2 nodes spread further (e.g., x: 500, y: ...)
      
      Rules for content depending on DEPTH (${intent.explorationDepth}):
      - LOW DEPTH (surface): 5-8 nodes max, beginner friendly, simple layout.
      - HIGH DEPTH (deep/strategic): 12-20 nodes, technical/advanced concepts, trade-offs, alignment paradigms, neural scaling, etc.

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
      Expanded Knowledge: ${JSON.stringify(expansion)}
      Structure Plan: ${JSON.stringify(structure)}
      
      Generate a detailed, beautifully arranged mind map in React Flow format.
    `;

    return callGeminiJSON<{ nodes: MindMapNode[]; edges: MindMapEdge[] }>(systemPrompt, userPrompt, () => {
    // Build a stunning, rich tree based on topic and depth simulation
    let maxDepth = 1;
    if (intent.explorationDepth === 'surface') {
      maxDepth = 1;
    } else if (intent.explorationDepth === 'intermediate') {
      maxDepth = 2;
    } else if (intent.explorationDepth === 'deep') {
      maxDepth = 4; // High depth maps to 4 levels of branching
    } else if (intent.explorationDepth === 'strategic') {
      maxDepth = 5; // Strategic depth preferences map to full 5 levels of branching
    } else if (typeof intent.explorationDepth === 'number') {
      maxDepth = intent.explorationDepth;
    } else {
      maxDepth = 3;
    }

    const nodes: MindMapNode[] = [];
    const edges: MindMapEdge[] = [];

    // Root node
    const rootNode: MindMapNode = {
      id: 'root',
      type: 'custom',
      data: {
        label: topic,
        description: `Primary Node - ${intent.useCase}`,
        depth: 0,
        details: `The main exploration node for "${topic}" orchestrated by agents with a depth of ${maxDepth}.`,
        importance: 'high'
      },
      position: { x: 0, y: 0 }
    };
    nodes.push(rootNode);

    // Static core node information dictionary for levels 2 and 3
    const CORE_NODE_DICTIONARY: Record<string, { label: string; desc: string; details: string }> = {
      // Skincare Domain
      // sk1: Skin Types
      "sk1_a": { label: "Oily & Acne-Prone", desc: "Excess sebum & clogged pores", details: "Characterized by active sebaceous glands, persistent shine, and susceptibility to blemishes. Requires careful sebum regulation and gentle, non-comedogenic hydration." },
      "sk1_b": { label: "Dry & Sensitive", desc: "Impaired barrier & hydration loss", details: "Lacks sufficient lipid production to lock in moisture, leading to tight, flaking skin and susceptibility to irritation. Requires ceramide-rich barrier repair and deep humectants." },
      "sk1_a_a": { label: "Salicylic Acid (BHA)", desc: "Lipid-soluble deep exfoliation", details: "A beta hydroxy acid that penetrates deep into pores to dissolve sebum and dead skin cells, helping to treat and prevent active breakouts." },
      "sk1_a_b": { label: "Sebum Regulation", desc: "Controlling oil production", details: "Balancing active sebaceous gland outputs using topical compounds like Niacinamide or Zinc PCA to reduce overall pore congestion." },
      "sk1_b_a": { label: "Ceramides & Peptides", desc: "Skin barrier repair elements", details: "Essential lipids and structural amino acids that rebuild the intercellular matrix of the stratum corneum, restoring resilience against external irritants." },
      "sk1_b_b": { label: "Hyaluronic Acid", desc: "Intense moisture humectant", details: "A powerful humectant capable of holding up to 1,000 times its weight in water, drawing hydration into the superficial layers of the skin." },

      // sk2: Morning Routine
      "sk2_a": { label: "Purify & Prep", desc: "Gentle cleansing and antioxidants", details: "Clearing overnight sebum and sweat while applying active antioxidants to combat daytime oxidative stress from environmental pollutants." },
      "sk2_b": { label: "Hydrate & Protect", desc: "Barrier sealing and UV defense", details: "Locking in moisture with lightweight emollients and applying high SPF sunscreen, which is the most critical anti-aging step." },
      "sk2_a_a": { label: "Gentle Cleanser", desc: "Sulfate-free pH balanced wash", details: "Removes impurities without stripping the natural lipid barrier, maintaining the skin's healthy acidic pH level." },
      "sk2_a_b": { label: "Antioxidant Vit C", desc: "L-Ascorbic acid defense", details: "Neutralizes free radicals, brightens hyperpigmentation, and synergistically boosts the protective efficacy of daytime sunscreen." },
      "sk2_b_a": { label: "Light Moisturizer", desc: "Non-greasy hydration lock", details: "Provides hydration with humectants and light emollients, absorbing quickly to sit comfortably under sunscreen." },
      "sk2_b_b": { label: "Broad-Spectrum SPF 50", desc: "UVA & UVB ray protection", details: "Shields the skin from ultraviolet radiation, preventing cellular damage, collagen degradation, and sun spots." },

      // sk3: Night Routine
      "sk3_a": { label: "Active Treatment", desc: "Cellular repair and exfoliation", details: "Utilizing the skin's natural nocturnal regeneration cycle to deliver active ingredients that promote cell turnover and repair." },
      "sk3_b": { label: "Barrier Nourishment", desc: "Restorative night creams", details: "Applying rich, occlusive formulations that support skin recovery, soothe inflammation, and restore hydration levels while sleeping." },
      "sk3_a_a": { label: "Retinol / Retinoids", desc: "Vitamin A cellular renewal", details: "Accelerates epidermal cell turnover, stimulates collagen production, fades fine lines, and refines overall skin texture." },
      "sk3_a_b": { label: "AHA/BHA Exfoliants", desc: "Chemical surface smoothing", details: "Gently dissolves the bonds holding dead skin cells together, revealing brighter, smoother skin and enhancing absorption of subsequent products." },
      "sk3_b_a": { label: "Rich Night Cream", desc: "Deep emollient recovery cream", details: "Formulated with heavier lipids, plant oils, and barrier repair factors that work overnight to counteract transepidermal water loss." },
      "sk3_b_b": { label: "Squalane Oil Seal", desc: "Biocompatible occlusive layer", details: "An exceptionally stable, lightweight oil that mimics skin's natural squalene, sealing in moisture without clogging pores." },

      // sk4: Common Concerns
      "sk4_a": { label: "Acne & Breakouts", desc: "Congestion and bacterial control", details: "Addressing inflammatory papules, pustules, and blackheads by clearing pores and reducing acne-causing Propionibacterium acnes." },
      "sk4_b": { label: "Aging & Wrinkles", desc: "Structural collagen depletion", details: "Targeting the breakdown of elastin and collagen caused by chronological aging and photo-damage." },
      "sk4_a_a": { label: "Benzoyl Peroxide", desc: "Antimicrobial acne agent", details: "Introduces oxygen into the pores to kill anaerobic acne bacteria and reduce inflammatory lesions." },
      "sk4_a_b": { label: "Pimple Patches", desc: "Hydrocolloid fluid absorption", details: "Protects active breakouts from external bacteria and finger touching while drawing out its fluids in a moist healing environment." },
      "sk4_b_a": { label: "Peptide Complexes", desc: "Cell-signaling amino chains", details: "Sends messages to skin cells to synthesize new collagen and elastin, restoring firmness and thickness to the dermis." },
      "sk4_b_b": { label: "Collagen Synthesis", desc: "Dermal matrix rebuild", details: "Spurring the biological production of collagen fibers to fill in structural voids, smoothing deep lines and wrinkles." },

      // Fitness Domain
      // ft1: Exercise Types
      "ft1_a": { label: "Resistance Training", desc: "Muscular overload & hypertrophy", details: "Working muscles against external resistance to build myofibrillar density, muscular endurance, and structural strength." },
      "ft1_b": { label: "Cardio & Conditioning", desc: "Aerobic and anaerobic fitness", details: "Elevating the heart rate to strengthen the cardiovascular system, improve VO2 max, and optimize mitochondrial density." },
      "ft1_a_a": { label: "Progressive Overload", desc: "Gradual demand increase", details: "Continuously increasing the training volume, resistance, or frequency over time to force physiological adaptation." },
      "ft1_a_b": { label: "Compound Movements", desc: "Multi-joint strength exercises", details: "Exercises like squats, deadlifts, and presses that recruit multiple muscle groups simultaneously, maximizing neuromuscular coordination." },
      "ft1_b_a": { label: "HIIT (Intervals)", desc: "High intensity interval training", details: "Short bursts of intense work paired with brief recovery periods, driving significant metabolic and anaerobic capacity gains." },
      "ft1_b_b": { label: "LISS (Steady-State)", desc: "Low intensity steady state", details: "Prolonged, moderate-intensity aerobic work that develops baseline cardiovascular efficiency and encourages fat oxidation." },

      // ft2: Nutrition Basics
      "ft2_a": { label: "Macronutrient Breakdown", desc: "Proteins, carbs, and fats ratio", details: "Balancing caloric intake across the three primary energy sources to fuel performance and support tissue recovery." },
      "ft2_b": { label: "Hydrate & Fuel", desc: "Fluid balance and workout timing", details: "Consuming essential fluids, electrolytes, and nutrients at strategic points in the day to optimize muscle performance and hydration." },
      "ft2_a_a": { label: "Protein Synthesis Targets", desc: "Amino acid intake protocols", details: "Consuming adequate protein (typically 1.6-2.2g per kg of bodyweight) to trigger muscle protein synthesis and repair microtears." },
      "ft2_a_b": { label: "Complex Carbohydrates", desc: "Sustained glycogen replenishment", details: "Eating slow-digesting starches like oats, sweet potatoes, and brown rice to maintain stable blood glucose and muscle glycogen stores." },
      "ft2_b_a": { label: "Electrolyte Replenishment", desc: "Sodium, potassium & magnesium", details: "Maintaining intracellular fluid balance to ensure proper muscle contractions and avoid cramping during prolonged exertion." },
      "ft2_b_b": { label: "Pre/Post Workout Timing", desc: "Peri-workout nutrient strategy", details: "Strategically ingesting fast carbs and amino acids before and immediately after training to fuel output and minimize catabolism." },

      // ft3: Goal Setting
      "ft3_a": { label: "Hypertrophy & Strength", desc: "Muscle mass and power focus", details: "Structuring sets, reps, and energy balance to maximize skeletal muscle growth and motor unit recruitment." },
      "ft3_b": { label: "Fat Loss & Endurance", desc: "Leaning out and stamina focus", details: "Tailoring nutritional deficits and metabolic work to preserve lean mass while maximizing lipid mobilization." },
      "ft3_a_a": { label: "Caloric Surplus Focus", desc: "Building positive energy balance", details: "Consuming slightly more calories than burned to provide the necessary energy for synthesis of new contractile tissue." },
      "ft3_a_b": { label: "Weekly Set Volume", desc: "Targeting training volume", details: "Aiming for 10-20 challenging working sets per muscle group per week to stimulate hypertrophic adaptations." },
      "ft3_b_a": { label: "Caloric Deficit Limits", desc: "Controlled fat oxidation", details: "Maintaining a moderate deficit (10-20% below maintenance) to steadily reduce body fat while sparing muscle and preserving hormone health." },
      "ft3_b_b": { label: "Metabolic Conditioning", desc: "Work capacity development", details: "Utilizing dense, high-pace circuits to raise average metabolic rate and maximize aerobic/anaerobic stamina." },

      // ft4: Recovery
      "ft4_a": { label: "Sleep Optimization", desc: "Nocturnal repair mechanisms", details: "Ensuring high-quality deep and REM sleep cycles, which are the absolute foundation of hormone regulation and tissue repair." },
      "ft4_b": { label: "Active Restoration", desc: "Low-intensity recovery methods", details: "Incorporating active recovery, light blood flow, and soft tissue work to alleviate muscle soreness." },
      "ft4_a_a": { label: "Circadian Alignment", desc: "Consistent sleep hygiene", details: "Going to bed and waking up at the same times to stabilize the release of growth hormone, cortisol, and melatonin." },
      "ft4_a_b": { label: "Deep Sleep Cycles", desc: "Physical restoration phase", details: "Prioritizing the slow-wave sleep stages where human growth hormone (HGH) is heavily secreted to rebuild muscle fibers." },
      "ft4_b_a": { label: "Myofascial Release", desc: "Foam rolling & soft tissue", details: "Using foam rollers or massage to break up fascial adhesions, enhance local circulation, and restore movement quality." },
      "ft4_b_b": { label: "Dynamic Stretching", desc: "Mobility & joint restoration", details: "Moving joints through full, controlled ranges of motion to release muscle tension and prevent mechanical tightness." },

      // Cooking Domain
      // ck1: Core Techniques
      "ck1_a": { label: "Dry Heat Cooking", desc: "Searing, roasting & baking", details: "Methods that cook food without water, facilitating surface browning and caramelization for deep, complex flavors." },
      "ck1_b": { label: "Moist Heat Cooking", desc: "Braising, stewing & poaching", details: "Utilizing water, stock, or steam to cook food at lower temperatures, breaking down tough collagen and keeping food moist." },
      "ck1_a_a": { label: "Maillard Reaction Searing", desc: "Amino acid surface browning", details: "A chemical reaction between amino acids and reducing sugars at high temperatures, creating thousands of rich flavor compounds." },
      "ck1_a_b": { label: "High-Temp Roasting", desc: "Convection caramelization", details: "Surrounding food with hot, dry air to roast vegetables or meats, concentrating sugars and producing crispy, flavorful edges." },
      "ck1_b_a": { label: "Low & Slow Braising", desc: "Gentle collagen breakdown", details: "Simmering tough cuts of meat in a small amount of liquid for hours, transforming collagen into rich, velvety gelatin." },
      "ck1_b_b": { label: "Gentle Poaching", desc: "Sub-boiling liquid cooking", details: "Submerging delicate foods like fish or eggs in a liquid maintained between 160-180°F to cook them gently without tearing." },

      // ck2: Ingredient Types
      "ck2_a": { label: "Proteins & Starches", desc: "Core energy & structural elements", details: "Selecting and preparing animal or plant proteins and matching them with grains, tubers, or legumes." },
      "ck2_b": { label: "Aromatics & Acids", desc: "Flavor profiling elements", details: "Using aromatic vegetables and acidic liquids to build depth, cut through fat, and brighten heavy dishes." },
      "ck2_a_a": { label: "Sourcing Quality Proteins", desc: "Selecting fresh cuts & varieties", details: "Understanding meat grades, fish freshness, and plant-based protein options to ensure high-quality, flavorful meals." },
      "ck2_a_b": { label: "Whole Grains & Starches", desc: "Complex carbohydrate bases", details: "Cooking nutrient-rich grains like quinoa, farro, or wild rice, and using potatoes or squash for structured bases." },
      "ck2_b_a": { label: "Mirepoix & Herb Bases", desc: "Onion, celery, carrot foundation", details: "Sweating a mix of aromatics to build a savory, complex aromatic foundation for soups, sauces, and stews." },
      "ck2_b_b": { label: "Vinegars & Citrus Balance", desc: "Acidic finish techniques", details: "Adding drops of lemon juice or high-quality vinegar to a completed dish to stimulate saliva and balance rich flavors." },

      // ck3: Meal Planning
      "ck3_a": { label: "Batch Prep Strategies", desc: "Efficient bulk cooking", details: "Preparing large portions of ingredients or full meals in advance to save time and reduce decision fatigue during busy weeks." },
      "ck3_b": { label: "Nutrient Distribution", desc: "Balanced diet organization", details: "Designing weekly menus to ensure a complete profile of vitamins, minerals, and macronutrients across all meals." },
      "ck3_a_a": { label: "Safe Storage & Freezer Prep", desc: "Airtight portion containment", details: "Using high-quality glass containers and vacuum sealing to preserve food freshness and prevent freezer burn." },
      "ck3_a_b": { label: "Ingredient Cross-Utilization", desc: "Reducing food waste", details: "Planning menus that use the same raw ingredients in multiple, highly distinct dishes to lower costs and waste." },
      "ck3_b_a": { label: "Balanced Portion Sizes", desc: "Visual plate partitioning", details: "Using the 'half plate vegetables, quarter plate protein, quarter plate starch' rule to maintain dietary goals." },
      "ck3_b_b": { label: "Micronutrient Diversity", desc: "Eating the rainbow", details: "Incorporating a wide spectrum of colorful vegetables to secure diverse vitamins, minerals, and antioxidants." },

      // ck4: Safety & Hygiene
      "ck4_a": { label: "Thermal Control", desc: "Temperature danger zones", details: "Ensuring cold foods remain below 40°F and hot foods are cooked to safe internal levels, avoiding active bacterial multiplication." },
      "ck4_b": { label: "Sanitation Standards", desc: "Cross-contamination prevention", details: "Maintaining pristine countertops, knives, and cutting boards, particularly when transitioning between raw meats and ready-to-eat foods." },
      "ck4_a_a": { label: "Avoiding the Danger Zone", desc: "The 40°F - 140°F rule", details: "Restricting the time food sits in the dangerous temperature range where bacteria can double in population in under 20 minutes." },
      "ck4_a_b": { label: "Internal Temp Verification", desc: "Using digital thermometers", details: "Checking meat temperatures at the thickest point (e.g., 165°F for poultry, 145°F for steaks) to guarantee pathogens are destroyed." },
      "ck4_b_a": { label: "Cross-Contamination Checks", desc: "Separating boards & utensils", details: "Designating specific cutting boards for raw meats and fresh produce to eliminate transfer of harmful pathogens." },
      "ck4_b_b": { label: "Deep Surface Sanitizing", desc: "Bleach & active disinfectants", details: "Frequently wiping cooking surfaces and handles with active sanitizers to eliminate microscopic food-borne bacteria." },

      // Artificial Intelligence Domain
      // ai1: Types of AI
      "ai1_a": { label: "Symbolic / Rule-Based AI", desc: "Classical top-down reasoning", details: "Encoding human expertise into logic structures and hardcoded rules to guide decision paths." },
      "ai1_b": { label: "Machine Learning & Neural Nets", desc: "Bottom-up data pattern learning", details: "Training multi-layered mathematical models on massive datasets, letting parameters optimize to map inputs to outputs." },
      "ai1_a_a": { label: "Expert Systems", desc: "Logical inference engines", details: "Uses a compiled knowledge base and a set of IF-THEN rules to mimic the expert judgment of a human specialist." },
      "ai1_a_b": { label: "Knowledge Graphs", desc: "Semantic relational databases", details: "A network of real-world entities and semantic connections, mapping complex structured facts for reasoning engines." },
      "ai1_b_a": { label: "Deep Learning Models", desc: "Multi-layered artificial neural nets", details: "Stacked network nodes (layers) that abstract features of data, enabling highly complex pattern recognition." },
      "ai1_b_b": { label: "Reinforcement Learning", desc: "Reward-based policy training", details: "Training agents in simulated environments by rewarding desired behaviors and punishing failures to learn an optimal policy." },

      // ai2: Real-world Uses
      "ai2_a": { label: "Natural Language Processing", desc: "Human language comprehension", details: "Enabling machines to read, translate, summarize, and generate human languages with high semantic coherence." },
      "ai2_b": { label: "Computer Vision & Robotics", desc: "Spatial environment perception", details: "Processing digital images or sensor feeds to identify objects, calculate spatial depth, and coordinate movement." },
      "ai2_a_a": { label: "Large Language Models", desc: "Transformer-based text engines", details: "Deep autoregressive models trained on massive text corpora to predict the next token, capturing rich human knowledge." },
      "ai2_a_b": { label: "Semantic Search & Translation", desc: "Vector embedding matches", details: "Mapping words and sentences into multi-dimensional coordinate spaces to understand conceptual search intent." },
      "ai2_b_a": { label: "Autonomous Navigation", desc: "SLAM and path planning", details: "Simultaneous Localization and Mapping coupled with path optimization, allowing vehicles or robots to traverse spaces safely." },
      "ai2_b_b": { label: "Object & Face Recognition", desc: "CNN-based visual detection", details: "Using Convolutional Neural Networks (CNNs) to localize and classify human faces or specific objects within frames." },

      // ai3: Key Benefits
      "ai3_a": { label: "Automated Cognition", desc: "Frictionless routine operations", details: "Offloading structured mental labor, search tasks, and complex routing problems to computer models." },
      "ai3_b": { label: "Advanced Predictive Analytics", desc: "Massive scale pattern discovery", details: "Ingesting billions of data points to forecast market trends, equipment failures, or patient health trajectories." },
      "ai3_a_a": { label: "24/7 Virtual Assistants", desc: "Instant semantic customer support", details: "Handling first-tier support queries instantly and contextually, reducing human service backlogs." },
      "ai3_a_b": { label: "Routine Workflow Optimization", desc: "Robotic process automation", details: "Streamlining data transfers, invoice parsing, and administrative pipelines with high reliability." },
      "ai3_b_a": { label: "Pattern Discovery in Big Data", desc: "High-dimensional feature mining", details: "Finding subtle mathematical correlations across thousands of variables that are imperceptible to human analysts." },
      "ai3_b_b": { label: "Proactive Risk Management", desc: "Early warning detection systems", details: "Identifying risk outliers in financial systems, safety valves, or medical telemetry before critical failures occur." },

      // ai4: Risks & Safety
      "ai4_a": { label: "Algorithmic & Data Bias", desc: "Imbalanced training data feedback", details: "When models perpetuate or amplify societal prejudices present in their training data, leading to unfair outcomes." },
      "ai4_b": { label: "AI Alignment & Safety", desc: "Steering models to human values", details: "Ensuring highly autonomous systems remain helpful, harmless, and honest, avoiding unintended adversarial behaviors." },
      "ai4_a_a": { label: "Fairness Metrics", desc: "Mathematical equity measures", details: "Auditing decisions using statistical parity or equalized odds to guarantee model outputs are balanced across subgroups." },
      "ai4_a_b": { label: "Diverse Training Sets", desc: "Representative data sourcing", details: "Broadening data acquisition to prevent localized accuracy drops, building globally balanced inference engines." },
      "ai4_b_a": { label: "Reward Hacking Mitigation", desc: "Preventing exploit loops", details: "Designing resilient reward functions that cannot be satisfied by agents using shortcut strategies that bypass core goals." },
      "ai4_b_b": { label: "Scalable Human Oversight", desc: "Recursive evaluation frameworks", details: "Using AI models to assist human evaluators in reviewing highly advanced systems, managing complex cognitive scaling." },

      // Generic fallback (topic fallback)
      // b1: Core Aspects
      "b1_a": { label: "Foundational Principles", desc: "Underlying structural theories", details: "Core academic, mathematical, or systemic frameworks that govern this domain's rules." },
      "b1_b": { label: "Key Methodologies", desc: "Practical execution standards", details: "Standardized practices, developmental methodologies, and frameworks applied by professionals in this field." },
      "b1_a_a": { label: "Historical Paradigms", desc: "Origins and key evolutions", details: "Tracing the developmental history, historical experiments, and early paradigms that defined this domain." },
      "b1_a_b": { label: "Theoretical Frameworks", desc: "Abstract modeling systems", details: "Abstract theories, axioms, and conceptual blueprints used to model behavior and structure logic." },
      "b1_b_a": { label: "Best Practice Standards", desc: "Industry benchmark guidelines", details: "A collection of highly regarded guidelines, lint rules, or design principles that maximize execution success." },
      "b1_b_b": { label: "Implementation Paradigms", desc: "Standard deployment schemes", details: "How theoretical methodologies are structured, packaged, and executed within live production or physical environments." },

      // b2: Practical Applications
      "b2_a": { label: "Real-world Case Studies", desc: "Demonstrations in production", details: "Examining documented histories of how these concepts are deployed in corporate, clinical, or academic settings." },
      "b2_b": { label: "Development Tools", desc: "Platforms and libraries", details: "The hardware, software tools, programming languages, and frameworks used by practitioners to construct solutions." },
      "b2_a_a": { label: "Enterprise Success Stories", desc: "High scale corporate adoptions", details: "Highlighting massive-scale integrations that demonstrate quantitative efficiency, profit, or speed increases." },
      "b2_a_b": { label: "Niche Deployments", desc: "Custom highly specialized uses", details: "Reviewing specialized edge cases where this concept is engineered to solve unique, narrow problems." },
      "b2_b_a": { label: "Standard Tooling Suite", desc: "Essential compiler/runtime tools", details: "The core, must-have software tools that constitute the basic developer environment for this domain." },
      "b2_b_b": { label: "Open Source Libraries", desc: "Community-maintained repos", details: "Leveraging shared open-source packages to accelerate development and prevent reinvention of common systems." },

      // b3: Challenges & Tradeoffs
      "b3_a": { label: "Resource Bottlenecks", desc: "Physical and financial limits", details: "The constraints regarding compute power, hardware limits, human bandwidth, and capital budgets." },
      "b3_b": { label: "Ethical & Legal Risks", desc: "Compliance and social impacts", details: "Evaluating privacy concerns, systemic job displacement, licensing conflicts, and regulatory compliance standards." },
      "b3_a_a": { label: "Scalability Pitfalls", desc: "Concurrency & load bottlenecks", details: "Understanding why architectures fail when usage volume scales exponentially, and how bottlenecks choke throughput." },
      "b3_a_b": { label: "Budget & Cost Overruns", desc: "Operational margin challenges", details: "The unexpected costs related to computing overheads, server scaling, licensing, or specialized labor." },
      "b3_b_a": { label: "User Privacy Concerns", desc: "Data collection controversies", details: "The trade-offs between collecting rich user profiles to customize experience versus securing personal information." },
      "b3_b_b": { label: "Social & Economic Impacts", desc: "Systemic wealth/power shifts", details: "The long-range implications of this technology on the workforce, regulatory controls, and socio-economic distribution." }
    };

    // Curated database for Level 4 and Level 5 nodes to provide actual, gorgeous concepts
    const DEEP_CORE_NODE_DICTIONARY: Record<string, { label: string; desc: string; details: string }> = {
      // --- SKINCARE DOMAIN (sk) ---
      // sk1: Skin Types -> Oily & Acne-Prone -> Salicylic Acid (BHA)
      "sk1_a_a_a": { label: "Follicular Clearance", desc: "Lipophilic pore cleansing", details: "Beta Hydroxy Acids (BHAs) are lipid-soluble, allowing them to penetrate deep within the sebaceous follicles to dissolve accumulated oil and debris." },
      "sk1_a_a_a_a": { label: "Keratin Dissolution", desc: "Shedding cell bonds", details: "Gently dissolving desmosome protein bridges that hold dead skin cells together, preventing cellular blockages." },
      "sk1_a_a_a_b": { label: "Comedone Reduction", desc: "Targeting active blackheads", details: "Penetrating open pores to dissolve oxidized dark lipids, helping clear out blackheads and refine skin texture." },
      "sk1_a_a_b": { label: "Anti-Inflammatory Calm", desc: "Reducing active acne redness", details: "Inhibiting active inflammatory enzymes to soothe red, swollen acne blemishes and promote rapid skin healing." },
      "sk1_a_a_b_a": { label: "Cytokine Mitigation", desc: "Blocking swelling signals", details: "Halting chemical cellular messengers that trigger swelling, throbbing, and inflammation around active blemishes." },
      "sk1_a_a_b_b": { label: "Erythema Reduction", desc: "Calming vascular flushing", details: "Constricting dilated micro-capillaries around lesions to bring down redness and avoid post-inflammatory marks." },

      // sk1: Skin Types -> Oily & Acne-Prone -> Sebum Regulation
      "sk1_a_b_a": { label: "Niacinamide Synergies", desc: "Oil-control barrier support", details: "Using Vitamin B3 to balance active sebum production while strengthening the skin's moisture barrier." },
      "sk1_a_b_a_a": { label: "Pore Border Elasticity", desc: "Refining skin appearance", details: "Clearing pore debris allows their elastomeric borders to contract, making pores appear smaller and tighter." },
      "sk1_a_b_a_b": { label: "Ceramide Synthesis Boost", desc: "Natural lipid generation", details: "Upregulating key skin enzymes responsible for producing essential lipids, locking in hydration." },
      "sk1_a_b_b": { label: "Zinc PCA Combinations", desc: "Anti-bacterial oil control", details: "Fusing zinc with PCA to control shininess and maintain a matte surface while acting as a light antimicrobial." },
      "sk1_a_b_b_a": { label: "Sebocyte Output Control", desc: "Regulating active oil glands", details: "Targeting and calming hyperactive sebaceous glands to prevent the overproduction of heavy skin oils." },
      "sk1_a_b_b_b": { label: "Propionibacterium Block", desc: "Targeting acne-causing bacteria", details: "Limiting the growth of acne-causing bacteria within pores, stopping red blemishes before they surface." },

      // sk1: Skin Types -> Dry & Sensitive -> Ceramides & Peptides
      "sk1_b_a_a": { label: "Corneum Matrix Repair", desc: "Rebuilding intercellular lipids", details: "Restoring the protective skin barrier to prevent transepidermal water loss and protect against irritation." },
      "sk1_b_a_a_a": { label: "Lipid Ratio Balance", desc: "Ceramides, cholesterol & acids", details: "Replicating the natural 1:1:1 skin lipid ratio of ceramides, cholesterol, and fatty acids for barrier health." },
      "sk1_b_a_a_b": { label: "Acid Mantle Integrity", desc: "Slightly acidic barrier protection", details: "Preserving the skin's optimal pH of 4.5-5.5 to support healthy skin flora and prevent pathogen invasion." },
      "sk1_b_a_b": { label: "Dermal Signal Peptides", desc: "Spurring matrix renewal", details: "Sending amino-acid signals to deep dermal fibroblasts to synthesize new structural proteins." },
      "sk1_b_a_b_a": { label: "Fibroblast Stimulation", desc: "Collagen assembly activation", details: "Activating specialized skin cells responsible for compiling the structural collagen and elastin support network." },
      "sk1_b_a_b_b": { label: "Elastin Grid Building", desc: "Preserving skin elasticity", details: "Synthesizing elastic fibers to maintain skin firmness, preventing sagging and structural thinning." },

      // sk1: Skin Types -> Dry & Sensitive -> Hyaluronic Acid
      "sk1_b_b_a": { label: "Multi-Weight Humectants", desc: "Multi-level moisture binding", details: "Leveraging both high and low molecular weight HA to draw and hold water at various depths of the skin." },
      "sk1_b_b_a_a": { label: "High-Weight Plumping", desc: "Surface moisture reservoir", details: "Forming a breathable moisture-binding film on the skin surface to immediately smooth dehydration lines." },
      "sk1_b_b_a_b": { label: "Low-Weight Penetration", desc: "Epidermal hydration lock", details: "Sizing molecules smaller to penetrate deep within the epidermis, plumping the skin's structural layer." },
      "sk1_b_b_b": { label: "Aquaporin Stimulation", desc: "Water channel facilitation", details: "Supporting the skin's natural water-transport pathways to distribute hydration evenly across cells." },
      "sk1_b_b_b_a": { label: "Cell-to-Cell Transport", desc: "Facilitating hydration channels", details: "Upregulating natural water channels (Aquaporins) to allow optimal moisture passage between epidermal cells." },
      "sk1_b_b_b_b": { label: "Stratum Turgor Density", desc: "Maximizing cell bounce", details: "Elevating internal turgor pressure within the stratum corneum to give skin a plump, firm, and healthy feel." },

      // --- ARTIFICIAL INTELLIGENCE DOMAIN (ai) ---
      // ai1: Types of AI -> Symbolic / Rule-Based -> Expert Systems
      "ai1_a_a_a": { label: "Inference Logic Chaining", desc: "Evaluating rule conditions", details: "Engines that recursively process production rules using forward or backward chaining to draw logical conclusions." },
      "ai1_a_a_a_a": { label: "Forward Data Chaining", desc: "Data-driven rule evaluation", details: "Starting from known facts and applying production rules to derive new facts in a step-by-step logical sequence." },
      "ai1_a_a_a_b": { label: "Backward Goal Chaining", desc: "Goal-driven hypothesis testing", details: "Starting from a hypothesis and working backward to see if there are supporting facts in the database." },
      "ai1_a_a_b": { label: "Knowledge Engineering", desc: "Compiling expert rulesets", details: "The rigorous process of acquiring human expertise and translating it into hardcoded production rules." },
      "ai1_a_a_b_a": { label: "Production Rule IF-THEN", desc: "Structured causal facts", details: "Encoding domain facts in strict declarative rules to form the foundation of deductive expert reasoning." },
      "ai1_a_a_b_b": { label: "Conflict Resolution Rules", desc: "Prioritizing active rules", details: "Applying strategies like specificity, recency, or priority weights to decide which rule fires when multiple match." },

      // ai1: Types of AI -> Machine Learning -> Deep Learning
      "ai1_b_a_a": { label: "Recursive Backpropagation", desc: "Gradient descent weight tuning", details: "Calculating the partial derivative of the loss function with respect to each weight using the mathematical chain rule." },
      "ai1_b_a_a_a": { label: "Loss Function Slopes", desc: "Computing error derivatives", details: "Evaluating the exact directional slope of error metrics to guide weight updates toward zero-error local minima." },
      "ai1_b_a_a_b": { label: "Gradient Descent Updates", desc: "Tuning model parameters", details: "Multiplying gradients by learning rates and subtracting them from weights to steadily improve model accuracy." },
      "ai1_b_a_b": { label: "Transformer Block Layers", desc: "Designing node architectures", details: "Stacking multi-head self-attention and feed-forward networks with layer normalization for high capacity." },
      "ai1_b_a_b_a": { label: "Multi-Head Self-Attention", desc: "Mapping semantic links", details: "Computing dot-product attention scores across queries, keys, and values to capture contextual words relations." },
      "ai1_b_a_b_b": { label: "LayerNorm Stabilization", desc: "Normalizing intermediate outputs", details: "Applying layer normalization to stabilize activation distributions, preventing exploding or vanishing gradients." }
    };

    // Dynamic concept generator for deeper levels (levels 4 and 5)
    const getDynamicConcept = (parentId: string, parentLabel: string, childSuffix: 'a' | 'b', depth: number) => {
      const childId = `${parentId}_${childSuffix}`;

      // 1. Resolve from curated deep dictionary if available
      const curated = DEEP_CORE_NODE_DICTIONARY[childId];
      if (curated) {
        return curated;
      }

      // 2. Fallback: Clean parent of any structural decorators to create clean branches
      let cleanParent = parentLabel
        .replace(/^(Core Mechanisms of|Underlying Principles of|Practical Applications of|Key Tradeoffs & Limits of|Optimizing|Systemic|Advanced|Implementing|Critique\s+of|Future\s+of|Standard|Dynamic|Targeted)\s+/i, '')
        .replace(/\s+(Methods|Systems|Innovations|Paradigms|Frameworks|Tradeoffs|Impact|Standards|Cases|Implications)$/i, '')
        .trim();

      if (childSuffix === 'a') {
        const label = depth === 4 
          ? `Core Mechanisms of ${cleanParent}` 
          : `Underlying Principles of ${cleanParent}`;
        return {
          label: label.length > 40 ? `${cleanParent} Mechanics` : label,
          desc: `Core theoretical dynamics of ${cleanParent}`,
          details: `An in-depth structural exploration of the underlying mechanisms, key formulas, and primary parameters governing ${cleanParent} at level ${depth}.`,
          importance: 'medium' as const
        };
      } else {
        const label = depth === 4 
          ? `Practical Applications of ${cleanParent}` 
          : `Key Tradeoffs & Limits of ${cleanParent}`;
        return {
          label: label.length > 40 ? `${cleanParent} Applications` : label,
          desc: `Real-world impacts and constraints of ${cleanParent}`,
          details: `A comprehensive evaluation of the practical implementations, case studies, operational limits, and critical tradeoffs surrounding ${cleanParent} at level ${depth}.`,
          importance: 'medium' as const
        };
      }
    };

    // Helper to generate sub‑branches for a given parent node
    const generateSubBranches = (parentId: string, parentLabel: string, currentDepth: number, parentX: number, parentY: number) => {
      if (currentDepth >= maxDepth) return;
      const childDepth = currentDepth + 1;
      
      const childAId = `${parentId}_a`;
      const childBId = `${parentId}_b`;
      
      // Decaying vertical spread formula to prevent overlaps across 5 levels of branching
      const verticalSpread = Math.max(8, 130 / Math.pow(2.2, childDepth - 1));
      const childAX = parentX + 260;
      const childAY = parentY - verticalSpread;
      const childBX = parentX + 260;
      const childBY = parentY + verticalSpread;

      // Resolve child A
      let childAData = CORE_NODE_DICTIONARY[childAId];
      if (!childAData) {
        childAData = CATEGORY_NODE_DICTIONARY[childAId];
      }
      if (!childAData) {
        const dynamic = getDynamicConcept(parentId, parentLabel, 'a', childDepth);
        childAData = { label: dynamic.label, desc: dynamic.desc, details: dynamic.details };
      }

      // Resolve child B
      let childBData = CORE_NODE_DICTIONARY[childBId];
      if (!childBData) {
        childBData = CATEGORY_NODE_DICTIONARY[childBId];
      }
      if (!childBData) {
        const dynamic = getDynamicConcept(parentId, parentLabel, 'b', childDepth);
        childBData = { label: dynamic.label, desc: dynamic.desc, details: dynamic.details };
      }

      const childA: MindMapNode = {
        id: childAId,
        type: 'custom',
        data: {
          label: childAData.label,
          description: childAData.desc,
          depth: childDepth,
          details: childAData.details,
          importance: 'medium'
        },
        position: { x: childAX, y: childAY }
      };

      const childB: MindMapNode = {
        id: childBId,
        type: 'custom',
        data: {
          label: childBData.label,
          description: childBData.desc,
          depth: childDepth,
          details: childBData.details,
          importance: 'medium'
        },
        position: { x: childBX, y: childBY }
      };

      nodes.push(childA, childB);
      edges.push({ id: `e_${parentId}_${childAId}`, source: parentId, target: childAId, animated: true });
      edges.push({ id: `e_${parentId}_${childBId}`, source: parentId, target: childBId, animated: true });

      // Recursively generate deeper branches
      generateSubBranches(childAId, childA.data.label, childDepth, childAX, childAY);
      generateSubBranches(childBId, childB.data.label, childDepth, childBX, childBY);
    };

    // Determine primary branches based on domain or AI
    const isAI = topic.toLowerCase().includes('ai') || topic.toLowerCase().includes('intelligence') || topic.toLowerCase().includes('llm') || topic.toLowerCase().includes('agent');
    const lowerTopic = topic.toLowerCase();
    const lifestyleDomains: Record<string, { branches: Array<{ id: string; label: string; desc: string; x: number; y: number; depth: number; importance: 'high' | 'medium' | 'low'; details: string }> }> = {
      skincare: {
        branches: [
          { id: 'sk1', label: 'Skin Types', desc: 'Normal, oily, dry, combination', x: 260, y: -180, depth: 1, importance: 'high', details: 'Common skin classifications based on sebum production and barrier function.' },
          { id: 'sk2', label: 'Morning Routine', desc: 'Cleansing, serum, moisturizer, sunscreen', x: 260, y: -50, depth: 1, importance: 'medium', details: 'Typical steps to prepare skin for the day and protect against UV.' },
          { id: 'sk3', label: 'Night Routine', desc: 'Cleanse, treatment, night cream', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Steps focused on repair, hydration, and barrier restoration overnight.' },
          { id: 'sk4', label: 'Common Concerns', desc: 'Acne, aging, hyperpigmentation', x: 260, y: 210, depth: 1, importance: 'high', details: 'Frequent issues addressed by targeted ingredients and regimens.' }
        ]
      },
      fitness: {
        branches: [
          { id: 'ft1', label: 'Exercise Types', desc: 'Cardio, strength, flexibility', x: 260, y: -180, depth: 1, importance: 'high', details: 'Broad categories of physical activity for overall health.' },
          { id: 'ft2', label: 'Nutrition Basics', desc: 'Macronutrients, timing, hydration', x: 260, y: -50, depth: 1, importance: 'medium', details: 'Fundamental dietary principles supporting fitness goals.' },
          { id: 'ft3', label: 'Goal Setting', desc: 'Weight loss, muscle gain, endurance', x: 260, y: 80, depth: 1, importance: 'high', details: 'Specific objectives shaping training programs.' },
          { id: 'ft4', label: 'Recovery', desc: 'Sleep, stretching, rest days', x: 260, y: 210, depth: 1, importance: 'medium', details: 'Practices to prevent overtraining and injuries.' }
        ]
      },
      cooking: {
        branches: [
          { id: 'ck1', label: 'Core Techniques', desc: 'Sauté, bake, grill, stew', x: 260, y: -180, depth: 1, importance: 'high', details: 'Fundamental cooking methods across cuisines.' },
          { id: 'ck2', label: 'Ingredient Types', desc: 'Proteins, vegetables, grains, spices', x: 260, y: -50, depth: 1, importance: 'high', details: 'Categories of foods defining recipe composition.' },
          { id: 'ck3', label: 'Meal Planning', desc: 'Breakfast, lunch, dinner, prep', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Organizing dishes across the day/week for nutritional balance.' },
          { id: 'ck4', label: 'Safety & Hygiene', desc: 'Storage, temperature, cross‑contamination', x: 260, y: 210, depth: 1, importance: 'high', details: 'Critical practices to prevent food‑borne illness.' }
        ]
      }
    };

    const matchedDomain = Object.keys(lifestyleDomains).find(d => lowerTopic.includes(d));
    if (matchedDomain) {
      const domainInfo = lifestyleDomains[matchedDomain];
      domainInfo.branches.forEach(b => {
        nodes.push({
          id: b.id,
          type: 'custom',
          data: { label: b.label, description: b.desc, depth: b.depth, details: b.details, importance: b.importance },
          position: { x: b.x, y: b.y }
        });
        edges.push({ id: `e_root_${b.id}`, source: 'root', target: b.id, animated: true });
        // Generate sub‑branches recursively using its parent position
        generateSubBranches(b.id, b.label, b.depth, b.x, b.y);
      });
    } else if (isAI) {
      const branches = [
        { id: 'ai1', label: 'Types of AI', desc: 'Symbolic vs Machine Learning', x: 280, y: -150, depth: 1, importance: 'medium' as const, details: 'AI splits into symbolic (rule‑based) and connectionist (neural) paradigms.' },
        { id: 'ai2', label: 'Real‑world Uses', desc: 'Everyday applications', x: 280, y: -50, depth: 1, importance: 'medium' as const, details: 'Search, translation, predictive text, medical diagnosis, routing.' },
        { id: 'ai3', label: 'Key Benefits', desc: 'Why AI is transformative', x: 280, y: 50, depth: 1, importance: 'medium' as const, details: 'Productivity, automation, massive data processing.' },
        { id: 'ai4', label: 'Risks & Safety', desc: 'Common issues and constraints', x: 280, y: 150, depth: 1, importance: 'medium' as const, details: 'Bias, privacy, job displacement, alignment.' }
      ];
      branches.forEach(b => {
        nodes.push({
          id: b.id,
          type: 'custom',
          data: { label: b.label, description: b.desc, depth: b.depth, details: b.details, importance: b.importance as 'high' | 'medium' | 'low' },
          position: { x: b.x, y: b.y }
        });
        edges.push({ id: `e_root_${b.id}`, source: 'root', target: b.id, animated: true });
        generateSubBranches(b.id, b.label, b.depth, b.x, b.y);
      });
    } else {
      // Detect the category of the custom topic
      const category = detectCategory(topic);
      let branches: Array<{ id: string; label: string; desc: string; x: number; y: number; depth: number; importance: 'high' | 'medium' | 'low'; details: string }> = [];

      if (category === 'health') {
        branches = [
          { id: 'hlth1', label: 'Nutritional Foundations', desc: 'Essential nutrients, macro & micro balance', x: 260, y: -180, depth: 1, importance: 'high', details: 'Understanding the building blocks of healthy eating, including vitamins, minerals, proteins, healthy fats, and carbohydrates tailored to this topic.' },
          { id: 'hlth2', label: 'Daily Meal Planning', desc: 'Practical schedules and recipes', x: 260, y: -50, depth: 1, importance: 'medium', details: 'Constructing balanced, delicious, and age-appropriate meals throughout the day, focusing on consistent schedules and food variety.' },
          { id: 'hlth3', label: 'Healthy Habits & Education', desc: 'Fostering positive relationships with food', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Techniques for introducing new foods, establishing mindful eating practices, and educating on long-term wellness habits.' },
          { id: 'hlth4', label: 'Common Challenges & Solutions', desc: 'Overcoming picky eating and allergies', x: 260, y: 210, depth: 1, importance: 'high', details: 'Practical strategies to address common nutritional struggles, dietary restrictions, food sensitivities, and selective eating behaviors.' }
        ];
      } else if (category === 'tech') {
        branches = [
          { id: 'tech1', label: 'Core Architecture & Logic', desc: 'System design and foundational concepts', x: 260, y: -180, depth: 1, importance: 'high', details: 'Analyzing the structural pillars, core mathematical or algorithmic logic, and fundamental paradigms of this technology.' },
          { id: 'tech2', label: 'Practical Implementations', desc: 'Frameworks, tools, and code patterns', x: 260, y: -50, depth: 1, importance: 'high', details: 'Exploring popular open-source libraries, tooling environments, and real-world implementation methodologies.' },
          { id: 'tech3', label: 'Performance Optimization', desc: 'Scaling, latency, and resource limits', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Strategies for maximizing execution speed, tuning memory usage, and avoiding scaling bottlenecks.' },
          { id: 'tech4', label: 'Challenges & Future Trends', desc: 'Security, trade-offs, and next-gen tech', x: 260, y: 210, depth: 1, importance: 'high', details: 'Evaluating technical debt, modern security threats, compliance standards, and emergent industry directions.' }
        ];
      } else if (category === 'creative') {
        branches = [
          { id: 'crtv1', label: 'Theoretical & Historical Foundations', desc: 'Origins, movements, and key concepts', x: 260, y: -180, depth: 1, importance: 'high', details: 'Investigating the historical evolution, philosophical frameworks, and creative movements that shaped this domain.' },
          { id: 'crtv2', label: 'Creative Techniques & Mediums', desc: 'Skills, tools, and practical execution', x: 260, y: -50, depth: 1, importance: 'high', details: 'Delving into standard artistic practices, tools of the trade, and specific technical skills required for mastery.' },
          { id: 'crtv3', label: 'Style & Composition Analysis', desc: 'Structure, form, and aesthetics', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Exploring elements of composition, structural design patterns, and aesthetic principles that make works compelling.' },
          { id: 'crtv4', label: 'Modern Expression & Adaptations', desc: 'Contemporary uses and digital shifts', x: 260, y: 210, depth: 1, importance: 'high', details: 'Analyzing how traditional techniques adapt to digital mediums, modern audiences, and cross-disciplinary collaborations.' }
        ];
      } else if (category === 'business') {
        branches = [
          { id: 'biz1', label: 'Strategic Foundations', desc: 'Market dynamics and business models', x: 260, y: -180, depth: 1, importance: 'high', details: 'Analyzing market opportunities, value propositions, and foundational business design systems.' },
          { id: 'biz2', label: 'Operational Execution', desc: 'Tactics, workflows, and resource allocation', x: 260, y: -50, depth: 1, importance: 'high', details: 'Exploring functional workflows, team coordination, sales cycles, and standard operational protocols.' },
          { id: 'biz3', label: 'Financial Growth & Risk', desc: 'Revenue models, metrics, and compliance', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Structuring unit economics, funding strategies, pricing models, and key risk mitigation frameworks.' },
          { id: 'biz4', label: 'Scaling & Global Expansion', desc: 'Growth hacking and internationalization', x: 260, y: 210, depth: 1, importance: 'high', details: 'Strategies for customer acquisition, organizational scaling, international expansion, and long-term brand building.' }
        ];
      } else {
        branches = [
          { id: 'gen1', label: 'Core Fundamentals', desc: 'Origins, rules, and basic terms', x: 260, y: -180, depth: 1, importance: 'high', details: 'Getting started with the foundational terminology, history, rules, and basic equipment or skills.' },
          { id: 'gen2', label: 'Practical Techniques', desc: 'Daily activities and hands-on exercises', x: 260, y: -50, depth: 1, importance: 'high', details: 'Step-by-step methods, skills, and activities required to put these concepts into practice.' },
          { id: 'gen3', label: 'Key Benefits & Growth', desc: 'Mental, physical, and social impacts', x: 260, y: 80, depth: 1, importance: 'medium', details: 'Understanding the primary advantages, milestones of progress, and positive impacts of this pursuit.' },
          { id: 'gen4', label: 'Common Barriers & Solutions', desc: 'Troubleshooting mistakes and challenges', x: 260, y: 210, depth: 1, importance: 'high', details: 'Overcoming standard plateaus, resource limitations, common errors, and practical troubleshooting steps.' }
        ];
      }

      branches.forEach(b => {
        nodes.push({
          id: b.id,
          type: 'custom',
          data: { label: b.label, description: b.desc, depth: b.depth, details: b.details, importance: b.importance as 'high' | 'medium' | 'low' },
          position: { x: b.x, y: b.y }
        });
        edges.push({ id: `e_root_${b.id}`, source: 'root', target: b.id, animated: true });
        generateSubBranches(b.id, b.label, b.depth, b.x, b.y);
      });
    }

    return { nodes, edges };
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
}
