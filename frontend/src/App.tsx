import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { useProjectStore } from './store/useProjectStore';
import { useSettingsStore } from './store/useSettingsStore';
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const EditorWorkspace = React.lazy(() => import('./features/EditorWorkspace/EditorWorkspace'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
import TerminalLogs from './components/ui/TerminalLogs';
import { ToastContainer } from './components/ui/Toast';
import { ConfirmModal } from './components/ui/ConfirmModal';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscSettings, VscLayers, VscPulse, VscLayoutSidebarLeft, VscAccount
} from 'react-icons/vsc';

function Sidebar() {
  const location = useLocation();
  const queue = useProjectStore((state) => state.queue);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const toggleSidebar = () => {
    const newVal = !collapsed;
    setCollapsed(newVal);
    localStorage.setItem('sidebar_collapsed', String(newVal));
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname === '';
    return location.pathname.startsWith(path);
  };

  const navItems = [
    { path: '/', icon: <VscLayers />, label: 'Studio' },
    { path: '/settings', icon: <VscSettings />, label: 'Settings' },
  ];

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 80 : 260 }}
      className="relative z-40 bg-stone-950 border-r border-stone-800 flex flex-col justify-between select-none shadow-2xl"
    >
      <div className="space-y-8 py-6">
        {/* Brand logo */}
        <div className={`px-6 flex items-center gap-3 ${collapsed ? 'justify-center px-0' : ''}`}>
          <img src="/logo.png" alt="Narrato" className={`${collapsed ? 'w-8 h-8' : 'w-10 h-10'} relative z-10 object-contain`} />
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="font-black text-xs tracking-widest text-white uppercase text-gradient"
            >
              Narr<span className="[var(--color-accent-primary)]">ato</span>
            </motion.span>
          )}
        </div>

        {/* Navigation list */}
        <nav className="space-y-2 px-4">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path}>
              <motion.div
                whileHover={{ x: collapsed ? 0 : 4 }}
                whileTap={{ scale: 0.98 }}
                className={`relative flex items-center gap-3 py-3 rounded-md text-sm font-semibold tracking-wide transition-all overflow-hidden ${isActive(item.path)
                  ? 'text-white shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/40'
                  } ${collapsed ? 'justify-center px-0' : 'px-4'}`}
              >
                {isActive(item.path) && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-gradient-to-r from-[var(--color-accent-primary)]/15 to-[var(--color-accent-primary)]/5 border border-[var(--color-accent-primary)]/20 rounded-md"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <span className={`text-[1.2rem] relative z-10 ${isActive(item.path) ? 'text-[var(--color-accent-light)]' : ''}`}>
                  {item.icon}
                </span>
                {!collapsed && <span className="relative z-10">{item.label}</span>}
              </motion.div>
            </Link>
          ))}
        </nav>
      </div>

      {/* Bottom Status bar */}
      <div className="p-4 space-y-4">
        {queue.active && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-3 bg-[var(--color-accent-primary)]/10 border border-[var(--color-accent-primary)]/20 rounded-md flex items-center gap-3 shadow-[0_0_15px_-5px_var(--color-accent-glow)] ${collapsed ? 'justify-center' : ''}`}
          >
            <VscPulse className="text-[var(--color-accent-light)] text-lg animate-pulse" />
            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <div className="font-bold text-[var(--color-accent-light)] uppercase tracking-widest text-[9px] truncate">Pipeline Active</div>
                <div className="text-[10px] text-stone-300 mt-0.5 truncate">Rendering video...</div>
              </div>
            )}
          </motion.div>
        )}

        <div className={`flex flex-col gap-4 border-t border-stone-800 pt-4`}>
          <div className={`flex items-center gap-2 ${collapsed ? 'justify-center flex-col' : 'justify-between'}`}>
            {!collapsed && (
              <div className="flex items-center gap-2 px-2 overflow-hidden whitespace-nowrap">
                <div className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-stone-400 border border-stone-700 shadow-inner shrink-0">
                  <VscAccount />
                </div>
                <div className="flex flex-col overflow-hidden min-w-0">
                  <span className="text-xs font-bold text-stone-200 truncate">Local Studio</span>
                  <span className="text-[9px] text-emerald-400 font-semibold flex items-center gap-1 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" /> Online
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="p-2.5 text-stone-500 hover:text-white hover:bg-stone-800/50 rounded-md transition-colors"
            >
              <VscLayoutSidebarLeft className="text-lg" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}


function AppContent() {
  const location = useLocation();
  const isEditorRoute = location.pathname.startsWith('/editor');

  useEffect(() => {
    // Connection is handled by pywebview automatically
  }, []);

  // Full-screen editor layout (no sidebar, no terminal)
  if (isEditorRoute) {
    return (
      <>
        <div className="bg-cinematic fixed inset-0 z-0 pointer-events-none" />

        <div className="h-screen w-screen text-stone-100 overflow-hidden font-sans relative z-10">
          <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-white font-mono">Loading Editor...</div>}>
            <Routes>
              <Route path="/editor/:id" element={<EditorWorkspace />} />
            </Routes>
          </Suspense>
        </div>
        <ToastContainer />
        <ConfirmModal />
      </>
    );
  }

  // Standard layout with sidebar
  return (
    <>
      <div className="bg-cinematic fixed inset-0 z-0 pointer-events-none" />
      <div className="h-screen w-screen flex text-stone-100 overflow-hidden font-sans relative z-10">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 relative bg-zinc-950/20">

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative">
            <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-white font-mono">Loading Module...</div>}>
              <Routes>
                <Route path="/" element={
                  <div className="min-h-full">
                    <Dashboard />
                  </div>
                } />
                <Route path="/settings" element={
                  <div className="min-h-full">
                    <SettingsPage />
                  </div>
                } />
              </Routes>
            </Suspense>
          </div>
          <TerminalLogs />
        </div>
      </div>
      <ToastContainer />
      <ConfirmModal />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}