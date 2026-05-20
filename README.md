# Agentic Mind Mapping System - MVP v1.0

A visually stunning, production-ready multi-agent brainstorming and knowledge-structuring platform. Users enter a complex topic or thesis prompt, and a highly coordinated squad of specialized cognitive agents think collaboratively, critique structural blind spots, formulate learning paths, and render an interactive, beautiful concept graph in real-time.

Designed with **visible orchestration**, **workflow transparency**, and **adaptive human-in-the-loop interaction**.

---

## 🏗️ Folder Architecture

```text
Mind-Map-V3/
├── package.json                   # Root private monorepo launcher (runs concurrently)
├── README.md                      # Comprehensive systems walkthrough & setup
├── backend/
│   ├── package.json               # Backend dependencies (Express, ws, generative-ai)
│   ├── tsconfig.json              # TypeScript compilation configuration
│   ├── .env                       # Environment configuration (Gemini API configuration)
│   └── src/
│       ├── index.ts               # Port launcher entrypoint
│       ├── server.ts              # Express initialization & WebSocket connection manager
│       ├── services/
│       │   └── GeminiService.ts   # Google Gemini API & agent simulation engine
│       ├── orchestrator/
│       │   ├── types.ts           # Central orchestrator states & shared memory models
│       │   └── Orchestrator.ts    # Sequential cognitive workflow pipeline engine
│       └── agents/
│           ├── BaseAgent.ts       # Standardized abstract cognitive agent
│           ├── ClarityAgent.ts    # Context diagnostic & adaptive questioning agent
│           ├── IntentAgent.ts     # Cognitive intent & depth diagnostic agent
│           ├── ExpansionAgent.ts  # Domain boundary & lateral concept expansion agent
│           ├── StructureAgent.ts  # Semantic tree hierarchy & learning flow architect
│           ├── GenerationAgent.ts # Coordinate placement & React Flow graph generator
│           ├── ReflectionAgent.ts # Self-critique, tradeoffs & contradiction agent
│           └── MemoryAgent.ts     # Session summary & long-running compression agent
└── frontend/
    ├── package.json               # Frontend dependencies (Next.js 16, React Flow, framer-motion)
    ├── src/
    │   ├── components/
    │   │   └── MindMapNode.tsx    # Beautiful custom React Flow node with depth themes & tradeoff badges
    │   └── app/
    │       ├── layout.tsx         # Page layouts with Geist typography & SEO compliance
    │       ├── globals.css        # React Flow custom stylesheets & glassmorphic aesthetics
    │       └── page.tsx           # Client-side multi-agent dashboard & controls
```

---

## 🤖 Modular Multi-Agent Cognitive Breakdown

The system implements 7 specialized, modular agents communicating through a centralized **Shared Memory Architecture**:

1. **Context Clarity Agent (`ClarityAgent`)**: Detects early topic ambiguity and generates exactly 3 dynamic, context-aware clarifying questions, along with rationales of why each question is being asked.
2. **Intent Extraction Agent (`IntentAgent`)**: Diagnoses explicit goals, preferred learning styles, prior expertise levels, and determines the requested exploration depth (from Surface to Strategic).
3. **Knowledge Expansion Agent (`ExpansionAgent`)**: Discovers adjacencies, surfaces hidden branches, and outlines lateral interdisciplinary perspectives that a single-prompt model would omit.
4. **Structure Planning Agent (`StructureAgent`)**: Establishes parent-child relationships, designs semantic clusters (Core Foundations, Advanced Methodologies, Implications), and creates a logical pedagogical flow.
5. **Mind Map Generation Agent (`GenerationAgent`)**: Computes two-dimensional spatial coordinate arrangements on a neat tree layout and generates interactive, custom React Flow node/edge structures.
6. **Reflection Agent (`ReflectionAgent`)**: Critiques the final map layout, identifying theoretical omissions, presenting severe system tradeoffs, and introducing central paradoxes to challenge the user's synthesis.
7. **Memory / Compression Agent (`MemoryAgent`)**: Runs background compression algorithms to condense long-running chat histories, ensuring seamless memory and token efficiency over long sessions.

---

## ⚡ Execution Pacing & Workflow Engine

The central **Orchestrator** operates with state tracking (`idle`, `running`, `waiting`, `completed`, `failed`), sequentially triggering cognitive blocks:

* **Phase 1: Ambiguity Diagnosis**: User enters a topic $\rightarrow$ Clarity Agent fires $\rightarrow$ Pipeline pauses in `waiting` state for human input.
* **Phase 2: Human-in-the-Loop Resumption**: User submits clarifying answers $\rightarrow$ Orchestrator coordinates subsequent agents sequentially $\rightarrow$ Triggers live WebSocket streams $\rightarrow$ UI animates workflow progress bar and completes with standard canvas-confetti.
* **Phase 3: Iterative Refinement**: User sends instructions $\rightarrow$ Core agents recalculate coordinates $\rightarrow$ Rerenders the tree live.

---

## 💎 Design & UI Aesthetics

* **Glassmorphism Panels**: Dark mode backgrounds, fine borders (`rgba(255,255,255,0.08)`), high-definition blurs (`backdrop-filter`).
* **Animated Node-Paths**: Flowing edge animations and running glows around active thinking agents.
* **Semantic Custom Nodes**: Unique visual themes, color-coded borders representing depth hierarchy, custom handles, and warnings for nodes with tradeoffs.
* **Right Panel Drawer**: Inspecting a selected node displays detailed explanations and tradeoffs.

---

## 🚀 Quick Setup & Installation

### 1. Prerequisite
Ensure **Node.js v20+** is installed on your computer.

### 2. Install dependencies
Run the automated monorepo script from the workspace root:
```bash
npm run install:all
```

### 3. Google Gemini API Configuration (Optional)
Create `backend/.env` file and insert your API key:
```env
GOOGLE_API_KEY=your_gemini_api_key_here
PORT=3001
```
*Note: If the key is left empty, the platform automatically boots into **Agent Simulation Mode** to guarantee a fully functional, zero-error first launch!*

### 4. Fire up the platform
Execute the following dev command at the root directory:
```bash
npm run dev
```
Both the Next.js client (`localhost:3000`) and the WebSocket engine server (`localhost:3001`) will launch concurrently!
