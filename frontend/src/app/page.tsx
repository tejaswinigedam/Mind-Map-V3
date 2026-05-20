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
  HelpCircle, 
  Scale, 
  Lightbulb, 
  History, 
  BookOpen, 
  CheckCircle2, 
  Sparkles, 
  AlertCircle,
  HelpCircle as QuestionIcon
} from 'lucide-react';

import { MindMapNode } from '../components/MindMapNode';

// Type definitions replicated from backend to ensure strict typing
interface ClarifyingQuestion {
  id: string;
  question: string;
  rationale: string;
  options?: string[];
}

interface ClarifyingAnswer {
  questionId: string;
  questionText: string;
  answerText: string;
}

interface AgentExecutionLog {
  timestamp: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  message: string;
  thought?: string;
  duration?: number;
}

interface SharedMemory {
  originalInput: string;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifyingAnswers: ClarifyingAnswer[];
  extractedIntent?: {
    goals: string[];
    useCase: string;
    learningStyle: string;
    explorationDepth: string;
    expertiseLevel: string;
    breadthPreference: string;
  };
  expandedKnowledge?: {
    missingAreas: string[];
    relatedConcepts: string[];
    hiddenBranches: string[];
    recommendedPerspectives: string[];
  };
  compressedSummary: string;
  mindMap?: {
    nodes: any[];
    edges: any[];
  };
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

const nodeTypes = {
  custom: MindMapNode
};

export default function AgenticMindMapApp() {
  // Input Topic State
  const [topicInput, setTopicInput] = useState('');
  
  // WebSocket Instance and Connection State
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Core Orchestration State
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState>({
    memory: {
      originalInput: '',
      clarifyingQuestions: [],
      clarifyingAnswers: [],
      compressedSummary: 'Awaiting topic initialization to begin shared memory recording.'
    },
    status: {
      state: 'idle',
      activeAgentId: null,
      completedAgentIds: [],
      logs: []
    }
  });

  // UI Selection State
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<string, string>>({});
  const [refineInput, setRefineInput] = useState('');

  // Timeline UI Filter State ('all' or 'thoughts')
  const [logFilter, setLogFilter] = useState<'all' | 'thoughts'>('all');

  // Dynamic Depth Level Filter State
  const [maxVisibleDepth, setMaxVisibleDepth] = useState<number | 'all'>('all');

  // React Flow Nodes & Edges State
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Compute filtered nodes and edges based on selected visible depth
  const visibleNodes = React.useMemo(() => {
    if (maxVisibleDepth === 'all') return nodes;
    return nodes.filter((node: any) => (node.data?.depth ?? 0) <= maxVisibleDepth);
  }, [nodes, maxVisibleDepth]);

  const visibleEdges = React.useMemo(() => {
    if (maxVisibleDepth === 'all') return edges;
    return edges.filter((edge: any) => {
      const sourceNode = nodes.find((n: any) => n.id === edge.source) as any;
      const targetNode = nodes.find((n: any) => n.id === edge.target) as any;
      const sourceDepth = sourceNode?.data?.depth ?? 0;
      const targetDepth = targetNode?.data?.depth ?? 0;
      return sourceDepth <= maxVisibleDepth && targetDepth <= maxVisibleDepth;
    });
  }, [edges, nodes, maxVisibleDepth]);

  // Auto-scroll ref for agent logs
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Track previous state transitions without triggering socket re-creation
  const previousStateRef = useRef<string>('idle');

  // Connect to WebSocket Server with reconnection and singleton handling
  useEffect(() => {
    // Helper to establish connection
    const connect = () => {
      // Clear any existing reconnect timeout before creating a new socket
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }

      // If we already have a socket connection in socketRef, clean it up first
      if (socketRef.current) {
        const oldWs = socketRef.current;
        console.log('[WebSocket] Cleaning up previous WebSocket instance before reconnecting.');
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onclose = null;
        oldWs.onerror = null;
        try {
          oldWs.close();
        } catch (e) {
          console.error('[WebSocket] Error closing previous socket:', e);
        }
        socketRef.current = null;
      }

      const port = process.env.NEXT_PUBLIC_WS_PORT || '3001';
      console.log(`[WebSocket] Connecting to backend server at ws://localhost:${port}...`);
      const ws = new WebSocket(`ws://localhost:${port}`);
      socketRef.current = ws;
      setSocket(ws);

      ws.onopen = () => {
        console.log('[WebSocket] Connection successfully opened.');
        setIsConnected(true);
        setErrorMsg(null);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WebSocket] Message received: type =', data.type);

          if (data.type === 'STATE_UPDATE') {
            const newState = data.state as OrchestratorState;
            // Celebrate on completion
            if (newState.status.state === 'completed' && previousStateRef.current !== 'completed') {
              confetti({
                particleCount: 120,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#6366f1', '#10b981', '#f59e0b', '#ec4899']
              });
            }
            previousStateRef.current = newState.status.state;
            setOrchestratorState(newState);
            if (newState.memory.mindMap) {
              setNodes(newState.memory.mindMap.nodes as any);
              setEdges(newState.memory.mindMap.edges as any);
            }
          } else if (data.type === 'ERROR') {
            console.error('[WebSocket] Received ERROR state:', data.message);
            setErrorMsg(data.message);
          }
        } catch (err) {
          console.error('[WebSocket] Error parsing socket event message:', err);
        }
      };

      ws.onclose = (event) => {
        console.warn(`[WebSocket] Connection closed (code: ${event.code}, reason: ${event.reason || 'none'}).`);
        setIsConnected(false);
        
        // Only trigger reconnection if this socket is still the active one
        if (socketRef.current === ws) {
          socketRef.current = null;
          console.log('[WebSocket] Scheduling reconnection in 3s...');
          if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Socket encountered error:', err);
        setIsConnected(false);
        setErrorMsg('WebSocket error, attempting reconnect...');
        
        // Only trigger reconnection if this socket is still the active one
        if (socketRef.current === ws) {
          socketRef.current = null;
          console.log('[WebSocket] Scheduling reconnection in 3s after error...');
          if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };
    };

    // Initial connection
    connect();

    // Cleanup on unmount
    return () => {
      console.log('[WebSocket] Cleaning up WebSocket connection on component unmount.');
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (socketRef.current) {
        const ws = socketRef.current;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch (e) {
          console.error('[WebSocket] Error closing socket on unmount:', e);
        }
        socketRef.current = null;
      }
    };
  }, [setNodes, setEdges]);

  // Keep logs scrolled to bottom
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [orchestratorState.status.logs, orchestratorState.status.activeAgentId]);

  // Start Workflow
  const handleStartWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;

    setErrorMsg(null);
    setSelectedNode(null);
    setClarifyingAnswers({});
    
    socket.send(JSON.stringify({
      type: 'START_WORKFLOW',
      topic: topicInput
    }));
  };

  // Submit Clarifying Answers
  const handleSubmitAnswers = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const questions = orchestratorState.memory.clarifyingQuestions;
    const isComplete = questions.length > 0 && questions.every(
      q => clarifyingAnswers[q.id] && clarifyingAnswers[q.id].trim() !== ''
    );

    if (!isComplete) {
      console.warn('[handleSubmitAnswers] Blocked: Clarifying questions are incomplete.');
      return;
    }

    const formattedAnswers = questions.map(q => ({
      questionId: q.id,
      questionText: q.question,
      answerText: clarifyingAnswers[q.id]
    }));

    socket.send(JSON.stringify({
      type: 'SUBMIT_ANSWERS',
      answers: formattedAnswers
    }));
  };

  // Submit Refinement Prompt
  const handleRefineMap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineInput.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
      type: 'REFINE_MAP',
      prompt: refineInput
    }));

    setRefineInput('');
  };

  // Reset Application
  const handleReset = () => {
    setTopicInput('');
    setClarifyingAnswers({});
    setRefineInput('');
    setSelectedNode(null);
    setNodes([]);
    setEdges([]);
    setOrchestratorState({
      memory: {
        originalInput: '',
        clarifyingQuestions: [],
        clarifyingAnswers: [],
        compressedSummary: 'Awaiting topic initialization to begin shared memory recording.'
      },
      status: {
        state: 'idle',
        activeAgentId: null,
        completedAgentIds: [],
        logs: []
      }
    });
  };

  // Export Mind Map as JSON file
  const handleExport = () => {
    if (!orchestratorState.memory.mindMap) return;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify(orchestratorState.memory, null, 2)
    );
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mind-map-${orchestratorState.memory.originalInput.toLowerCase().replace(/\s+/g, '-')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // React Flow node clicking
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const activeAgent = orchestratorState.status.activeAgentId;
  const workflowState = orchestratorState.status.state;

  // Agent descriptions for UI left panel representation
  const agentMetadata = [
    { id: 'clarity', name: 'Context Clarity Agent', color: 'border-blue-500 text-blue-400' },
    { id: 'intent', name: 'Intent Extraction Agent', color: 'border-indigo-500 text-indigo-400' },
    { id: 'expansion', name: 'Knowledge Expansion Agent', color: 'border-purple-500 text-purple-400' },
    { id: 'structure', name: 'Structure Planning Agent', color: 'border-pink-500 text-pink-400' },
    { id: 'generation', name: 'Mind Map Generation Agent', color: 'border-teal-500 text-teal-400' },
    { id: 'memory', name: 'Memory / Compression Agent', color: 'border-emerald-500 text-emerald-400' }
  ];

  return (
    <div className="flex flex-col h-screen text-zinc-100 bg-[#09090b]">
      
      {/* ==================================================
          TOP BAR
          ================================================== */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 glass backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
            <Brain className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-md font-bold tracking-tight text-white flex items-center gap-2">
              Agentic Mind Mapping System
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                MVP v1.0
              </span>
            </h1>
            <p className="text-xs text-zinc-500">Collaborative cognitive workspace powered by 7 specialized AI agents</p>
          </div>
        </div>

        {/* Live status indicators */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-zinc-400">{isConnected ? 'Server Connected' : 'Server Offline'}</span>
          </div>

          <div className="h-4 w-[1px] bg-zinc-800" />

          {/* Controls */}
          <div className="flex gap-2 items-center">
            {orchestratorState.memory.mindMap && (
              <div className="flex items-center gap-1.5 mr-2">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Depth Filter:</span>
                <select
                  value={maxVisibleDepth}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxVisibleDepth(val === 'all' ? 'all' : Number(val));
                  }}
                  className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="all">All Levels</option>
                  <option value="0">Root Only</option>
                  <option value="1">Up to Level 1</option>
                  <option value="2">Up to Level 2 (Shows Only Level 2 & Parents)</option>
                  <option value="3">Up to Level 3</option>
                  <option value="4">Up to Level 4</option>
                  <option value="5">Up to Level 5</option>
                </select>
              </div>
            )}

            {orchestratorState.memory.mindMap && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" />
                Export
              </button>
            )}

            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      </header>

      {/* ==================================================
          MAIN LAYOUT CONTAINER
          ================================================== */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* ==================================================
            LEFT PANEL: AGENT TIMELINE & THOUGHT TRACKER
            ================================================== */}
        <aside className="w-96 border-r border-zinc-800/80 bg-zinc-950/40 flex flex-col shrink-0 z-20">
          <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Cognitive Timeline</h2>
            </div>
            
            {/* Filter buttons */}
            <div className="flex rounded-md bg-zinc-900 p-0.5 border border-zinc-800">
              <button
                onClick={() => setLogFilter('all')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded ${logFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Logs
              </button>
              <button
                onClick={() => setLogFilter('thoughts')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded ${logFilter === 'thoughts' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Thoughts
              </button>
            </div>
          </div>

          {/* TIMELINE TRACK */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            
            {/* Base state / Idle form */}
            {workflowState === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-zinc-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-300">Awaiting Cognitive Workflow</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[200px] leading-relaxed">
                    Input a topic in the center canvas to start the agentic sequence.
                  </p>
                </div>
              </div>
            )}

            {/* List of active & completed agents */}
            {workflowState !== 'idle' && (
              <div className="space-y-4">
                
                {/* Visual Orchestration Timeline tracker */}
                <div className="grid grid-cols-7 gap-1 p-2 bg-zinc-900/50 rounded-xl border border-zinc-800/80 mb-6">
                  {agentMetadata.map((a) => {
                    const isCompleted = orchestratorState.status.completedAgentIds.includes(a.id);
                    const isRunning = activeAgent === a.id;
                    return (
                      <div 
                        key={a.id}
                        title={a.name}
                        className={`h-2.5 rounded-full transition-all duration-300 ${
                          isRunning 
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse ring-2 ring-indigo-500/30' 
                            : isCompleted 
                              ? 'bg-emerald-500' 
                              : 'bg-zinc-800'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Individual Agent Reasoning Logs */}
                <div className="space-y-4 relative pl-3 border-l border-zinc-800/80">
                  {orchestratorState.status.logs
                    .filter(log => logFilter === 'all' || (logFilter === 'thoughts' && log.thought))
                    .map((log, index) => {
                      const meta = agentMetadata.find(a => a.id === log.agentId);
                      const isComplete = log.status === 'completed';
                      const isFailed = log.status === 'failed';

                      return (
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3 }}
                          key={index}
                          className="relative space-y-1.5"
                        >
                          {/* Timeline dot */}
                          <div className={`absolute -left-[17px] top-1 w-2 h-2 rounded-full border ${
                            isComplete 
                              ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' 
                              : isFailed
                                ? 'bg-rose-500 border-rose-500'
                                : 'bg-indigo-500 border-indigo-500 animate-pulse'
                          }`} />

                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-zinc-300">
                              {meta?.name || log.agentId}
                            </span>
                            {log.duration && (
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {(log.duration / 1000).toFixed(2)}s
                              </span>
                            )}
                          </div>

                          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800/70 text-xs text-zinc-300 leading-relaxed shadow-sm">
                            {log.message}

                            {/* Inner Thoughts (Explainability) */}
                            {log.thought && (
                              <div className="mt-2.5 pt-2.5 border-t border-zinc-800">
                                <div className="flex items-center text-[10px] text-indigo-400 font-semibold tracking-wider uppercase mb-1">
                                  <Brain className="w-3 h-3 mr-1" />
                                  Cognitive Trace
                                </div>
                                <p className="text-[11px] text-zinc-400 font-mono italic leading-relaxed">
                                  "{log.thought}"
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}

                  {/* Active running agent visual loader */}
                  {activeAgent && (
                    <motion.div 
                      className="relative space-y-1.5"
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border border-indigo-500 animate-ping" />
                      <div className="text-[11px] font-bold text-indigo-400">
                        {agentMetadata.find(a => a.id === activeAgent)?.name} Thinking...
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-900/60 border border-indigo-500/20 agent-running-glow text-xs text-zinc-400 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                        Executing cognitive graph algorithms...
                      </div>
                    </motion.div>
                  )}

                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ==================================================
            CENTER PANEL: THE INTERACTIVE GRAPH CANVAS
            ================================================== */}
        <main className="flex-1 flex flex-col relative bg-[#09090b] overflow-hidden">
          
          {/* Background Mesh Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#141416_1px,transparent_1px),linear-gradient(to_bottom,#141416_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] pointer-events-none" />

          {/* Topic Initialization input box (only visible when idle) */}
          {workflowState === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center p-6 z-10">
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-xl p-8 rounded-3xl glass glass-glow border border-zinc-800/80 shadow-2xl text-center space-y-6"
              >
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                  <Brain className="w-8 h-8 text-indigo-400 animate-pulse" />
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-xl font-extrabold text-white tracking-tight">Brainstorm at Depth</h2>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                    Enter a complex topic, thesis prompt, or idea. Our multi-agent AI squad will orchestrate, debate, and render an interactive concept graph.
                  </p>
                </div>

                <form onSubmit={handleStartWorkflow} className="flex gap-2">
                  <input
                    type="text"
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    placeholder="e.g., Artificial Intelligence, Classical Mechanics, Micro-services"
                    className="flex-1 px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={!isConnected || !topicInput.trim()}
                    className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:border-zinc-800 text-white font-semibold text-sm transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] flex items-center gap-1.5"
                  >
                    Orchestrate
                    <Play className="w-4 h-4" />
                  </button>
                </form>

                {errorMsg && (
                  <p className="text-xs text-rose-400 mt-2 flex items-center gap-1.5 justify-center">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {errorMsg}
                  </p>
                )}
              </motion.div>
            </div>
          )}

          {/* Interactive React Flow Canvas */}
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
                minZoom={0.2}
                maxZoom={1.5}
              >
                <Background color="#1f2937" gap={56} size={1} />
                <Controls className="bg-zinc-900 border-zinc-800 fill-zinc-400" />
                <MiniMap 
                  style={{ background: '#09090b', border: '1px solid #27272a' }}
                  nodeColor={(n) => {
                    const depth = (n.data as any)?.depth ?? 0;
                    return depth === 0 ? '#6366f1' : depth === 1 ? '#14b8a6' : '#27272a';
                  }}
                  maskColor="rgba(0, 0, 0, 0.6)"
                />
              </ReactFlow>

              {/* Float instructions overlay */}
              <div className="absolute top-4 left-4 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-[10px] text-zinc-400 max-w-[200px] pointer-events-none select-none">
                💡 <span className="font-bold text-zinc-300">Canvas Navigation</span>: Left-click and drag to Pan. Scroll to Zoom. Click a node to inspect advanced tradeoff and detail parameters.
              </div>
            </div>
          )}
        </main>

        {/* ==================================================
            RIGHT PANEL: QUESTIONS, SUGGESTIONS & Drawer
            ================================================== */}
        <aside className="w-96 border-l border-zinc-800/80 bg-zinc-950/40 flex flex-col shrink-0 z-20 overflow-y-auto">
          
          <div className="p-4 space-y-4">
            
            {/* ==================================================
                HUMAN-IN-THE-LOOP CLARIFYING QUESTIONS
                ================================================== */}
            {workflowState === 'waiting' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <QuestionIcon className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">Adaptive Context Alignment</h3>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Our Context Clarity Agent has paused execution to configure parameters before pipeline structure starts. Answer these dynamic questions:
                </p>

                <div className="space-y-4">
                  {orchestratorState.memory.clarifyingQuestions.map((q) => (
                    <div key={q.id} className="space-y-2">
                      <label className="text-[11px] font-semibold text-zinc-300 block">
                        {q.question}
                      </label>
                      
                      {q.options ? (
                        <div className="flex flex-col gap-1.5">
                          {q.options.map(opt => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setClarifyingAnswers(prev => ({ ...prev, [q.id]: opt }))}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                                clarifyingAnswers[q.id] === opt 
                                  ? 'bg-indigo-600 border-indigo-500 text-white font-medium shadow-md' 
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200'
                              }`}
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
                          placeholder="Type your bespoke response..."
                          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-850 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      )}
                      
                      <p className="text-[10px] text-zinc-500 leading-tight italic">
                        🔍 Rationale: {q.rationale}
                      </p>
                    </div>
                  ))}

                  {(() => {
                    const questions = orchestratorState.memory.clarifyingQuestions;
                    const isClarifyingComplete = questions.length > 0 && questions.every(
                      q => clarifyingAnswers[q.id] && clarifyingAnswers[q.id].trim() !== ''
                    );
                    return (
                      <button
                        onClick={handleSubmitAnswers}
                        disabled={!isClarifyingComplete}
                        className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                          isClarifyingComplete
                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.2)] cursor-pointer'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-850 cursor-not-allowed opacity-50'
                        }`}
                      >
                        Resume Agent Execution
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    );
                  })()}
                </div>
              </motion.div>
            )}

            {/* ==================================================
                SELECTED NODE DETAILS DRAWER
                ================================================== */}
            {selectedNode && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 relative"
              >
                <button 
                  onClick={() => setSelectedNode(null)}
                  className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  ✕ Close
                </button>
                
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-400" />
                  <span className="text-[10px] uppercase font-bold text-zinc-500">Node Insights</span>
                </div>

                <div>
                  <h3 className="text-sm font-extrabold text-white leading-tight">
                    {(selectedNode.data as any).label}
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                    {(selectedNode.data as any).description}
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-zinc-800 text-xs leading-relaxed text-zinc-300">
                  <div>
                    <span className="font-semibold text-zinc-400 block text-[10px] uppercase tracking-wider">Analysis Detail</span>
                    <p className="mt-1 text-[11px] text-zinc-400 bg-zinc-950 p-2.5 rounded-lg border border-zinc-900 font-mono">
                      {(selectedNode.data as any).details || 'No expanded details provided for this conceptual node.'}
                    </p>
                  </div>

                  {/* Trade-off Warning detail */}
                  {(selectedNode.data as any).tradeoff && (
                    <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-400/90 space-y-1">
                      <div className="flex items-center text-[10px] font-bold uppercase tracking-wider">
                        <Scale className="w-3.5 h-3.5 mr-1" />
                        Paradox / Trade-off Active
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-400 italic">
                        "{(selectedNode.data as any).tradeoff}"
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ==================================================
                SHARED MEMORY / COMPRESSION
                ================================================== */}
            {workflowState !== 'idle' && (
              <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Compressed Memory</h3>
                </div>

                <div className="text-[11px] leading-relaxed text-zinc-400 bg-zinc-950/50 border border-zinc-900 p-3 rounded-xl font-mono">
                  {orchestratorState.memory.compressedSummary}
                </div>
              </div>
            )}



            {/* ==================================================
                BRANCH REFINEMENT TOOL
                ================================================== */}
            {workflowState === 'completed' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Refine or Expand Branch</h3>
                </div>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Provide custom instructions to append nodes, deepen branches, or introduce a lateral domain connection.
                </p>

                <form onSubmit={handleRefineMap} className="flex gap-2">
                  <input
                    type="text"
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    placeholder="e.g. Add an alignment branch under systems..."
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={!refineInput.trim()}
                    className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-850 disabled:text-zinc-700 text-white font-bold text-xs transition-colors shrink-0"
                  >
                    Submit
                  </button>
                </form>
              </motion.div>
            )}

          </div>
        </aside>

      </div>
    </div>
  );
}
