import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useProjectStore, Project } from '../store/useProjectStore';
import { useUIStore } from '../store/useUIStore';
import { useEditorStore } from '../store/useEditorStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { CustomInput } from '../components/ui/CustomInput';
import { CustomSelect } from '../components/ui/CustomSelect';
import { VscPlay, VscTrash, VscAdd, VscFolderOpened, VscCircleFilled, VscLayers, VscLoading } from 'react-icons/vsc';
import { motion, AnimatePresence } from 'framer-motion';
import { callApi } from '../utils/call-api';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const addToast = useUIStore((s) => s.addToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [videoType, setVideoType] = useState('documentary');
  const [language, setLanguage] = useState('hi');
  const [videoFormat, setVideoFormat] = useState('landscape');
  const [durationMode, setDurationMode] = useState('medium');
  const [exportFolder, setExportFolder] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !videoType.trim()) return;
    if (!exportFolder.trim()) {
      addToast("Please select an export destination folder", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await callApi<{ success: boolean; project_id?: string; error?: string }>('create_new_project', name, videoType, exportFolder, language, 'nitish_rajput', durationMode, videoFormat);
      if (res?.success && res.project_id) {
        fetchProjects();
        setShowModal(false);
        setName('');
        setVideoType('documentary');
        setExportFolder('');
        
        // Open export tab for newly created project
        useEditorStore.getState().setInspectorTab('export');

        // Redirect directly to the editor workspace
        navigate(`/editor/${res.project_id}`);
      } else {
        addToast("Error: " + (res?.error || "Failed to create project"), 'error');
      }
    } catch (err) {
      console.error(err);
      addToast("Failed to create project: Backend not responding", 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseFolder = async () => {
    const dir = await callApi<string>('browse_export_directory');
    if (dir) {
      setExportFolder(dir);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-emerald-400';
      case 'processing': return 'text-amber-500 animate-pulse';
      case 'queued': return 'text-blue-500';
      case 'failed': return 'text-red-500';
      default: return 'text-stone-500';
    }
  };



  return (
    <div className="max-w-7xl mx-auto px-8 py-10 select-none relative z-10">

      <div
        className="space-y-8"
      >
        {/* Dashboard Header */}
        <div className="flex justify-between items-center border-b border-stone-850 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <VscLayers className="text-2xl text-[var(--color-accent-primary)]" />
              <h1 className="text-2xl font-black text-white tracking-tight">Project <span className="text-gradient-accent">Library</span></h1>
            </div>
            <p className="text-xs text-stone-400 font-medium">Manage and generate automated cinematic narratives.</p>
          </div>
          <GlowButton onClick={() => setShowModal(true)} icon={<VscAdd />}>
            New Project
          </GlowButton>
        </div>

        {/* Projects Grid */}
        <div>
          {projects.length === 0 ? (
            <div className="w-full py-24 flex flex-col justify-center items-center bg-stone-900/20 border border-stone-850 rounded-xl text-center backdrop-blur-md">
              <VscFolderOpened className="text-5xl text-stone-600 mb-4 animate-bounce" />
              <h2 className="text-lg font-bold text-stone-300">Your library is empty</h2>
              <p className="text-stone-500 text-xs max-w-sm mt-1">Assemble your first automated narrative to compile timelines and assets.</p>
              <GlowButton
                onClick={() => setShowModal(true)}
                variant="secondary"
                size="sm"
                className="mt-6"
                icon={<VscAdd />}
              >
                Create Project
              </GlowButton>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {projects.map((project: Project) => (
                <GlassCard
                  key={project.id}
                  hoverEffect={true}
                  className="flex flex-col group relative overflow-hidden h-auto sm:min-h-[14rem] cursor-pointer"
                  onClick={() => navigate(`/editor/${project.id}`)}
                >
                  {/* Visual overlay gradient */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[var(--color-accent-primary)]/10 to-transparent rounded-bl-full pointer-events-none" />

                  {/* Content area */}
                  <div className="flex-1 p-5 sm:p-6 flex flex-col justify-between z-10">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded font-extrabold border ${project.language === 'hi'
                          ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-light)] border-[var(--color-accent-primary)]/20 shadow-[0_0_15px_-5px_var(--color-accent-glow)]'
                          : 'bg-stone-800 text-stone-300 border-stone-750'
                          }`}>
                          {project.language === 'hi' ? 'Hindi' : 'English'}
                        </span>
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${project.status === 'completed' ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/10' : 'border-stone-700 text-stone-400'}`}>
                          <VscCircleFilled className={getStatusColor(project.status)} />
                          <span>{project.status}</span>
                        </div>
                      </div>

                      <h3 className="text-lg sm:text-xl font-extrabold text-white tracking-tight line-clamp-2 group-hover:text-[var(--color-accent-light)] transition-colors mt-1">
                        {project.name}
                      </h3>

                      <p className="text-xs text-stone-400 line-clamp-2 leading-relaxed">
                        {project.prompt}
                      </p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-stone-850/80">
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div>
                          <div className="text-[9px] text-stone-500 font-bold uppercase tracking-wider mb-1">Date Created</div>
                          <div className="text-xs text-stone-300 font-medium">
                            {new Date(project.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-stone-500 font-bold uppercase tracking-wider mb-1">Duration</div>
                          <div className="text-xs text-stone-300 font-medium capitalize">
                            {project.video_format === 'portrait' 
                              ? (project.duration_mode === 'short' ? '60s' : project.duration_mode === 'medium' ? '90s' : '2m')
                              : (project.duration_mode === 'extra_long' ? '15m' : project.duration_mode === 'long' ? '10m' : '5m')}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-stone-500 font-bold uppercase tracking-wider mb-1">Format</div>
                          <div className="text-xs text-stone-300 font-medium capitalize">
                            {project.video_format === 'portrait' ? 'Portrait (Shorts)' : 'Landscape (Video)'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="mb-4">
                         <div className="text-[9px] text-stone-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><VscFolderOpened /> Export Folder</div>
                         <div className="text-xs text-stone-300 font-medium truncate" title={project.export_folder || 'Default Workspace'}>
                           {project.export_folder || 'Default Workspace'}
                         </div>
                      </div>

                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <GlowButton
                          onClick={() => navigate(`/editor/${project.id}`)}
                          className="flex-1 justify-center"
                          size="sm"
                          icon={<VscPlay />}
                        >
                          Open Studio
                        </GlowButton>
                        <GlowButton
                          onClick={() => {
                            showConfirm(
                              "Delete Project?",
                              "Are you sure you want to delete this project and delete all compiled video files?",
                              () => deleteProject(project.id)
                            );
                          }}
                          variant="danger"
                          size="sm"
                          icon={<VscTrash />}
                        >
                          Delete
                        </GlowButton>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Project Creation Modal */}
      {createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", duration: 0.3 }}
                className="w-full max-w-xl"
              >
                <div className="w-full bg-[var(--color-brand-900)] border border-stone-800/60 rounded-xl shadow-2xl overflow-hidden">
                  {/* Modal Header */}
                  <div className="px-6 py-5 border-b border-stone-800/60 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <VscAdd className="text-[var(--color-accent-primary)] text-xl" />
                      New Narrative Build
                    </h2>
                    <button
                      onClick={() => setShowModal(false)}
                      className="text-stone-500 hover:text-white text-2xl font-black transition-colors cursor-pointer leading-none"
                    >
                      &times;
                    </button>
                  </div>

                  {/* Modal Form */}
                  <form onSubmit={handleCreate} className="p-6 space-y-6">
                    <CustomInput
                      label="Narrative Topic / Name"
                      required
                      type="text"
                      placeholder="e.g. The Rise and Fall of Rome, How Bitcoin Works, Mars Exploration Explained"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-stone-950"
                    />

                    <CustomSelect
                      label="Video Style / Genre"
                      options={[
                        { value: 'documentary', label: 'Documentary & Geopolitics (Ken Burns, Maps, Cinematic)' },
                        { value: 'explainer', label: 'Tech & SaaS Explainer (Vector Graphics, Fast, Neon)' },
                        { value: 'finance', label: 'Finance & Market Analysis (Charts, Metrics, Tickers)' },
                        { value: 'vox', label: 'Vox-Style Editorial (Typography, Yellow/Black, Collage)' },
                        { value: 'news', label: 'News/Journalism (Split Screens, Lower Thirds)' },
                        { value: 'true_crime', label: 'True Crime / Mystery (Redacted Memos, Shockwave)' },
                        { value: 'storytime', label: 'Personal Story (Portraits, Warm, Soft)' },
                        { value: 'viral_short', label: 'Viral Short-Form (Fast Cuts, Kinetic Words, Punchy)' }
                      ]}
                      value={videoType}
                      onChange={(val) => setVideoType(val)}
                    />

                    <div>
                      <label className="block text-xs font-bold text-stone-400 mb-2 uppercase tracking-wider">Export Destination Folder <span className="text-red-500">*</span></label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={exportFolder}
                          placeholder="Select where the final video will be saved"
                          className="flex-1 bg-stone-950 border border-stone-800 text-stone-200 text-sm rounded-lg px-4 py-2.5 outline-none font-medium"
                        />
                        <GlowButton
                          type="button"
                          onClick={handleBrowseFolder}
                          icon={<VscFolderOpened />}
                          variant="secondary"
                        >
                          Browse
                        </GlowButton>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <CustomSelect
                        label="Language"
                        options={[
                          { value: 'hi', label: 'Hindi (हिंदी)' },
                          { value: 'en', label: 'English (EN)' }
                        ]}
                        value={language}
                        onChange={setLanguage}
                        className="bg-stone-950"
                      />

                      <CustomSelect
                        label="Video Format"
                        options={[
                          { value: 'landscape', label: 'Landscape (YouTube)' },
                          { value: 'portrait', label: 'Portrait (Reels/Shorts)' }
                        ]}
                        value={videoFormat}
                        onChange={(val) => {
                          setVideoFormat(val);
                          // Reset duration to a valid default when format changes
                          if (val === 'landscape' && durationMode === 'short') {
                             setDurationMode('medium');
                          } else if (val === 'portrait' && durationMode === 'extra_long') {
                             setDurationMode('long');
                          }
                        }}
                        className="bg-stone-950"
                      />
                      
                      <CustomSelect
                        label="Duration Mode"
                        options={videoFormat === 'portrait' ? [
                          { value: 'short', label: 'Short (~60s)' },
                          { value: 'medium', label: 'Medium (~90s)' },
                          { value: 'long', label: 'Long (~2m)' }
                        ] : [
                          { value: 'medium', label: 'Medium (~5m)' },
                          { value: 'long', label: 'Long (~10m)' },
                          { value: 'extra_long', label: 'Extra Long (~15m)' }
                        ]}
                        value={durationMode}
                        onChange={setDurationMode}
                        className="bg-stone-950"
                      />
                    </div>

                    <div className="flex justify-end items-center gap-4 pt-4">
                      <button
                        type="button"
                        onClick={() => setShowModal(false)}
                        className="text-sm font-bold text-white hover:text-stone-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <GlowButton
                        type="submit"
                        disabled={loading}
                        icon={loading ? <VscLoading className="animate-spin" /> : <VscPlay />}
                      >
                        {loading ? 'Assembling...' : 'Assemble Project'}
                      </GlowButton>
                    </div>
                  </form>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default Dashboard;
