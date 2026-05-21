'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeMouseHandler
} from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  Play,
  RotateCcw,
  Share2,
  Brain,
  Loader2,
  MessageSquare,
  Check,
  ArrowRight,
  Scale,
  Sparkles,
  AlertCircle,
  ZoomIn,
  Send,
  ChevronDown,
  Target,
  Layers,
  Lightbulb,
  History
} from 'lucide-react';

import { MindMapNode } from '../components/MindMapNode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClarifyingQuestion {
  id: string;
  question: string;
  rationale: string;
  options?: string[];
}

interface AgentExecutionLog {
  timestamp: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  message: string;
  thought?: string;
  duration?: number;
}

interface SkillIntentResult {
  topic: string;
  intent: 'learning' | 'planning' | 'brainstorming' | 'research' | 'problem-solving';
  depth: 'basic' | 'detailed' | 'deep';
  clarifications: string[];
  userGoal: string;
  confidence: number;
}

interface SharedMemory {
  originalInput: string;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifyingAnswers: { questionId: string; questionText: string; answerText: string }[];
  compressedSummary: string;
  mindMap?: { nodes: any[]; edges: any[] };
  skillIntentResult?: SkillIntentResult;
}

interface OrchestratorState {
  memory: SharedMemory;
  status: {
    state: 'idle' | 'running' | 'waiting' | 'completed' | 'failed';
    activeAgentId: string | null;
    completedAgentIds: string[];
    logs: AgentExecutionLog[];
  };
}

interface NodeAnswer {
  nodeId: string;
  question: string;
  answer: string;
}

// ─── Skill metadata ───────────────────────────────────────────────────────────

const SKILL_METADATA = [
  {
    id: 'intent-clarifier',
    name: 'Intent Clarifier',
    color: 'border-amber-500 text-amber-400',
    description: 'Understands what you are trying to do'
  },
  {
    id: 'knowledge-architect',
    name: 'Knowledge Architect',
    color: 'border-indigo-500 text-indigo-400',
    description: 'Builds the semantic mind map structure'
  },
  {
    id: 'exploration',
    name: 'Exploration',
    color: 'border-teal-500 text-teal-400',
    description: 'Dynamically deepens selected nodes'
  },
  {
    id: 'node-conversation',
    name: 'Node Conversation',
    color: 'border-purple-500 text-purple-400',
    description: 'Answers questions about map nodes'
  }
];

const INTENT_COLORS: Record<string, string> = {
  learning: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  planning: 'bg-green-500/20 text-green-300 border-green-500/30',
  brainstorming: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  research: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'problem-solving': 'bg-rose-500/20 text-rose-300 border-rose-500/30'
};

const nodeTypes = { custom: MindMapNode };

// ─── App ──────────────────────────────────────────────────────────────────────

export default function AgenticMindMapApp() {
  const [topicInput, setTopicInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState>({
    memory: {
      originalInput: '',
      clarifyingQuestions: [],
      clarifyingAnswers: [],
      compressedSummary: 'Awaiting topic to begin.'
    },
    status: { state: 'idle', activeAgentId: null, completedAgentIds: [], logs: [] }
  });

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<string, string>>({});
  const [nodeQuestion, setNodeQuestion] = useState('');
  const [nodeAnswers, setNodeAnswers] = useState<NodeAnswer[]>([]);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [maxVisibleDepth, setMaxVisibleDepth] = useState<number | 'all'>('all');
  const [logFilter, setLogFilter] = useState<'all' | 'thoughts'>('all');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const previousStateRef = useRef<string>('idle');

  // Filtered nodes / edges by depth
  const visibleNodes = React.useMemo(() => {
    if (maxVisibleDepth === 'all') return nodes;
    return nodes.filter((n: any) => (n.data?.depth ?? 0) <= maxVisibleDepth);
  }, [nodes, maxVisibleDepth]);

  const visibleEdges = React.useMemo(() => {
    if (maxVisibleDepth === 'all') return edges;
    return edges.filter((e: any) => {
      const src = nodes.find((n: any) => n.id === e.source) as any;
      const tgt = nodes.find((n: any) => n.id === e.target) as any;
      return (src?.data?.depth ?? 0) <= maxVisibleDepth && (tgt?.data?.depth ?? 0) <= maxVisibleDepth;
    });
  }, [edges, nodes, maxVisibleDepth]);

  // API is co-located — always connected
  useEffect(() => {
    setIsConnected(true);
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // ─── SSE streaming helper ──────────────────────────────────────────────────
  const streamWorkflow = useCallback(async (
    topic: string,
    answers?: { questionId: string; questionText: string; answerText: string }[]
  ) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, answers }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setErrorMsg('Failed to reach the AI service. Please try again.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'STATE_UPDATE') {
              const newState = event.state as OrchestratorState;
              if (newState.status.state === 'completed' && previousStateRef.current !== 'completed') {
                confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ['#6366f1', '#10b981', '#f59e0b', '#ec4899'] });
              }
              previousStateRef.current = newState.status.state;
              setOrchestratorState(newState);
              if (newState.memory.mindMap) {
                setNodes(newState.memory.mindMap.nodes as any);
                setEdges(newState.memory.mindMap.edges as any);
              }
            } else if (event.type === 'ERROR') {
              setErrorMsg(event.message);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMsg('Connection failed. Please try again.');
      }
    }
  }, [setNodes, setEdges]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [orchestratorState.status.logs]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleStartWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim()) return;
    setErrorMsg(null);
    setSelectedNode(null);
    setClarifyingAnswers({});
    setNodeAnswers([]);
    streamWorkflow(topicInput);
  };

  const handleSubmitAnswers = () => {
    const questions = orchestratorState.memory.clarifyingQuestions;
    const complete = questions.length > 0 && questions.every(q => clarifyingAnswers[q.id]?.trim());
    if (!complete) return;
    const answers = questions.map(q => ({ questionId: q.id, questionText: q.question, answerText: clarifyingAnswers[q.id] }));
    streamWorkflow(orchestratorState.memory.originalInput, answers);
  };

  const handleExpandNode = async () => {
    if (!selectedNode) return;
    const depth = orchestratorState.memory.skillIntentResult?.depth ?? 'detailed';
    const parentTopic = orchestratorState.memory.originalInput;

    setOrchestratorState(prev => ({
      ...prev,
      status: { ...prev.status, state: 'running', activeAgentId: 'exploration' as any },
    }));

    try {
      const response = await fetch('/api/node/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: selectedNode.id,
          nodeLabel: (selectedNode.data as any).label,
          parentTopic,
          depth,
          parentPosition: (selectedNode as any).position,
          parentDepth: (selectedNode.data as any).depth ?? 1,
        }),
      });
      const data = await response.json();
      if (data.newNodes && data.newEdges) {
        setNodes([...nodes, ...data.newNodes] as any);
        setEdges([...edges, ...data.newEdges] as any);
      }
    } catch {
      setErrorMsg('Failed to expand node. Please try again.');
    } finally {
      setOrchestratorState(prev => ({
        ...prev,
        status: { ...prev.status, state: 'completed', activeAgentId: null },
      }));
    }
  };

  const handleAskNodeQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeQuestion.trim() || !selectedNode) return;
    setIsAskingQuestion(true);
    const question = nodeQuestion;
    setNodeQuestion('');

    try {
      const response = await fetch('/api/node/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: selectedNode.id,
          nodeLabel: (selectedNode.data as any).label,
          parentTopic: orchestratorState.memory.originalInput,
          question,
        }),
      });
      const data = await response.json();
      setNodeAnswers(prev => [data as NodeAnswer, ...prev.filter(a => a.nodeId !== data.nodeId || a.question !== data.question)]);
    } catch {
      setErrorMsg('Failed to get an answer. Please try again.');
    } finally {
      setIsAskingQuestion(false);
    }
  };

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setTopicInput('');
    setClarifyingAnswers({});
    setSelectedNode(null);
    setNodes([]);
    setEdges([]);
    setNodeAnswers([]);
    setNodeQuestion('');
    previousStateRef.current = 'idle';
    setOrchestratorState({
      memory: { originalInput: '', clarifyingQuestions: [], clarifyingAnswers: [], compressedSummary: 'Awaiting topic to begin.' },
      status: { state: 'idle', activeAgentId: null, completedAgentIds: [], logs: [] }
    });
  };

  const handleExport = () => {
    if (!orchestratorState.memory.mindMap) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(orchestratorState.memory, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `mind-map-${orchestratorState.memory.originalInput.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node);
    // Clear previous answer for this node when switching
  }, []);

  const activeAgent = orchestratorState.status.activeAgentId;
  const workflowState = orchestratorState.status.state;
  const intentResult = orchestratorState.memory.skillIntentResult;

  // Find the most recent answer for the currently selected node
  const currentNodeAnswer = selectedNode
    ? nodeAnswers.find(a => a.nodeId === selectedNode.id) ?? null
    : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen text-zinc-100 bg-[#09090b]">

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
            <Brain className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-md font-bold tracking-tight text-white flex items-center gap-2">
              Agentic Mind Mapping System
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                4 Skills
              </span>
            </h1>
            <p className="text-xs text-zinc-500">Modular AI skill pipeline: Intent → Architect → Explore → Converse</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-zinc-400">{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex gap-2 items-center">
            {orchestratorState.memory.mindMap && (
              <div className="flex items-center gap-1.5 mr-1">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Depth:</span>
                <select
                  value={maxVisibleDepth}
                  onChange={(e) => setMaxVisibleDepth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">All Levels</option>
                  <option value="0">Root Only</option>
                  <option value="1">Level 1</option>
                  <option value="2">Level 2</option>
                  <option value="3">Level 3</option>
                  <option value="4">Level 4</option>
                </select>
              </div>
            )}
            {orchestratorState.memory.mindMap && (
              <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
                <Share2 className="w-3.5 h-3.5" /> Export
              </button>
            )}
            <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN LAYOUT ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL: Skill Timeline ───────────────────────────────────── */}
        <aside className="w-96 border-r border-zinc-800/80 bg-zinc-950/40 flex flex-col shrink-0 z-20">
          <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Skill Timeline</h2>
            </div>
            <div className="flex rounded-md bg-zinc-900 p-0.5 border border-zinc-800">
              <button onClick={() => setLogFilter('all')} className={`px-2 py-0.5 text-[10px] font-semibold rounded ${logFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>Logs</button>
              <button onClick={() => setLogFilter('thoughts')} className={`px-2 py-0.5 text-[10px] font-semibold rounded ${logFilter === 'thoughts' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>Thoughts</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {workflowState === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-zinc-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-300">4 AI Skills Ready</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[220px] leading-relaxed">
                    Enter a topic to trigger the skill pipeline: Intent → Architect → Explore → Converse
                  </p>
                </div>
                {/* Skill cards preview */}
                <div className="w-full space-y-2">
                  {SKILL_METADATA.map(s => (
                    <div key={s.id} className={`p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-left`}>
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{s.name}</span>
                      <p className="text-[10px] text-zinc-600 mt-0.5">{s.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {workflowState !== 'idle' && (
              <div className="space-y-4">
                {/* Skill progress bar */}
                <div className="grid grid-cols-4 gap-1 p-2 bg-zinc-900/50 rounded-xl border border-zinc-800/80">
                  {SKILL_METADATA.map(s => {
                    const completed = orchestratorState.status.completedAgentIds.includes(s.id);
                    const running = activeAgent === s.id;
                    return (
                      <div key={s.id} title={s.name} className={`h-2.5 rounded-full transition-all duration-300 ${running ? 'bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse ring-2 ring-indigo-500/30' : completed ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
                    );
                  })}
                </div>

                {/* Intent result badge */}
                {intentResult && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Resolved Intent</span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold uppercase ${INTENT_COLORS[intentResult.intent]}`}>{intentResult.intent}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded border bg-zinc-800 text-zinc-300 border-zinc-700 font-semibold uppercase">{intentResult.depth}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded border bg-zinc-800 text-zinc-300 border-zinc-700">{(intentResult.confidence * 100).toFixed(0)}% confidence</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">{intentResult.userGoal}</p>
                  </motion.div>
                )}

                {/* Logs */}
                <div className="space-y-4 relative pl-3 border-l border-zinc-800/80">
                  {orchestratorState.status.logs
                    .filter(log => logFilter === 'all' || (logFilter === 'thoughts' && log.thought))
                    .map((log, i) => {
                      const meta = SKILL_METADATA.find(s => s.id === log.agentId);
                      const isComplete = log.status === 'completed';
                      const isFailed = log.status === 'failed';
                      return (
                        <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="relative space-y-1.5">
                          <div className={`absolute -left-[17px] top-1 w-2 h-2 rounded-full border ${isComplete ? 'bg-emerald-500 border-emerald-500' : isFailed ? 'bg-rose-500 border-rose-500' : 'bg-indigo-500 border-indigo-500 animate-pulse'}`} />
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-zinc-300">{meta?.name || log.agentId}</span>
                            {log.duration && <span className="text-[10px] text-zinc-500 font-mono">{(log.duration / 1000).toFixed(2)}s</span>}
                          </div>
                          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800/70 text-xs text-zinc-300 leading-relaxed">
                            {log.message}
                            {log.thought && (
                              <div className="mt-2.5 pt-2.5 border-t border-zinc-800">
                                <div className="flex items-center text-[10px] text-indigo-400 font-semibold tracking-wider uppercase mb-1">
                                  <Brain className="w-3 h-3 mr-1" /> Skill Trace
                                </div>
                                <p className="text-[11px] text-zinc-400 font-mono italic leading-relaxed">"{log.thought}"</p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}

                  {activeAgent && (
                    <motion.div className="relative space-y-1.5" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, repeat: Infinity }}>
                      <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                      <div className="text-[11px] font-bold text-indigo-400">
                        {SKILL_METADATA.find(s => s.id === activeAgent)?.name ?? activeAgent} Running...
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-900/60 border border-indigo-500/20 text-xs text-zinc-400 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                        Processing...
                      </div>
                    </motion.div>
                  )}
                  <div ref={logsEndRef} />
                </div>

                {/* Compressed memory */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Session Memory</h3>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-400 bg-zinc-950/50 border border-zinc-900 p-2.5 rounded-lg font-mono">
                    {orchestratorState.memory.compressedSummary}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── CENTER PANEL: Canvas ─────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col relative bg-[#09090b] overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#141416_1px,transparent_1px),linear-gradient(to_bottom,#141416_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] pointer-events-none" />

          {/* Idle start screen */}
          {workflowState === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center p-6 z-10">
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-xl p-8 rounded-3xl border border-zinc-800/80 bg-zinc-900/80 shadow-2xl text-center space-y-6"
              >
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                  <Brain className="w-8 h-8 text-indigo-400 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-extrabold text-white tracking-tight">Agentic Mind Mapping</h2>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                    Enter any topic. 4 modular AI skills — Intent Clarifier, Knowledge Architect, Exploration, and Node Conversation — collaborate to build your interactive mind map.
                  </p>
                </div>
                <form onSubmit={handleStartWorkflow} className="flex gap-2">
                  <input
                    type="text"
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    placeholder="e.g., Artificial Intelligence, Fitness, Climate Change..."
                    className="flex-1 px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={!isConnected || !topicInput.trim()}
                    className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold text-sm transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] flex items-center gap-1.5"
                  >
                    Generate <Play className="w-4 h-4" />
                  </button>
                </form>
                {errorMsg && (
                  <p className="text-xs text-rose-400 flex items-center gap-1.5 justify-center">
                    <AlertCircle className="w-4 h-4 shrink-0" />{errorMsg}
                  </p>
                )}
              </motion.div>
            </div>
          )}

          {/* ReactFlow canvas */}
          {workflowState !== 'idle' && (
            <div className="flex-1 w-full h-full z-10">
              <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.15}
                maxZoom={1.5}
              >
                <Background color="#1f2937" gap={56} size={1} />
                <Controls className="bg-zinc-900 border-zinc-800 fill-zinc-400" />
                <MiniMap
                  style={{ background: '#09090b', border: '1px solid #27272a' }}
                  nodeColor={(n) => { const d = (n.data as any)?.depth ?? 0; return d === 0 ? '#6366f1' : d === 1 ? '#14b8a6' : '#27272a'; }}
                  maskColor="rgba(0,0,0,0.6)"
                />
              </ReactFlow>

              {/* Canvas hint */}
              <div className="absolute top-4 left-4 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-[10px] text-zinc-400 max-w-[200px] pointer-events-none select-none">
                💡 <span className="font-bold text-zinc-300">Click a node</span> to inspect, expand, or ask questions.
              </div>

              {/* Running overlay */}
              {(workflowState === 'running') && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/90 border border-indigo-500/30 text-xs text-indigo-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {SKILL_METADATA.find(s => s.id === activeAgent)?.name ?? 'Skill'} running...
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── RIGHT PANEL: Questions & Node Details ───────────────────────── */}
        <aside className="w-[380px] border-l border-zinc-800/80 bg-zinc-950/40 flex flex-col shrink-0 z-20 overflow-y-auto">
          <div className="p-4 space-y-4">

            {/* Clarifying Questions (Intent Clarifier pause) */}
            {workflowState === 'waiting' && orchestratorState.memory.clarifyingQuestions.length > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 rounded-2xl border bg-amber-950/20 border-amber-500/30 space-y-4">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Intent Clarifier</h3>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  The Intent Clarifier needs a bit more context to build the best possible map:
                </p>
                <div className="space-y-4">
                  {orchestratorState.memory.clarifyingQuestions.map(q => (
                    <div key={q.id} className="space-y-2">
                      <label className="text-[11px] font-semibold text-zinc-300 block">{q.question}</label>
                      {q.options && q.options.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {q.options.map(opt => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setClarifyingAnswers(prev => ({ ...prev, [q.id]: opt }))}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition-all ${clarifyingAnswers[q.id] === opt ? 'bg-amber-600 border-amber-500 text-white font-medium' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={clarifyingAnswers[q.id] || ''}
                          onChange={(e) => setClarifyingAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder="Your answer..."
                          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      )}
                      <p className="text-[10px] text-zinc-500 italic">🔍 {q.rationale}</p>
                    </div>
                  ))}
                  {(() => {
                    const qs = orchestratorState.memory.clarifyingQuestions;
                    const done = qs.length > 0 && qs.every(q => clarifyingAnswers[q.id]?.trim());
                    return (
                      <button
                        onClick={handleSubmitAnswers}
                        disabled={!done}
                        className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${done ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-500 opacity-50 cursor-not-allowed'}`}
                      >
                        Resume Skill Pipeline <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    );
                  })()}
                </div>
              </motion.div>
            )}

            {/* Selected Node Inspector */}
            {selectedNode && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-4 relative">
                <button onClick={() => setSelectedNode(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 text-xs">✕</button>

                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-400" />
                  <span className="text-[10px] uppercase font-bold text-zinc-500">Node Inspector</span>
                </div>

                <div>
                  <h3 className="text-sm font-extrabold text-white leading-tight">{(selectedNode.data as any).label}</h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{(selectedNode.data as any).description}</p>
                </div>

                {(selectedNode.data as any).tradeoff && (
                  <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-400/90 space-y-1">
                    <div className="flex items-center text-[10px] font-bold uppercase tracking-wider">
                      <Scale className="w-3.5 h-3.5 mr-1" /> Trade-off
                    </div>
                    <p className="text-[11px] text-zinc-400 italic">"{(selectedNode.data as any).tradeoff}"</p>
                  </div>
                )}

                {/* Expand Node button */}
                {workflowState === 'completed' && (
                  <button
                    onClick={handleExpandNode}
                    disabled={workflowState !== 'completed'}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/30 text-teal-300 text-xs font-semibold transition-all"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    Expand Node (ExplorationSkill)
                  </button>
                )}

                {/* Node Conversation */}
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-[10px] uppercase font-bold text-zinc-500">Ask this Node</span>
                  </div>

                  {currentNodeAnswer && (
                    <motion.div
                      key={currentNodeAnswer.question}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 rounded-lg bg-purple-950/20 border border-purple-500/20 space-y-1.5"
                    >
                      <p className="text-[10px] text-purple-400 font-semibold">Q: {currentNodeAnswer.question}</p>
                      <p className="text-[11px] text-zinc-300 leading-relaxed">{currentNodeAnswer.answer}</p>
                    </motion.div>
                  )}

                  {isAskingQuestion && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-900 border border-purple-500/20 text-xs text-zinc-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" />
                      NodeConversationSkill thinking...
                    </div>
                  )}

                  <form onSubmit={handleAskNodeQuestion} className="flex gap-2">
                    <input
                      type="text"
                      value={nodeQuestion}
                      onChange={(e) => setNodeQuestion(e.target.value)}
                      placeholder={`Ask about "${(selectedNode.data as any).label}"...`}
                      className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <button
                      type="submit"
                      disabled={!nodeQuestion.trim() || isAskingQuestion}
                      className="p-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-colors shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {/* Skill Info (completed state) */}
            {workflowState === 'completed' && !selectedNode && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">How to interact</h3>
                </div>
                <div className="space-y-2 text-[11px] text-zinc-400 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <ZoomIn className="w-3.5 h-3.5 text-teal-400 mt-0.5 shrink-0" />
                    <span><span className="text-zinc-300 font-semibold">Expand Node</span> — Click any node, then "Expand Node" to generate deeper subtopics via ExplorationSkill.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                    <span><span className="text-zinc-300 font-semibold">Ask a Question</span> — Select a node and ask anything about it. NodeConversationSkill answers in context.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Layers className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span><span className="text-zinc-300 font-semibold">Depth Filter</span> — Use the depth selector in the header to focus on specific levels.</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Previous node answers (other nodes) */}
            {nodeAnswers.filter(a => a.nodeId !== selectedNode?.id).length > 0 && (
              <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Previous Answers</h3>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {nodeAnswers.filter(a => a.nodeId !== selectedNode?.id).map((a, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 space-y-1">
                      <p className="text-[10px] text-purple-400 font-semibold truncate">{a.question}</p>
                      <p className="text-[11px] text-zinc-400 line-clamp-2">{a.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </aside>
      </div>
    </div>
  );
}
