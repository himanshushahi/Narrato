export const estimateTextDuration = (text: string | undefined | null): number => {
  if (!text || text.trim() === '') return 5;
  return Math.max(5, Math.ceil(text.length / 15));
};
