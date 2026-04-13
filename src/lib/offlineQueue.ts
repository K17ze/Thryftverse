import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

export interface QueuedRequest {
  id: string;
  url: string;
  options: RequestInit;
  timestamp: number;
  retryCount: number;
}

interface OfflineQueueState {
  queue: QueuedRequest[];
  isProcessing: boolean;
  pushToQueue: (url: string, options: RequestInit) => void;
  removeFromQueue: (id: string) => void;
  flushQueue: (fetchImplementation: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => Promise<void>;
  clearQueue: () => void;
}

export const useOfflineQueue = create<OfflineQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      isProcessing: false,

      pushToQueue: (url, options) => {
        const newRequest: QueuedRequest = {
          id: Math.random().toString(36).substring(2, 11),
          url,
          options,
          timestamp: Date.now(),
          retryCount: 0,
        };

        set((state) => ({
          queue: [...state.queue, newRequest],
        }));
      },

      removeFromQueue: (id) => {
        set((state) => ({
          queue: state.queue.filter((req) => req.id !== id),
        }));
      },

      clearQueue: () => set({ queue: [] }),

      flushQueue: async (fetchImplementation) => {
        const { queue, isProcessing, removeFromQueue } = get();

        if (isProcessing || queue.length === 0) return;

        // Verify native network state before flushing
        const networkState = await Network.getNetworkStateAsync();
        if (!networkState.isInternetReachable) return;

        set({ isProcessing: true });

        // Sort by timestamp (FIFO)
        const sortedQueue = [...queue].sort((a, b) => a.timestamp - b.timestamp);

        for (const req of sortedQueue) {
          try {
            // Attempt to fire the stored request
            const response = await fetchImplementation(req.url, req.options);

            if (response.ok || (response.status >= 400 && response.status < 500)) {
              // If it succeeded or failed with a 4xx client error (unrecoverable),
              // we don't need to try it again.
              removeFromQueue(req.id);
            } else {
              // 5xx Server Error or network drop mid-flight: Increment retry and keep in queue
              set((state) => ({
                queue: state.queue.map((qReq) =>
                  qReq.id === req.id
                    ? { ...qReq, retryCount: qReq.retryCount + 1 }
                    : qReq
                ),
              }));
            }
          } catch (error) {
            // Network failure during fetch: Keep in queue
            set((state) => ({
              queue: state.queue.map((qReq) =>
                qReq.id === req.id
                  ? { ...qReq, retryCount: qReq.retryCount + 1 }
                  : qReq
              ),
            }));
          }
        }

        set({ isProcessing: false });
      },
    }),
    {
      name: 'thryftverse-offline-queue',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ queue: state.queue }), // Only persist the queue array
    }
  )
);
