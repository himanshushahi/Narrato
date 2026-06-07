import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useProjectStore, Project } from '../store/useProjectStore';
import { useUIStore } from '../store/useUIStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { CustomInput, CustomTextarea } from '../components/ui/CustomInput';
import { CustomSelect } from '../components/ui/CustomSelect';
import { VscPlay, VscTrash, VscAdd, VscFolderOpened, VscCircleFilled, VscLayers, VscLoading } from 'react-icons/vsc';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { callEel } from '../utils/eel-bridge';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { projects, fetchProjects, deleteProject } = useProjectStore();
  const { addToast, showConfirm } = useUIStore();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('hi');
  const [durationMode, setDurationMode] = useState('medium');
  const [exportFolder, setExportFolder] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    if (!exportFolder.trim()) {
      addToast("Please select an export destination folder", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await callEel<{ success: boolean; project_id?: string; error?: string }>('create_new_project', name, prompt, exportFolder, language, 'nitish_rajput', durationMode);
      if (res?.success && res.project_id) {
        fetchProjects();
        setShowModal(false);
        setName('');
        setPrompt('');
        setExportFolder('');
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
    const dir = await callEel<string>('browse_export_directory');
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

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } }
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
  };

  return (
    <div className="max-w-7xl mx-auto px-8 py-10 select-none relative z-10">

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="space-y-8"
      >
        {/* Dashboard Header */}
        <motion.div variants={itemVariants} className="flex justify-between items-center border-b border-stone-850 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <VscLayers className="text-2xl text-[var(--color-accent-primary)]" />
              <h1 className="text-2xl font-black text-white tracking-tight">Documentary <span className="text-gradient-accent">Library</span></h1>
            </div>
            <p className="text-xs text-stone-400 font-medium">Manage and generate automated cinematic narratives.</p>
          </div>
          <GlowButton onClick={() => setShowModal(true)} icon={<VscAdd />}>
            New Project
          </GlowButton>
        </motion.div>

        {/* Projects Grid */}
        <motion.div variants={itemVariants}>
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
                            {project.duration_mode === 'short' ? '2m' : project.duration_mode === 'medium' ? '5m' : '10m'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-stone-500 font-bold uppercase tracking-wider mb-1">Resolution</div>
                          <div className="text-xs text-stone-300 font-medium">4K</div>
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
        </motion.div>
      </motion.div>

      {/* Documentary Creation Modal */}
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
                      placeholder="e.g. The Scam of 1992, Rise of the East India Company"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-stone-950"
                    />

                    <CustomTextarea
                      label="Script & Art Direction Prompt"
                      required
                      rows={3}
                      placeholder="Tell the AI what to cover in the script. e.g. Detail how the scam was plotted, who leaked the stock reports, and what systemic changes resulted."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="bg-stone-950"
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
                        label="Duration Mode"
                        options={[
                          { value: 'short', label: 'Short (~2m)' },
                          { value: 'medium', label: 'Medium (~5m)' },
                          { value: 'long', label: 'Long (~10m)' }
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
