import { VscTrash, VscAdd, VscArrowUp, VscArrowDown } from 'react-icons/vsc';

interface TimelineEditorProps {
  visualMeta: any;
  onChange: (newMeta: any) => void;
}

export const TimelineEditor = ({ visualMeta, onChange }: TimelineEditorProps) => {
  const update = (key: string, value: any) => {
    onChange({ ...visualMeta, [key]: value });
  };

  const events = visualMeta?.events || [];

  const updateEvent = (index: number, key: string, value: string) => {
    const newEvents = [...events];
    newEvents[index] = { ...newEvents[index], [key]: value };
    update('events', newEvents);
  };

  const addEvent = () => {
    const newEvents = [...events, { date: 'New Date', title: 'New Event', description: 'Description' }];
    update('events', newEvents);
  };

  const removeEvent = (index: number) => {
    const newEvents = [...events];
    newEvents.splice(index, 1);
    update('events', newEvents);
  };

  const moveEvent = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      const newEvents = [...events];
      const temp = newEvents[index];
      newEvents[index] = newEvents[index - 1];
      newEvents[index - 1] = temp;
      update('events', newEvents);
    } else if (direction === 'down' && index < events.length - 1) {
      const newEvents = [...events];
      const temp = newEvents[index];
      newEvents[index] = newEvents[index + 1];
      newEvents[index + 1] = temp;
      update('events', newEvents);
    }
  };

  return (
    <div className="col-span-2 space-y-5 mt-3 pt-3 border-t border-white/5">
      <div className="flex justify-between items-center">
        <label className="text-stone-400/80 font-medium tracking-wide text-xs">
          ⏱️ Timeline Editor
        </label>
        <button
          type="button"
          onClick={addEvent}
          className="flex items-center gap-1 text-[10px] bg-cyan-900/40 hover:bg-cyan-800/60 border border-cyan-500/20 px-2 py-1 rounded text-cyan-400 transition-colors cursor-pointer"
        >
          <VscAdd /> Add Event
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Timeline Title</label>
        <input
          type="text"
          value={visualMeta?.title || ''}
          onChange={(e) => update('title', e.target.value)}
          className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-cyan-500/50 focus:bg-black/40 transition-all duration-300"
          placeholder="Timeline of Events"
        />
      </div>

      <div className="space-y-3">
        {events.map((evt: any, idx: number) => (
          <div key={idx} className="bg-black/20 border border-white/5 rounded-lg p-3 space-y-3 relative group">
            <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" onClick={() => moveEvent(idx, 'up')} disabled={idx === 0} className="text-stone-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                <VscArrowUp />
              </button>
              <button type="button" onClick={() => moveEvent(idx, 'down')} disabled={idx === events.length - 1} className="text-stone-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                <VscArrowDown />
              </button>
              <button type="button" onClick={() => removeEvent(idx)} className="text-red-900 hover:text-red-500 ml-1">
                <VscTrash />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pr-16">
              <div className="space-y-1">
                <label className="text-stone-500 font-medium text-[9px] uppercase tracking-wider">Date</label>
                <input
                  type="text"
                  value={evt.date || ''}
                  onChange={(e) => updateEvent(idx, 'date', e.target.value)}
                  className="w-full bg-black/40 border border-transparent rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-cyan-500/30 transition-colors"
                  placeholder="JAN 2000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-stone-500 font-medium text-[9px] uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  value={evt.title || ''}
                  onChange={(e) => updateEvent(idx, 'title', e.target.value)}
                  className="w-full bg-black/40 border border-transparent rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-cyan-500/30 transition-colors"
                  placeholder="Event Title"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-stone-500 font-medium text-[9px] uppercase tracking-wider">Description</label>
              <textarea
                value={evt.description || ''}
                onChange={(e) => updateEvent(idx, 'description', e.target.value)}
                className="w-full bg-black/40 border border-transparent rounded px-2 py-1 text-[11px] text-stone-300 focus:outline-none focus:border-cyan-500/30 transition-colors resize-y"
                placeholder="Description of the event..."
                rows={2}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
