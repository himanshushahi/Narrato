import { useState } from 'react';
import { VscLoading } from 'react-icons/vsc';
import { CustomSelect } from '../../components/ui/CustomSelect';

export const MapLocationsEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const locations = visualMeta?.locations || [];
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);

  const handleUpdate = (idx: number, field: string, val: string) => {
    const newLocs = [...locations];
    if (field === 'name') newLocs[idx].name = val;
    if (field === 'lat') newLocs[idx].coord[0] = parseFloat(val) || 0;
    if (field === 'lon') newLocs[idx].coord[1] = parseFloat(val) || 0;
    onChange({ ...visualMeta, locations: newLocs });
  };

  const handleAdd = () => {
    onChange({ ...visualMeta, locations: [...locations, { name: 'New Place', coord: [0, 0] }] });
  };

  const handleRemove = (idx: number) => {
    const newLocs = locations.filter((_: any, i: number) => i !== idx);
    onChange({ ...visualMeta, locations: newLocs });
  };

  const handleAutoLocate = async (idx: number) => {
    const name = locations[idx].name;
    if (!name) return;
    setLoadingIdx(idx);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const newLocs = [...locations];
        newLocs[idx].coord[0] = parseFloat(data[0].lat);
        newLocs[idx].coord[1] = parseFloat(data[0].lon);
        onChange({ ...visualMeta, locations: newLocs });
      } else {
        alert(`Could not find coordinates for "${name}"`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to fetch coordinates.");
    } finally {
      setLoadingIdx(null);
    }
  };

  return (
    <div className="col-span-2 space-y-3 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Map Style Theme</label>
      </div>
      <div>
        <CustomSelect
          options={[
            { value: 'vintage', label: 'Vintage (Default)' },
            { value: 'modern_dark', label: 'Modern Dark' },
            { value: 'minimal_light', label: 'Minimal Light' },
            { value: 'nautical_blue', label: 'Nautical Blue' },
          ]}
          value={visualMeta.map_style || 'vintage'}
          onChange={(val) => onChange({ ...visualMeta, map_style: val })}
        />
      </div>

      <div className="flex justify-between items-center text-xs pt-2 border-t border-stone-800/50">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Map Locations (Lat, Lon):</label>
        <button type="button" onClick={handleAdd} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">
          + Add Point
        </button>
      </div>
      <div className="space-y-2">
        {locations.map((loc: any, idx: number) => (
          <div key={idx} className="flex gap-2 items-center">
            <div className="flex w-1/3 relative">
              <input type="text" value={loc.name} onChange={e => handleUpdate(idx, 'name', e.target.value)} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 pr-7 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Name" />
              <button
                type="button"
                onClick={() => handleAutoLocate(idx)}
                disabled={loadingIdx === idx}
                className="absolute right-1 top-1 text-stone-400 hover:text-amber-400 disabled:opacity-50"
                title="Auto-Locate Coordinates"
              >
                {loadingIdx === idx ? <VscLoading className="animate-spin text-xs mt-0.5" /> : '📍'}
              </button>
            </div>
            <input type="number" step="any" value={loc.coord?.[0] || 0} onChange={e => handleUpdate(idx, 'lat', e.target.value)} className="w-1/4 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Lat" />
            <input type="number" step="any" value={loc.coord?.[1] || 0} onChange={e => handleUpdate(idx, 'lon', e.target.value)} className="w-1/4 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Lon" />
            <button type="button" onClick={() => handleRemove(idx)} className="text-red-400 hover:text-red-300 px-2 py-1 text-xs">✕</button>
          </div>
        ))}
        {locations.length === 0 && <p className="text-[10px] text-stone-500">No locations set.</p>}
      </div>
    </div>
  );
};

