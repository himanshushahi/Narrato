import { VscAdd, VscTrash } from 'react-icons/vsc';



export const DeviceMockupEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  return (
    <div className="col-span-2 mt-2 bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 shadow-lg space-y-3">
      <div>
        <label className="block text-xs text-stone-400 font-bold uppercase tracking-wider mb-1">Device Type</label>
        <select
          value={visualMeta.device || 'iphone'}
          onChange={(e) => onChange({ ...visualMeta, device: e.target.value })}
          className="w-full bg-stone-900 border border-white/10 rounded px-2 py-1.5 text-sm text-stone-200 outline-none focus:border-amber-500/50"
        >
          <option value="iphone">iPhone</option>
          <option value="macbook">MacBook</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-stone-400 font-bold uppercase tracking-wider mb-1">Screen Image URL</label>
        <input
          type="text"
          value={visualMeta.screen_image_url || ''}
          onChange={(e) => onChange({ ...visualMeta, screen_image_url: e.target.value })}
          className="w-full bg-stone-900 border border-white/10 rounded px-2 py-1.5 text-sm text-stone-200 outline-none focus:border-amber-500/50"
          placeholder="https://example.com/image.png"
        />
      </div>
    </div>
  );
};

export const ThreadSimulationEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const messages = visualMeta.messages || [];

  const updateMessage = (index: number, field: string, value: any) => {
    const newMsgs = [...messages];
    newMsgs[index] = { ...newMsgs[index], [field]: value };
    onChange({ ...visualMeta, messages: newMsgs });
  };

  const addMessage = () => {
    onChange({
      ...visualMeta,
      messages: [...messages, { sender: 'User', text: 'New message', is_self: false }]
    });
  };

  const removeMessage = (index: number) => {
    const newMsgs = [...messages];
    newMsgs.splice(index, 1);
    onChange({ ...visualMeta, messages: newMsgs });
  };

  return (
    <div className="col-span-2 mt-2 bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 shadow-lg space-y-3">
      <div>
        <label className="block text-xs text-stone-400 font-bold uppercase tracking-wider mb-1">Platform</label>
        <select
          value={visualMeta.platform || 'whatsapp'}
          onChange={(e) => onChange({ ...visualMeta, platform: e.target.value })}
          className="w-full bg-stone-900 border border-white/10 rounded px-2 py-1.5 text-sm text-stone-200 outline-none focus:border-amber-500/50"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </select>
      </div>
      
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-xs text-stone-400 font-bold uppercase tracking-wider">Messages</label>
          <button onClick={addMessage} className="text-xs flex items-center gap-1 bg-amber-500/20 text-amber-400 px-2 py-1 rounded hover:bg-amber-500/30">
            <VscAdd /> Add
          </button>
        </div>
        
        <div className="space-y-2">
          {messages.map((msg: any, idx: number) => (
            <div key={idx} className="bg-stone-900 border border-white/10 rounded p-2 flex gap-2">
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={msg.sender || ''}
                    onChange={(e) => updateMessage(idx, 'sender', e.target.value)}
                    className="flex-1 bg-black border border-white/5 rounded px-2 py-1 text-xs text-stone-200"
                    placeholder="Sender Name"
                  />
                  <label className="flex items-center gap-1 text-xs text-stone-300">
                    <input
                      type="checkbox"
                      checked={msg.is_self || false}
                      onChange={(e) => updateMessage(idx, 'is_self', e.target.checked)}
                      className="rounded bg-black border-white/10 accent-amber-500"
                    />
                    Is Self
                  </label>
                </div>
                <input
                  type="text"
                  value={msg.text || ''}
                  onChange={(e) => updateMessage(idx, 'text', e.target.value)}
                  className="w-full bg-black border border-white/5 rounded px-2 py-1 text-xs text-stone-200"
                  placeholder="Message text..."
                />
              </div>
              <button onClick={() => removeMessage(idx)} className="text-stone-500 hover:text-red-400 h-fit self-center">
                <VscTrash />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

