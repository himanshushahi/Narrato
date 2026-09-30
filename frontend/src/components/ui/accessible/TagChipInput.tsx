import React, { useState, useRef, memo, useId } from 'react';
import { X, Plus } from 'lucide-react';

export interface TagChipInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const TagChipInput: React.FC<TagChipInputProps> = memo(({
  tags = [],
  onChange,
  label = 'Tags',
  placeholder = 'Type word and press Enter...',
  disabled = false,
  className = '',
}) => {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (val: string) => {
    const rawItems = val.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    if (rawItems.length === 0) return;
    const newTags = [...tags];
    let changed = false;
    for (const item of rawItems) {
      if (!newTags.includes(item)) {
        newTags.push(item);
        changed = true;
      }
    }
    if (changed) {
      onChange(newTags);
    }
    setDraft('');
  };

  const removeTag = (indexToRemove: number) => {
    onChange(tags.filter((_, idx) => idx !== indexToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
      e.preventDefault();
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block select-none">
          {label} ({tags.length})
        </label>
      )}

      <div
        onClick={() => inputRef.current?.focus()}
        className="min-h-[38px] p-1.5 bg-zinc-950/70 border border-zinc-800 rounded-lg flex flex-wrap items-center gap-1.5 focus-within:border-amber-500/60 focus-within:ring-1 focus-within:ring-amber-500/30 transition-all cursor-text"
      >
        <ul role="list" aria-label={label} className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag, idx) => (
            <li
              key={`${tag}-${idx}`}
              role="listitem"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold group animate-in fade-in zoom-in-95 duration-100"
            >
              <span>{tag}</span>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(idx);
                }}
                className="p-0.5 rounded-full hover:bg-amber-500/30 text-amber-400/70 hover:text-amber-200 transition-colors cursor-pointer focus:outline-none"
              >
                <X size={10} />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex-1 min-w-[120px] flex items-center gap-1">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={label || 'Add tag'}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) addTag(draft);
            }}
            placeholder={tags.length === 0 ? placeholder : 'Add word...'}
            className="w-full bg-transparent text-xs text-stone-200 focus:outline-none placeholder-stone-600 px-1 py-0.5"
          />
          {draft.trim() && (
            <button
              type="button"
              aria-label="Add word"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(draft)}
              className="p-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
              title="Add word"
            >
              <Plus size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

TagChipInput.displayName = 'TagChipInput';
