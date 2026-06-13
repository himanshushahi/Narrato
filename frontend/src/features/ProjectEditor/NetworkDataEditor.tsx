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

  const nodeOptions = nodes.map((n: any) => ({ value: n.id, label: `${n.id} - ${n.label}` }));

  return (
    <div className="col-span-2 space-y-4 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      
      {/* Theme Selection */}
      <div className="space-y-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Visual Theme</label>
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
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <label className="text-stone-400 font-bold uppercase tracking-wider">Nodes</label>
          <button type="button" onClick={handleAddNode} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded flex items-center gap-1 text-stone-300"><BsPlus /> Add Node</button>
        </div>
        {nodes.map((node: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2 bg-stone-950 p-2 rounded border border-stone-800 relative group">
            <div className="w-16">
              <CustomInput label="ID" type="text" value={node.id} onChange={e => handleUpdateNode(idx, 'id', e.target.value)} />
            </div>
            <div className="flex-1">
              <CustomInput label="Label" type="text" value={node.label} onChange={e => handleUpdateNode(idx, 'label', e.target.value)} />
            </div>
            <div className="w-24 mt-4">
              <CustomSelect 
                options={[{value: 'person', label: 'Person'}, {value: 'entity', label: 'Entity'}]} 
                value={node.type || 'entity'} 
                onChange={(val) => handleUpdateNode(idx, 'type', val)} 
              />
            </div>
            <button type="button" onClick={() => handleRemoveNode(idx)} className="mt-4 text-stone-600 hover:text-red-400 cursor-pointer p-1"><BiTrashAlt size={16} /></button>
          </div>
        ))}
      </div>

      {/* Edges Manager */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <label className="text-stone-400 font-bold uppercase tracking-wider">Edges (Connections)</label>
          <button type="button" onClick={handleAddEdge} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded flex items-center gap-1 text-stone-300"><BsPlus /> Add Edge</button>
        </div>
        {edges.map((edge: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2 bg-stone-950 p-2 rounded border border-stone-800 relative group">
            <div className="flex-1 mt-4">
              <CustomSelect 
                options={nodeOptions} 
                value={edge.source} 
                onChange={(val) => handleUpdateEdge(idx, 'source', val)} 
              />
            </div>
            <div className="text-stone-600 mt-4 text-xs font-bold">→</div>
            <div className="flex-1 mt-4">
              <CustomSelect 
                options={nodeOptions} 
                value={edge.target} 
                onChange={(val) => handleUpdateEdge(idx, 'target', val)} 
              />
            </div>
            <button type="button" onClick={() => handleRemoveEdge(idx)} className="mt-4 text-stone-600 hover:text-red-400 cursor-pointer p-1"><BiTrashAlt size={16} /></button>
          </div>
        ))}
        {nodes.length < 2 && <div className="text-xs text-amber-500/80 italic">Add at least 2 nodes to create connections.</div>}
      </div>

    </div>
  );
};
