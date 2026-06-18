import { BiTrashAlt } from 'react-icons/bi';
import { BsPlus } from 'react-icons/bs';
import { CustomInput } from '../../components/ui/CustomInput';
import { CustomSelect } from '../../components/ui/CustomSelect';

export const NetworkDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const nodes = visualMeta?.nodes || [];
  const edges = visualMeta?.edges || [];
  const theme = visualMeta?.theme || 'conspiracy_board';

  const handleUpdateTheme = (val: string) => {
    onChange({ ...visualMeta, theme: val });
  };

  const handleUpdateNode = (idx: number, field: string, val: string) => {
    const newNodes = [...nodes];
    newNodes[idx][field] = val;
    onChange({ ...visualMeta, nodes: newNodes });
  };

  const handleAddNode = () => {
    const newId = (nodes.length + 1).toString();
    onChange({ ...visualMeta, nodes: [...nodes, { id: newId, label: 'New Node', type: 'entity' }] });
  };

  const handleRemoveNode = (idx: number) => {
    const newNodes = nodes.filter((_: any, i: number) => i !== idx);
    onChange({ ...visualMeta, nodes: newNodes });
  };

  const handleUpdateEdge = (idx: number, field: string, val: string) => {
    const newEdges = [...edges];
    newEdges[idx][field] = val;
    onChange({ ...visualMeta, edges: newEdges });
  };

  const handleAddEdge = () => {
    const source = nodes.length > 0 ? nodes[0].id : '';
    const target = nodes.length > 1 ? nodes[1].id : source;
    onChange({ ...visualMeta, edges: [...edges, { source, target }] });
  };

  const handleRemoveEdge = (idx: number) => {
    const newEdges = edges.filter((_: any, i: number) => i !== idx);
    onChange({ ...visualMeta, edges: newEdges });
  };

  const nodeOptions = nodes.map((n: any) => ({ value: n.id, label: n.label || n.id }));

  return (
    <div className="col-span-2 space-y-5 mt-3 pt-3 border-t border-white/5">
      
      {/* Theme Selection */}
      <div className="space-y-1.5">
        <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Visual Theme</label>
        <CustomSelect 
          options={[
            { value: 'conspiracy_board', label: 'Conspiracy Board (Red Strings)' },
            { value: 'corporate', label: 'Corporate Minimalist (Blue Lines)' },
            { value: 'cyberpunk', label: 'Cyberpunk (Glowing Neon)' }
          ]} 
          value={theme} 
          onChange={handleUpdateTheme} 
        />
      </div>

      <hr className="border-stone-800" />

      {/* Nodes Manager */}
      <div className="space-y-3">
        <div className="flex justify-between items-center text-xs">
          <label className="text-stone-400/80 font-medium tracking-wide">Nodes (Entities)</label>
          <button type="button" onClick={handleAddNode} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md flex items-center gap-1 text-stone-300 transition-colors"><BsPlus /> Add Node</button>
        </div>
        <div className="space-y-2 pr-2">
          {nodes.map((node: any, idx: number) => (
            <div key={idx} className="flex gap-3 bg-black/10 p-2.5 rounded-lg border border-white/5 relative group items-end">
            <div className="w-16">
              <CustomInput label="ID" type="text" value={node.id} onChange={e => handleUpdateNode(idx, 'id', e.target.value)} />
            </div>
            <div className="flex-1">
              <CustomInput label="Label" type="text" value={node.label} onChange={e => handleUpdateNode(idx, 'label', e.target.value)} />
            </div>
            <div className="w-28">
              <CustomSelect 
                label="Type"
                options={[{value: 'person', label: 'Person'}, {value: 'entity', label: 'Entity'}]} 
                value={node.type || 'entity'} 
                onChange={(val) => handleUpdateNode(idx, 'type', val)} 
              />
            </div>
            <button type="button" onClick={() => handleRemoveNode(idx)} className="text-red-400/50 hover:text-red-400 cursor-pointer p-1.5 transition-colors rounded hover:bg-red-500/10 mb-0.5"><BiTrashAlt size={16} /></button>
          </div>
        ))}
        </div>
      </div>

      {/* Edges Manager */}
      <div className="space-y-3 pt-3 border-t border-white/5">
        <div className="flex justify-between items-center text-xs">
          <label className="text-stone-400/80 font-medium tracking-wide">Edges (Connections)</label>
          <button type="button" onClick={handleAddEdge} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md flex items-center gap-1 text-stone-300 transition-colors"><BsPlus /> Add Edge</button>
        </div>
        <div className="space-y-2 pr-2">
          {edges.map((edge: any, idx: number) => (
            <div key={idx} className="flex items-center gap-2 bg-black/10 p-2 rounded-lg border border-white/5 relative group">
            <div className="flex-1 min-w-0">
              <CustomSelect 
                options={nodeOptions} 
                value={edge.source} 
                onChange={(val) => handleUpdateEdge(idx, 'source', val)} 
              />
            </div>
            <div className="text-stone-500 text-sm font-bold shrink-0">→</div>
            <div className="flex-1 min-w-0">
              <CustomSelect 
                options={nodeOptions} 
                value={edge.target} 
                onChange={(val) => handleUpdateEdge(idx, 'target', val)} 
              />
            </div>
            <button type="button" onClick={() => handleRemoveEdge(idx)} className="text-red-400/50 hover:text-red-400 cursor-pointer p-1.5 transition-colors rounded hover:bg-red-500/10 shrink-0"><BiTrashAlt size={16} /></button>
          </div>
        ))}
        </div>
        {nodes.length < 2 && <div className="text-xs text-amber-500/80 italic mt-2">Add at least 2 nodes to create connections.</div>}
      </div>

    </div>
  );
};
