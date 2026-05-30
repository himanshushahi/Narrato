import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore, Project } from '../store/appStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { CustomInput, CustomTextarea } from '../components/ui/CustomInput';
import { CustomSelect } from '../components/ui/CustomSelect';
import { VscPlay, VscTrash, VscAdd, VscFolderOpened, VscCircleFilled, VscLayers, VscLoading } from 'react-icons/vsc';
import { motion, AnimatePresence } from 'framer-motion';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { projects, fetchProjects, deleteProject, addToast } = useAppStore();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('hi');
  const [style, setStyle] = useState('nitish_rajput');
  const [durationMode, setDurationMode] = useState('medium');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    setLoading(true);
    try {
      if (window.eel) {
        const res = await window.eel.create_new_project(name, prompt, language, style, durationMode)();
        if (res.success && res.project_id) {
          fetchProjects();
          setShowModal(false);
          setName('');
          setPrompt('');
          // Redirect directly to the editor workspace
          navigate(`/editor/${res.project_id}`);
        } else {
          addToast("Error: " + (res.error || "Failed to create project"), 'error');
        }
      } else {
        addToast("Eel is not connected. Project creation is mocked.", 'warning');
        setShowModal(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } }
  };

  const itemVariants = {
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project: Project) => (
                <GlassCard
                  key={project.id}
                  hoverEffect={true}
                  className="p-5 flex flex-col justify-between group relative overflow-hidden h-56"
                  onClick={() => navigate(`/editor/${project.id}`)}
                >
                  {/* Visual overlay gradient */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-[var(--color-accent-primary)]/5 to-transparent rounded-bl-full pointer-events-none" />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-[8px] uppercase tracking-widest px-2 py-0.5 rounded font-extrabold border ${project.language === 'hi'
                          ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-light)] border-[var(--color-accent-primary)]/20 shadow-[0_0_15px_-5px_var(--color-accent-glow)]'
                          : 'bg-stone-800 text-stone-300 border-stone-750'
                        }`}>
                        {project.language === 'hi' ? 'Hindi' : 'English'}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-stone-400 font-bold uppercase tracking-wider">
                        <VscCircleFilled className={getStatusColor(project.status)} />
                        <span>{project.status}</span>
                      </div>
                    </div>

                    <h3 className="text-base font-extrabold text-white tracking-tight truncate group-hover:text-[var(--color-accent-light)] transition-colors">
                      {project.name}
                    </h3>

                    <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed">
                      {project.prompt}
                    </p>
                  </div>

                  <div className="border-t border-stone-850/80 pt-4 flex items-center justify-between">
                    <span className="text-[10px] text-stone-600 font-mono">
                      {new Date(project.created_at).toLocaleDateString()}
                    </span>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <GlowButton
                        onClick={() => navigate(`/editor/${project.id}`)}
                        variant="secondary"
                        size="sm"
                        icon={<VscPlay className="text-[var(--color-accent-primary)]" />}
                      >
                        Studio
                      </GlowButton>
                      <GlowButton
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this project and delete all compiled video files?")) {
                            deleteProject(project.id);
                          }
                        }}
                        variant="danger"
                        size="sm"
                        icon={<VscTrash />}
                      >
                        Delete
                      </GlowButton>
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
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", duration: 0.4 }}
                className="w-full max-w-xl"
              >
                <GlassCard elevation="high" className="w-full shadow-2xl">
                  {/* Modal Header */}
                  <div className="px-6 py-4 bg-stone-950/60 border-b border-stone-850 flex justify-between items-center rounded-t-xl">
                  <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <VscAdd className="text-[var(--color-accent-primary)]" />
                    New Narrative Build
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-stone-500 hover:text-white text-xl font-bold transition-colors cursor-pointer"
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
                  />

                  <CustomTextarea
                    label="Script & Art Direction Prompt"
                    required
                    rows={3}
                    placeholder="Tell the AI what to cover in the script. e.g. Detail how the scam was plotted, who leaked the stock reports, and what systemic changes resulted."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <CustomSelect
                      label="Language"
                      options={[
                        { value: 'hi', label: 'Hindi (हिंदी)' },
                        { value: 'en', label: 'English (EN)' }
                      ]}
                      value={language}
                      onChange={setLanguage}
                    />

                    <CustomSelect
                      label="Visual style"
                      options={[
                        { value: 'nitish_rajput', label: 'Nitish Rajput Style' },
                        { value: 'vintage_documentary', label: 'Vintage Archival' },
                        { value: 'dark_mystery', label: 'Dark Suspense' }
                      ]}
                      value={style}
                      onChange={setStyle}
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
                    />
                  </div>

                  <div className="flex justify-end gap-3 border-t border-stone-850 pt-6">
                    <GlowButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setShowModal(false)}
                    >
                      Cancel
                    </GlowButton>
                    <GlowButton
                      type="submit"
                      disabled={loading}
                      icon={loading ? <VscLoading className="animate-spin" /> : <VscPlay />}
                    >
                      {loading ? 'Assembling...' : 'Assemble Project'}
                    </GlowButton>
                  </div>
                </form>
              </GlassCard>
            </motion.div>
          </div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default Dashboard;
