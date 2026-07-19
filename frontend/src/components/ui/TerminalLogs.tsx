import React, { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { VscChevronUp, VscChevronDown, VscTrash, VscTerminal } from 'react-icons/vsc';

const TerminalLogs: React.FC = () => {
  const { logs, clearLogs } = useUIStore();
  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new logs stream in
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, expanded]);

  return (
    <div className={`relative z-30 bg-[#09090b]/95 border-t border-stone-800 select-none transition-all duration-300 flex flex-col ${expanded ? 'h-64' : 'h-10'}`}>
      
      {/* Console Bar Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className="px-6 h-10 flex items-center justify-between cursor-pointer hover:bg-stone-900/40 select-none"
      >
        <div className="flex items-center gap-2 text-stone-400 text-xs font-mono font-bold">
          <VscTerminal className="text-amber-500" /> 
          <span>Server Terminal Console</span>
          {!expanded && logs.length > 0 && (
            <span className="text-[10px] text-stone-500 font-normal truncate max-w-xl border-l border-stone-800 pl-2 ml-1">
              {logs[logs.length - 1]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={clearLogs}
            className="p-1 text-stone-600 hover:text-stone-300 rounded transition-colors text-xs font-bold font-mono uppercase tracking-wide flex items-center gap-1"
            title="Clear logs terminal"
          >
            <VscTrash /> Clear
          </button>
          
          <button 
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-stone-400 hover:text-white rounded"
          >
            {expanded ? <VscChevronDown /> : <VscChevronUp />}
          </button>
        </div>
      </div>

      {/* Expanded Logs Monospace Console */}
      {expanded && (
        <div className="flex-1 min-h-0 bg-black/40 p-4 font-mono text-[11px] text-stone-300 overflow-y-auto leading-relaxed select-text selection:bg-amber-500 selection:text-zinc-950">
          <div className="space-y-1">
            {logs.length === 0 ? (
              <div className="text-stone-600 italic">Terminal is silent. Awaiting server commands...</div>
            ) : (
              logs.map((log, idx) => {
                // Color lines based on log levels
                let colorClass = 'text-stone-300';
                if (log.includes('[ERROR]')) {
                  colorClass = 'text-red-400 font-bold';
                } else if (log.includes('[WARNING]')) {
                  colorClass = 'text-amber-400';
                } else if (log.includes('[INFO]')) {
                  colorClass = 'text-blue-300';
                } else if (log.includes('[SUCCESS]') || log.includes('compiled successfully')) {
                  colorClass = 'text-emerald-400';
                }

                return (
                  <div key={idx} className={`${colorClass} whitespace-pre-wrap`}>
                    {log}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};
export default TerminalLogs;
