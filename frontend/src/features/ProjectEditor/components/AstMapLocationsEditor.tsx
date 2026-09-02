import React, { useState } from 'react';
import { BiTrashAlt, BiPlus } from 'react-icons/bi';
import { BsGeoAlt, BsCodeSquare } from 'react-icons/bs';

interface MapLocation {
  name?: string;
  coord: [number, number]; // [lat, lon]
}

interface AstMapLocationsEditorProps {
  locations?: MapLocation[];
  onChange: (locations: MapLocation[]) => void;
}

const PRESET_CITIES: { name: string; coord: [number, number] }[] = [
  { name: 'New Delhi', coord: [28.6139, 77.2090] },
  { name: 'Mumbai', coord: [19.0760, 72.8777] },
  { name: 'Bengaluru', coord: [12.9716, 77.5946] },
  { name: 'London', coord: [51.5074, -0.1278] },
  { name: 'New York', coord: [40.7128, -74.0060] },
  { name: 'San Francisco', coord: [37.7749, -122.4194] },
  { name: 'Tokyo', coord: [35.6762, 139.6503] },
  { name: 'Dubai', coord: [25.2048, 55.2708] },
  { name: 'Singapore', coord: [1.3521, 103.8198] },
  { name: 'Paris', coord: [48.8566, 2.3522] },
  { name: 'Berlin', coord: [52.5200, 13.4050] },
  { name: 'Sydney', coord: [-33.8688, 151.2093] },
  { name: 'Hong Kong', coord: [22.3193, 114.1694] },
  { name: 'Zurich', coord: [47.3769, 8.5417] },
  { name: 'Toronto', coord: [43.6532, -79.3832] },
];

export const AstMapLocationsEditor: React.FC<AstMapLocationsEditorProps> = ({
  locations = [],
  onChange,
}) => {
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(locations, null, 2));

  const handleUpdate = (idx: number, updates: Partial<MapLocation>) => {
    const updated = [...locations];
    updated[idx] = { ...updated[idx], ...updates };
    onChange(updated);
  };

  const handleAddLocation = (name = 'New Point', coord: [number, number] = [28.6139, 77.2090]) => {
    onChange([...locations, { name, coord }]);
  };

  const handleDelete = (idx: number) => {
    onChange(locations.filter((_, i) => i !== idx));
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        onChange(parsed);
      }
    } catch {
      // Invalid JSON
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Header & Quick City Add Selector */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
          <BsGeoAlt size={11} />
          Map Waypoints ({locations.length})
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setJsonText(JSON.stringify(locations, null, 2));
              setShowJson(!showJson);
            }}
            className="text-[9px] text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <BsCodeSquare size={10} />
            {showJson ? 'GUI Table' : 'Raw JSON'}
          </button>
          <button
            type="button"
            onClick={() => handleAddLocation()}
            className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <BiPlus size={12} /> Add Point
          </button>
        </div>
      </div>

      {/* Quick City Dropdown Adder */}
      <div className="flex items-center gap-2 p-2 bg-black/40 border border-white/5 rounded-lg">
        <span className="text-[9px] font-bold uppercase text-stone-500 shrink-0">Quick Add:</span>
        <select
          className="flex-1 bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2 py-1 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
          value=""
          onChange={e => {
            const city = PRESET_CITIES.find(c => c.name === e.target.value);
            if (city) {
              handleAddLocation(city.name, city.coord);
            }
          }}
        >
          <option value="" disabled>Choose a global city to add...</option>
          {PRESET_CITIES.map((city, cIdx) => (
            <option key={cIdx} value={city.name}>
              {city.name} ({city.coord[0]}°, {city.coord[1]}°)
            </option>
          ))}
        </select>
      </div>

      {showJson ? (
        <textarea
          value={jsonText}
          onChange={e => handleJsonChange(e.target.value)}
          className="w-full bg-black/60 border border-white/10 rounded-md p-2 text-xs font-mono text-stone-200 min-h-[120px] focus:outline-none focus:border-amber-500/50"
        />
      ) : (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5">
          {locations.length === 0 ? (
            <div className="p-3 bg-black/20 border border-white/5 rounded-lg text-center text-stone-500 text-[11px] italic">
              No waypoints set. Use the Quick Add selector above or click "+ Add Point".
            </div>
          ) : (
            locations.map((loc, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 bg-black/40 border border-white/10 rounded-lg hover:border-white/20 transition-all"
              >
                <span className="text-[10px] font-mono font-bold text-amber-400/70 w-4 shrink-0 text-center">
                  {idx + 1}
                </span>

                {/* City Name */}
                <input
                  type="text"
                  placeholder="Location Name"
                  value={loc.name || ''}
                  onChange={e => handleUpdate(idx, { name: e.target.value })}
                  className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-medium"
                />

                {/* Latitude */}
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
                  <span className="text-[9px] text-stone-500 font-mono uppercase">Lat:</span>
                  <input
                    type="number"
                    step="any"
                    value={loc.coord?.[0] ?? 0}
                    onChange={e => {
                      const lat = parseFloat(e.target.value) || 0;
                      handleUpdate(idx, { coord: [lat, loc.coord?.[1] ?? 0] });
                    }}
                    className="w-14 bg-transparent text-xs text-stone-200 font-mono focus:outline-none text-right"
                  />
                </div>

                {/* Longitude */}
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
                  <span className="text-[9px] text-stone-500 font-mono uppercase">Lon:</span>
                  <input
                    type="number"
                    step="any"
                    value={loc.coord?.[1] ?? 0}
                    onChange={e => {
                      const lon = parseFloat(e.target.value) || 0;
                      handleUpdate(idx, { coord: [loc.coord?.[0] ?? 0, lon] });
                    }}
                    className="w-14 bg-transparent text-xs text-stone-200 font-mono focus:outline-none text-right"
                  />
                </div>

                {/* Delete Button */}
                <button
                  type="button"
                  onClick={() => handleDelete(idx)}
                  className="p-1 text-stone-500 hover:text-red-400 bg-white/5 hover:bg-red-500/10 rounded transition-colors cursor-pointer shrink-0"
                  title="Delete waypoint"
                >
                  <BiTrashAlt size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
