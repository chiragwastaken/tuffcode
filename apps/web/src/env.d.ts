import type { TuffcodeBridge } from './types';

declare global {
  interface Window {
    tuffcode: TuffcodeBridge;
  }
}
