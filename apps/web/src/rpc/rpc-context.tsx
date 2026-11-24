import { createContext, useContext, type ReactNode } from 'react';
import type { RpcClient } from './client';

const RpcContext = createContext<RpcClient | null>(null);

export function RpcProvider({ client, children }: { client: RpcClient; children: ReactNode }) {
  return <RpcContext.Provider value={client}>{children}</RpcContext.Provider>;
}

export function useRpc(): RpcClient {
  const client = useContext(RpcContext);
  if (!client) throw new Error('useRpc must be used inside RpcProvider.');
  return client;
}
