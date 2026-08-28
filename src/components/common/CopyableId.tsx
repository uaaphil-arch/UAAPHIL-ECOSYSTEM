import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyableIdProps {
  id: string;
  label?: string;
  className?: string;
  truncate?: boolean;
}

export const CopyableId: React.FC<CopyableIdProps> = ({
  id,
  label = 'ID',
  className = '',
  truncate = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy ID:', err);
    }
  };

  const displayText = truncate && id.length > 13
    ? `${id.slice(0, 8)}...${id.slice(-4)}`
    : id;

  return (
    <div className={`inline-flex items-center space-x-1.5 font-mono text-xs ${className}`}>
      {label && <span className="text-slate-400 font-sans text-[11px]">{label}:</span>}
      <span className="text-slate-200 select-all bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
        {displayText}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy ID to clipboard"
        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium transition-all ${
          copied
            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/80 ring-1 ring-emerald-500/50'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
        }`}
      >
        {copied ? (
          <>
            <Check className="w-3 h-3 text-emerald-400" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy className="w-3 h-3 text-slate-400" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
};
