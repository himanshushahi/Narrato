import React from 'react';
import { useEditorStore } from '../../../store/useEditorStore';

interface ResizeHandleProps {
  /** 'horizontal' = top/bottom edge (changes row height), 'vertical' = left/right edge (changes column width) */
  direction: 'horizontal' | 'vertical';
  /** Which dimension to update */
  target: 'leftPanel' | 'rightPanel' | 'timeline';
  /** Side of the handle — which edge of the panel it sits on */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** Min/max constraints */
  min?: number;
  max?: number;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  direction,
  target,
  min = 180,
  max = 800,
}) => {
  const setLeftPanelWidth = useEditorStore((s) => s.setLeftPanelWidth);
  const setRightPanelWidth = useEditorStore((s) => s.setRightPanelWidth);
  const setTimelineHeight = useEditorStore((s) => s.setTimelineHeight);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = useEditorStore.getState().leftPanelWidth;
    const startRight = useEditorStore.getState().rightPanelWidth;
    const startTimeline = useEditorStore.getState().timelineHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (target === 'leftPanel') {
        const dx = ev.clientX - startX;
        const newWidth = Math.min(max, Math.max(min, startLeft + dx));
        setLeftPanelWidth(newWidth);
      } else if (target === 'rightPanel') {
        const dx = ev.clientX - startX;
        const newWidth = Math.min(max, Math.max(min, startRight - dx));
        setRightPanelWidth(newWidth);
      } else if (target === 'timeline') {
        const dy = startY - ev.clientY;
        const newHeight = Math.min(max, Math.max(min, startTimeline + dy));
        setTimelineHeight(newHeight);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const isVertical = direction === 'vertical';

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        absolute z-30 transition-colors
        ${isVertical
          ? 'top-0 bottom-0 w-[5px] -ml-[2px] cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60'
          : 'left-0 right-0 h-[5px] -mt-[2px] cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/60'
        }
        ${target === 'leftPanel' ? 'right-0' : ''}
        ${target === 'rightPanel' ? 'left-0' : ''}
        ${target === 'timeline' ? 'top-0' : ''}
      `}
    />
  );
};
