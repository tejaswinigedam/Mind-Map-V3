import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Shield, Sparkles, Scale, BookOpen, AlertCircle } from 'lucide-react';

interface CustomNodeData {
  label: string;
  description?: string;
  depth?: number;
  importance?: 'high' | 'medium' | 'low';
  tradeoff?: string;
  details?: string;
}

export const MindMapNode = memo(({ data, selected }: NodeProps & { data: CustomNodeData }) => {
  const depth = data.depth ?? 0;
  const importance = data.importance ?? 'medium';

  // Determine borders and background gradients based on depth
  const getStyles = () => {
    switch (depth) {
      case 0:
        return {
          container: 'bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.25)]',
          badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
          icon: <Sparkles className="w-4 h-4 text-indigo-400 mr-1.5" />
        };
      case 1:
        return {
          container: 'bg-slate-900 border-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.15)]',
          badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
          icon: <BookOpen className="w-4 h-4 text-teal-400 mr-1.5" />
        };
      case 2:
      default:
        return {
          container: 'bg-zinc-900 border-zinc-700 shadow-sm',
          badge: 'bg-zinc-800 text-zinc-400 border-zinc-700',
          icon: <Shield className="w-4 h-4 text-zinc-400 mr-1.5" />
        };
    }
  };

  const styles = getStyles();

  // Importance badge colors
  const importanceColors = {
    high: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    low: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  };

  return (
    <div 
      className={`px-4 py-3 rounded-xl border-2 transition-all duration-300 w-72 text-left cursor-pointer group ${styles.container} ${
        selected ? 'ring-2 ring-indigo-400 border-indigo-400 scale-[1.03] shadow-lg' : 'hover:scale-[1.01] hover:border-indigo-500/60'
      }`}
    >
      {/* Target handle for incoming parent connections */}
      {depth > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-2.5 h-2.5 !bg-indigo-400 !border-slate-900"
        />
      )}

      {/* Node Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center">
          {styles.icon}
          <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            {depth === 0 ? 'Root' : `Level ${depth}`}
          </span>
        </div>

        {/* Importance Badge */}
        {depth > 0 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${importanceColors[importance]}`}>
            {importance}
          </span>
        )}
      </div>

      {/* Node Label */}
      <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors leading-tight">
        {data.label}
      </h3>

      {/* Node Description */}
      {data.description && (
        <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
          {data.description}
        </p>
      )}

      {/* Trade-off Warning Indicator */}
      {data.tradeoff && (
        <div className="mt-2.5 pt-2 border-t border-zinc-800 flex items-center text-[10px] text-amber-400/90 font-medium">
          <Scale className="w-3.5 h-3.5 mr-1 text-amber-500 shrink-0" />
          <span className="truncate">Debate / Trade-off active</span>
        </div>
      )}

      {/* Source handle for outgoing children connections */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-2.5 h-2.5 !bg-indigo-400 !border-slate-900"
      />
    </div>
  );
});

MindMapNode.displayName = 'MindMapNode';
