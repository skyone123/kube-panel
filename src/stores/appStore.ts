import { create } from 'zustand';
import type { Context } from '../types';

interface AppState {
  currentContext: Context | null;
  namespace: string;
  setCurrentContext: (c: Context | null) => void;
  setNamespace: (n: string) => void;
}
export const useAppStore = create<AppState>((set) => ({
  currentContext: null,
  namespace: 'default',
  setCurrentContext: (c) => set({ currentContext: c }),
  setNamespace: (n) => set({ namespace: n }),
}));
