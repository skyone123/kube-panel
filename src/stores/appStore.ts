import { create } from 'zustand';

interface AppState {
  namespace: string;
  setNamespace: (n: string) => void;
}
export const useAppStore = create<AppState>((set) => ({
  namespace: '',
  setNamespace: (n) => set({ namespace: n }),
}));
